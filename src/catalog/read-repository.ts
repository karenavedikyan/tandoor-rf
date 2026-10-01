import type { PoolClient } from "pg";
import type {
  CatalogGroupStatus,
  CatalogProductDetail,
  CatalogProductListItem,
  CatalogProductSearchResult,
  CatalogSectionOption,
  CatalogSnapshotMeta,
} from "./types";
import type { ParsedCatalogSearchQuery } from "./query-params";

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
  const params: unknown[] = [versionId];
  const filters: string[] = ["p.version_id = $1::uuid"];

  if (query.q) {
    params.push(`%${query.q}%`);
    const qIndex = params.length;
    filters.push(`(p.name ILIKE $${qIndex} OR p.code ILIKE $${qIndex})`);
  }

  if (query.sectionCode) {
    params.push(query.sectionCode);
    const sectionIndex = params.length;
    filters.push(
      `EXISTS (
         SELECT 1
         FROM onec_catalog_product_sections ps
         WHERE ps.version_id = p.version_id
           AND ps.product_code = p.code
           AND ps.section_code = $${sectionIndex}
       )`,
    );
  }

  const whereClause = filters.join(" AND ");
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
    section_names: string[] | null;
  }>(
    `
      SELECT
        p.code,
        p.name,
        p.group_code,
        p.activity,
        (g.code IS NOT NULL) AS group_found,
        (
          SELECT i.image_path
          FROM onec_catalog_product_images i
          WHERE i.version_id = p.version_id
            AND i.product_code = p.code
          ORDER BY i.sort_order ASC
          LIMIT 1
        ) AS primary_image_path,
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
      WHERE ${whereClause}
      ORDER BY p.name ASC, p.code ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
    params,
  );

  const items: CatalogProductListItem[] = rows.rows.map((row) => ({
    code: row.code,
    name: row.name,
    groupCode: row.group_code,
    groupStatus: mapGroupStatus(row.group_code, row.group_found),
    sectionNames: row.section_names ?? [],
    primaryImagePath: row.primary_image_path,
    activity: row.activity,
  }));

  return {
    versionId,
    query: query.q,
    sectionCode: query.sectionCode,
    page: query.page,
    pageSize: query.pageSize,
    total,
    items,
  };
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

  return {
    versionId,
    code: row.code,
    name: row.name,
    groupCode: row.group_code,
    groupStatus: mapGroupStatus(row.group_code, row.group_found),
    activity: row.activity,
    sectionNames: sections.rows.map((section) => section.name),
    properties: properties.rows.map((property) => ({
      code: property.property_code,
      name: property.property_name,
      value: property.property_value,
    })),
    imagePaths: images.rows.map((image) => image.image_path),
    snapshotImportedAt: row.imported_at.toISOString(),
  };
}
