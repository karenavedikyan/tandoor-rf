import type { PoolClient } from "pg";
import type {
  CatalogGroupStatus,
  CatalogProductDetail,
  CatalogProductListItem,
  CatalogProductSearchResult,
  CatalogSectionOption,
  CatalogSectionTreeNode,
  CatalogSnapshotMeta,
} from "./types";
import type { ParsedCatalogSearchQuery } from "./query-params";
import {
  assertCatalogPropertyFiltersAvailable,
  extractArticleFromProperties,
  selectKeyProperties,
} from "./facets-repository";
import { buildCatalogProductFilters, buildSectionTree, loadSectionRows } from "./search-filters";
import { escapeIlikeLiteral } from "./sql-utils";

export { escapeIlikeLiteral } from "./sql-utils";

type ActiveVersionRow = {
  version_id: string;
  imported_at: Date;
  import_profile: string;
  distribution_ready: boolean;
  product_count: number;
};

async function loadActiveVersion(client: PoolClient): Promise<ActiveVersionRow | null> {
  const result = await client.query<ActiveVersionRow>(
    `
      SELECT v.id AS version_id,
             v.imported_at,
             v.import_profile,
             v.distribution_ready,
             v.product_count
      FROM onec_catalog_state s
      JOIN onec_catalog_versions v ON v.id = s.active_version_id
      WHERE s.id = 1 AND v.is_active = TRUE
      LIMIT 1
    `,
  );
  return result.rows[0] ?? null;
}

function mapGroupStatus(groupCode: string | null, groupFound: boolean | null): CatalogGroupStatus {
  if (!groupCode) return "not_specified";
  if (groupFound) return "found";
  return "missing_reference";
}

export async function loadCatalogSnapshotMeta(client: PoolClient): Promise<CatalogSnapshotMeta> {
  const active = await loadActiveVersion(client);
  if (!active) {
    return {
      state: "empty",
      versionId: null,
      importedAt: null,
      importProfile: null,
      distributionReady: false,
      productCount: 0,
      sectionCount: 0,
      propertyCount: 0,
      imagePathCount: 0,
      classificationIncomplete: false,
      message: "Активный каталог не импортирован.",
    };
  }

  const counts = await client.query<{
    section_count: string;
    property_count: string;
    image_path_count: string;
    missing_group_count: string;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::text FROM onec_catalog_sections WHERE version_id = $1::uuid) AS section_count,
        (SELECT COUNT(*)::text FROM onec_catalog_product_properties WHERE version_id = $1::uuid) AS property_count,
        (SELECT COUNT(*)::text FROM onec_catalog_product_images WHERE version_id = $1::uuid) AS image_path_count,
        (
          SELECT COUNT(*)::text
          FROM onec_catalog_products p
          LEFT JOIN onec_catalog_groups g
            ON g.version_id = p.version_id AND g.code = p.group_code
          WHERE p.version_id = $1::uuid
            AND p.group_code IS NOT NULL
            AND g.code IS NULL
        ) AS missing_group_count
    `,
    [active.version_id],
  );
  const row = counts.rows[0];
  const missingGroupCount = Number(row?.missing_group_count ?? "0");

  return {
    state: "ready",
    versionId: active.version_id,
    importedAt: active.imported_at.toISOString(),
    importProfile: active.import_profile,
    distributionReady: active.distribution_ready,
    productCount: active.product_count,
    sectionCount: Number(row?.section_count ?? "0"),
    propertyCount: Number(row?.property_count ?? "0"),
    imagePathCount: Number(row?.image_path_count ?? "0"),
    classificationIncomplete: missingGroupCount > 0,
    message:
      missingGroupCount > 0
        ? "Часть товаров ссылается на группы, отсутствующие в выгрузке; исходные коды групп сохранены."
        : undefined,
  };
}

export async function listCatalogSections(
  client: PoolClient,
  versionId: string,
): Promise<CatalogSectionOption[]> {
  const result = await client.query<CatalogSectionOption>(
    `
      SELECT code, name
      FROM onec_catalog_sections
      WHERE version_id = $1::uuid
      ORDER BY name ASC, code ASC
    `,
    [versionId],
  );
  return result.rows;
}

export async function searchCatalogProducts(
  client: PoolClient,
  versionId: string,
  query: ParsedCatalogSearchQuery,
): Promise<CatalogProductSearchResult> {
  await assertCatalogPropertyFiltersAvailable(client, versionId, query.propertyFilters);
  const built = await buildCatalogProductFilters(client, versionId, query);
  const params = [...built.params];
  const whereClause = built.whereClause;
  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_catalog_products p WHERE ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count ?? "0");
  const offset = (query.page - 1) * query.pageSize;

  params.push(query.pageSize, offset);
  const limitIndex = params.length - 1;
  const offsetIndex = params.length;

  const rows = await client.query<{
    code: string;
    name: string;
    group_code: string | null;
    activity: string;
    group_found: boolean | null;
    primary_image_path: string | null;
    primary_image_asset_id: string | null;
    section_names: string[] | null;
  }>(
    `
      SELECT
        p.code,
        p.name,
        p.group_code,
        p.activity,
        (g.code IS NOT NULL) AS group_found,
        img.image_path AS primary_image_path,
        asset.id::text AS primary_image_asset_id,
        (
          SELECT ARRAY_AGG(s.name ORDER BY s.name)
          FROM onec_catalog_product_sections ps
          JOIN onec_catalog_sections s
            ON s.version_id = ps.version_id AND s.code = ps.section_code
          WHERE ps.version_id = p.version_id
            AND ps.product_code = p.code
        ) AS section_names
      FROM onec_catalog_products p
      LEFT JOIN onec_catalog_groups g
        ON g.version_id = p.version_id AND g.code = p.group_code
      LEFT JOIN LATERAL (
        SELECT i.image_path
        FROM onec_catalog_product_images i
        WHERE i.version_id = p.version_id
          AND i.product_code = p.code
        ORDER BY i.sort_order ASC
        LIMIT 1
      ) img ON TRUE
      LEFT JOIN onec_catalog_image_assets asset
        ON asset.source_path = img.image_path AND asset.status = 'ready'
      WHERE ${whereClause}
      ORDER BY p.name ASC, p.code ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
    params,
  );

  const codes = rows.rows.map((row) => row.code);
  const propertiesByCode = new Map<
    string,
    Array<{ property_code: string; property_name: string; property_value: string }>
  >();
  if (codes.length) {
    const props = await client.query<{
      product_code: string;
      property_code: string;
      property_name: string;
      property_value: string;
    }>(
      `
        SELECT product_code, property_code, property_name, property_value
        FROM onec_catalog_product_properties
        WHERE version_id = $1::uuid AND product_code = ANY($2::text[])
      `,
      [versionId, codes],
    );
    for (const row of props.rows) {
      const list = propertiesByCode.get(row.product_code) ?? [];
      list.push(row);
      propertiesByCode.set(row.product_code, list);
    }
  }

  const items: CatalogProductListItem[] = rows.rows.map((row) => {
    const properties = propertiesByCode.get(row.code) ?? [];
    return {
      code: row.code,
      name: row.name,
      groupCode: row.group_code,
      groupStatus: mapGroupStatus(row.group_code, row.group_found),
      sectionNames: row.section_names ?? [],
      primaryImagePath: row.primary_image_path,
      primaryImageAssetId: row.primary_image_asset_id,
      article: extractArticleFromProperties(properties),
      keyProperties: selectKeyProperties(properties),
      activity: row.activity,
    };
  });

  return {
    versionId,
    query: query.q,
    sectionCode: query.sectionCode,
    propertyFilters: query.propertyFilters,
    page: query.page,
    pageSize: query.pageSize,
    total,
    items,
  };
}

export async function loadCatalogSectionsTree(
  client: PoolClient,
  versionId: string,
): Promise<CatalogSectionTreeNode[]> {
  const rows = await loadSectionRows(client, versionId);
  return buildSectionTree(rows);
}

export async function loadCatalogProductDetail(
  client: PoolClient,
  versionId: string,
  productCode: string,
): Promise<CatalogProductDetail | null> {
  const product = await client.query<{
    code: string;
    name: string;
    group_code: string | null;
    activity: string;
    group_found: boolean | null;
    imported_at: Date;
  }>(
    `
      SELECT
        p.code,
        p.name,
        p.group_code,
        p.activity,
        (g.code IS NOT NULL) AS group_found,
        v.imported_at
      FROM onec_catalog_products p
      JOIN onec_catalog_versions v ON v.id = p.version_id
      LEFT JOIN onec_catalog_groups g
        ON g.version_id = p.version_id AND g.code = p.group_code
      WHERE p.version_id = $1::uuid AND p.code = $2
      LIMIT 1
    `,
    [versionId, productCode],
  );
  const row = product.rows[0];
  if (!row) return null;

  const sections = await client.query<{ name: string }>(
    `
      SELECT s.name
      FROM onec_catalog_product_sections ps
      JOIN onec_catalog_sections s
        ON s.version_id = ps.version_id AND s.code = ps.section_code
      WHERE ps.version_id = $1::uuid AND ps.product_code = $2
      ORDER BY s.name ASC
    `,
    [versionId, productCode],
  );

  const properties = await client.query<{ property_code: string; property_name: string; property_value: string }>(
    `
      SELECT property_code, property_name, property_value
      FROM onec_catalog_product_properties
      WHERE version_id = $1::uuid AND product_code = $2
      ORDER BY property_name ASC, property_code ASC
    `,
    [versionId, productCode],
  );

  const images = await client.query<{ image_path: string }>(
    `
      SELECT image_path
      FROM onec_catalog_product_images
      WHERE version_id = $1::uuid AND product_code = $2
      ORDER BY sort_order ASC
    `,
    [versionId, productCode],
  );

  const imageAssetRows = images.rows.length
    ? await client.query<{ image_path: string; asset_id: string | null }>(
        `
          SELECT i.image_path, a.id::text AS asset_id
          FROM onec_catalog_product_images i
          LEFT JOIN onec_catalog_image_assets a
            ON a.source_path = i.image_path AND a.status = 'ready'
          WHERE i.version_id = $1::uuid AND i.product_code = $2
          ORDER BY i.sort_order ASC
        `,
        [versionId, productCode],
      )
    : { rows: [] as Array<{ image_path: string; asset_id: string | null }> };

  const propertyRows = properties.rows;
  return {
    versionId,
    code: row.code,
    name: row.name,
    groupCode: row.group_code,
    groupStatus: mapGroupStatus(row.group_code, row.group_found),
    activity: row.activity,
    sectionNames: sections.rows.map((section) => section.name),
    properties: propertyRows.map((property) => ({
      code: property.property_code,
      name: property.property_name,
      value: property.property_value,
    })),
    imagePaths: imageAssetRows.rows.map((image) => image.image_path),
    imageAssetIds: imageAssetRows.rows.map((image) => image.asset_id).filter(Boolean) as string[],
    article: extractArticleFromProperties(propertyRows),
    snapshotImportedAt: row.imported_at.toISOString(),
  };
}
