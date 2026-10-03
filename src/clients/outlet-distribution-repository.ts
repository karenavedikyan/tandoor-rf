import type { PoolClient } from "pg";

export type DistributionMarkerKind = "installed" | "planned";

export type DistributionMarkerRecord = {
  productCode: string;
  markerKind: DistributionMarkerKind;
  markedAt: string;
  markedByUserId: string;
  catalogVersionId: string | null;
  productName: string | null;
  inCurrentCatalog: boolean;
};

export type ProductDistributionState = {
  installed: boolean;
  planned: boolean;
};

function normalizeProductCode(value: string): string {
  return value.trim();
}

export async function loadProductDistributionMap(
  client: PoolClient,
  storeGuid: string,
): Promise<Map<string, ProductDistributionState>> {
  const rows = await client.query<{ product_code: string; marker_kind: DistributionMarkerKind }>(
    `
      SELECT product_code, marker_kind
      FROM outlet_distribution_markers
      WHERE guid_store = $1::uuid AND is_active = TRUE
    `,
    [storeGuid],
  );
  const map = new Map<string, ProductDistributionState>();
  for (const row of rows.rows) {
    const code = row.product_code.toLowerCase();
    const current = map.get(code) ?? { installed: false, planned: false };
    if (row.marker_kind === "installed") current.installed = true;
    if (row.marker_kind === "planned") current.planned = true;
    map.set(code, current);
  }
  return map;
}

export async function listDistributionMarkers(
  client: PoolClient,
  input: {
    storeGuid: string;
    markerKind?: DistributionMarkerKind;
    activeCatalogVersionId: string | null;
  },
): Promise<DistributionMarkerRecord[]> {
  const params: unknown[] = [input.storeGuid];
  let kindFilter = "";
  if (input.markerKind) {
    params.push(input.markerKind);
    kindFilter = " AND m.marker_kind = $2";
  }
  const rows = await client.query<{
    product_code: string;
    marker_kind: DistributionMarkerKind;
    marked_at: Date;
    marked_by_user_id: string;
    catalog_version_id: string | null;
    product_name: string | null;
  }>(
    `
      SELECT
        m.product_code,
        m.marker_kind,
        m.marked_at,
        m.marked_by_user_id::text,
        m.catalog_version_id::text,
        p.name AS product_name
      FROM outlet_distribution_markers m
      LEFT JOIN onec_catalog_products p
        ON p.code = m.product_code
       AND p.version_id = $${params.length + 1}::uuid
      WHERE m.guid_store = $1::uuid
        AND m.is_active = TRUE
        ${kindFilter}
      ORDER BY m.marked_at DESC, m.product_code ASC
    `,
    [...params, input.activeCatalogVersionId],
  );
  const activeCodes = new Set<string>();
  if (input.activeCatalogVersionId) {
    const active = await client.query<{ code: string }>(
      `SELECT code FROM onec_catalog_products WHERE version_id = $1::uuid`,
      [input.activeCatalogVersionId],
    );
    for (const row of active.rows) {
      activeCodes.add(row.code.toLowerCase());
    }
  }
  return rows.rows.map((row) => ({
    productCode: row.product_code,
    markerKind: row.marker_kind,
    markedAt: row.marked_at.toISOString(),
    markedByUserId: row.marked_by_user_id,
    catalogVersionId: row.catalog_version_id,
    productName: row.product_name,
    inCurrentCatalog: activeCodes.has(row.product_code.toLowerCase()),
  }));
}

export async function upsertDistributionMarker(
  client: PoolClient,
  input: {
    storeGuid: string;
    cardGuid: string;
    productCode: string;
    markerKind: DistributionMarkerKind;
    actorUserId: string;
    catalogVersionId: string | null;
  },
): Promise<{ changed: boolean; markerId: string }> {
  const productCode = normalizeProductCode(input.productCode);
  const existing = await client.query<{ id: string; is_active: boolean }>(
    `
      SELECT id::text, is_active
      FROM outlet_distribution_markers
      WHERE guid_store = $1::uuid
        AND product_code = $2
        AND marker_kind = $3
      LIMIT 1
    `,
    [input.storeGuid, productCode, input.markerKind],
  );
  const row = existing.rows[0];
  if (row?.is_active) {
    return { changed: false, markerId: row.id };
  }

  const upsert = await client.query<{ id: string }>(
    `
      INSERT INTO outlet_distribution_markers (
        guid_store, guid_client, product_code, marker_kind, is_active,
        marked_by_user_id, marked_at, catalog_version_id
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, TRUE, $5::uuid, NOW(), $6::uuid)
      ON CONFLICT (guid_store, product_code, marker_kind)
      DO UPDATE SET
        is_active = TRUE,
        marked_by_user_id = EXCLUDED.marked_by_user_id,
        marked_at = NOW(),
        catalog_version_id = EXCLUDED.catalog_version_id
      RETURNING id::text
    `,
    [
      input.storeGuid,
      input.cardGuid,
      productCode,
      input.markerKind,
      input.actorUserId,
      input.catalogVersionId,
    ],
  );
  const markerId = upsert.rows[0]!.id;
  await client.query(
    `
      INSERT INTO outlet_distribution_marker_events (
        marker_id, guid_store, guid_client, product_code, marker_kind,
        event_kind, catalog_version_id, actor_user_id
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'set', $6::uuid, $7::uuid)
    `,
    [
      markerId,
      input.storeGuid,
      input.cardGuid,
      productCode,
      input.markerKind,
      input.catalogVersionId,
      input.actorUserId,
    ],
  );
  return { changed: true, markerId };
}

export async function clearDistributionMarker(
  client: PoolClient,
  input: {
    storeGuid: string;
    cardGuid: string;
    productCode: string;
    markerKind: DistributionMarkerKind;
    actorUserId: string;
    catalogVersionId: string | null;
  },
): Promise<{ changed: boolean }> {
  const productCode = normalizeProductCode(input.productCode);
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM outlet_distribution_markers
      WHERE guid_store = $1::uuid
        AND product_code = $2
        AND marker_kind = $3
        AND is_active = TRUE
      LIMIT 1
    `,
    [input.storeGuid, productCode, input.markerKind],
  );
  const markerId = existing.rows[0]?.id;
  if (!markerId) {
    return { changed: false };
  }
  await client.query(
    `
      UPDATE outlet_distribution_markers
      SET is_active = FALSE
      WHERE id = $1::uuid
    `,
    [markerId],
  );
  await client.query(
    `
      INSERT INTO outlet_distribution_marker_events (
        marker_id, guid_store, guid_client, product_code, marker_kind,
        event_kind, catalog_version_id, actor_user_id
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'clear', $6::uuid, $7::uuid)
    `,
    [
      markerId,
      input.storeGuid,
      input.cardGuid,
      productCode,
      input.markerKind,
      input.catalogVersionId,
      input.actorUserId,
    ],
  );
  return { changed: true };
}

export function attachDistributionToCatalogItems<T extends { code: string }>(
  items: T[],
  distributionMap: Map<string, ProductDistributionState>,
): Array<T & { distribution: ProductDistributionState }> {
  return items.map((item) => {
    const state = distributionMap.get(item.code.toLowerCase()) ?? {
      installed: false,
      planned: false,
    };
    return { ...item, distribution: state };
  });
}
