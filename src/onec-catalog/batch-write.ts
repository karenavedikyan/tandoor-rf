import type { PoolClient } from "pg";

const DEFAULT_BATCH_SIZE = 500;

async function insertRows(
  client: PoolClient,
  columns: string,
  columnCount: number,
  rows: unknown[][],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    if (chunk.length === 0) continue;
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, rowIndex) => {
        const base = rowIndex * columnCount;
        values.push(...row);
        const params = Array.from({ length: columnCount }, (_, colIndex) => `$${base + colIndex + 1}`);
        return `(${params.join(", ")})`;
      })
      .join(", ");
    await client.query(`INSERT INTO ${columns} VALUES ${placeholders}`, values);
  }
}

export async function insertCatalogProductPropertiesBatch(
  client: PoolClient,
  versionId: string,
  rows: Array<[string, string, string, string]>,
): Promise<void> {
  if (rows.length === 0) return;
  await insertRows(
    client,
    `onec_catalog_product_properties
       (version_id, product_code, property_code, property_name, property_value)`,
    5,
    rows.map((row) => [versionId, ...row]),
  );
}

export async function insertCatalogProductImagesBatch(
  client: PoolClient,
  versionId: string,
  rows: Array<[string, string, number]>,
): Promise<void> {
  if (rows.length === 0) return;
  await insertRows(
    client,
    `onec_catalog_product_images (version_id, product_code, image_path, sort_order)`,
    4,
    rows.map((row) => [versionId, ...row]),
  );
}

export async function insertCatalogProductSectionsBatch(
  client: PoolClient,
  versionId: string,
  rows: Array<[string, string]>,
): Promise<void> {
  if (rows.length === 0) return;
  await insertRows(
    client,
    `onec_catalog_product_sections (version_id, product_code, section_code)`,
    3,
    rows.map((row) => [versionId, ...row]),
  );
}

export async function insertCatalogPricesStagingBatch(
  client: PoolClient,
  versionId: string,
  rows: Array<[string, string, string, string | null, boolean, string | null]>,
): Promise<void> {
  if (rows.length === 0) return;
  await insertRows(
    client,
    `onec_catalog_prices_staging
       (version_id, price_type_code, product_code, price_raw, price_numeric, quarantined, quarantine_reason)`,
    7,
    rows.map((row) => [versionId, ...row]),
  );
}

export async function insertCatalogStockStagingBatch(
  client: PoolClient,
  versionId: string,
  rows: Array<[string, string, string, string | null, boolean, string | null]>,
): Promise<void> {
  if (rows.length === 0) return;
  await insertRows(
    client,
    `onec_catalog_stock_staging
       (version_id, product_code, storage_code, quantity_raw, quantity_numeric, quarantined, quarantine_reason)`,
    7,
    rows.map((row) => [versionId, ...row]),
  );
}

export async function insertCatalogStockExpectedStagingBatch(
  client: PoolClient,
  versionId: string,
  rows: Array<
    [string, string, string, string | null, string | null, string | null, boolean, string | null, boolean, string | null]
  >,
): Promise<void> {
  if (rows.length === 0) return;
  await insertRows(
    client,
    `onec_catalog_stock_expected_staging
       (version_id, product_code, storage_code, quantity_raw, quantity_numeric,
        expected_date_raw, expected_at, expected_expired, available_raw, quarantined, quarantine_reason)`,
    11,
    rows.map((row) => [versionId, ...row]),
  );
}
