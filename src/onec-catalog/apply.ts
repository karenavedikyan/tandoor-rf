import { Pool, type PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { createPgPoolOptions } from "../config/pg-ssl";
import { parseCatalogDecimal } from "./decimal";
import { parseExpectedDate } from "./dates";
import { QUARANTINE_REASON } from "./constants";
import { releaseCatalogImportLock, tryAcquireCatalogImportLock } from "./import-lock";
import type { ParsedCatalogSet, QuarantineEntry } from "./types";

export type CatalogApplyResult =
  | {
      ok: true;
      runId: string;
      versionId: string;
      coreApplied: true;
      commercialReady: false;
      quarantineCount: number;
      newProducts: number;
      changedProducts: number;
      missingFromSnapshot: number;
    }
  | {
      ok: false;
      code:
        | "IMPORT_LOCKED"
        | "SKIPPED_UNCHANGED"
        | "RECORD_COUNT_DECREASED"
        | "PRODUCT_CODE_LOSS"
        | "DATABASE_ERROR"
        | "COMMIT_UNCERTAIN";
      message: string;
      runId?: string;
    };

function classifyPriceRow(
  data: ParsedCatalogSet,
  row: ParsedCatalogSet["prices"][number],
): { quarantined: boolean; reason: string | null; numeric: string | null } {
  const productCodes = new Set(data.products.map((p) => p.code));
  const priceTypeCodes = new Set(data.priceTypes.map((p) => p.priceTypeCode));
  if (!priceTypeCodes.has(row.priceTypeCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.UNKNOWN_PRICE_TYPE, numeric: null };
  }
  if (!productCodes.has(row.productCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_PRODUCT, numeric: null };
  }
  const parsed = parseCatalogDecimal(row.priceRaw);
  if (!parsed.ok) {
    return { quarantined: true, reason: QUARANTINE_REASON.INVALID_DECIMAL, numeric: null };
  }
  return { quarantined: false, reason: null, numeric: parsed.numeric };
}

function classifyStockRow(
  data: ParsedCatalogSet,
  row: ParsedCatalogSet["stock"][number],
): { quarantined: boolean; reason: string | null; numeric: string | null } {
  const productCodes = new Set(data.products.map((p) => p.code));
  const storageCodes = new Set(data.storages.map((p) => p.code));
  if (!productCodes.has(row.productCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_PRODUCT, numeric: null };
  }
  if (!storageCodes.has(row.storageCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_STORAGE, numeric: null };
  }
  if (row.quantityRaw.trim() === "") {
    return { quarantined: false, reason: null, numeric: null };
  }
  const parsed = parseCatalogDecimal(row.quantityRaw);
  if (!parsed.ok) {
    return { quarantined: true, reason: QUARANTINE_REASON.INVALID_DECIMAL, numeric: null };
  }
  return { quarantined: false, reason: null, numeric: parsed.numeric };
}

function classifyStockExpectedRow(
  data: ParsedCatalogSet,
  row: ParsedCatalogSet["stockExpected"][number],
  now: Date,
): {
  quarantined: boolean;
  reason: string | null;
  numeric: string | null;
  expectedAt: string | null;
  expectedExpired: boolean;
} {
  const productCodes = new Set(data.products.map((p) => p.code));
  const storageCodes = new Set(data.storages.map((p) => p.code));
  if (!productCodes.has(row.productCode)) {
    return {
      quarantined: true,
      reason: QUARANTINE_REASON.MISSING_PRODUCT,
      numeric: null,
      expectedAt: null,
      expectedExpired: false,
    };
  }
  if (!storageCodes.has(row.storageCode)) {
    return {
      quarantined: true,
      reason: QUARANTINE_REASON.MISSING_STORAGE,
      numeric: null,
      expectedAt: null,
      expectedExpired: false,
    };
  }
  let expectedAt: string | null = null;
  let expectedExpired = false;
  if (row.expectedDateRaw) {
    const parsedDate = parseExpectedDate(row.expectedDateRaw, now);
    if (!parsedDate.ok) {
      return {
        quarantined: true,
        reason: QUARANTINE_REASON.INVALID_DATE,
        numeric: null,
        expectedAt: null,
        expectedExpired: false,
      };
    }
    expectedAt = parsedDate.iso;
    expectedExpired = parsedDate.expired;
  }
  if (row.quantityRaw.trim() === "") {
    return { quarantined: false, reason: null, numeric: null, expectedAt, expectedExpired };
  }
  const parsed = parseCatalogDecimal(row.quantityRaw);
  if (!parsed.ok) {
    return {
      quarantined: true,
      reason: QUARANTINE_REASON.INVALID_DECIMAL,
      numeric: null,
      expectedAt,
      expectedExpired,
    };
  }
  return {
    quarantined: false,
    reason: null,
    numeric: parsed.numeric,
    expectedAt,
    expectedExpired,
  };
}

async function getActiveProductCodes(client: PoolClient): Promise<Set<string>> {
  const active = await client.query<{ active_version_id: string | null }>(
    "SELECT active_version_id FROM onec_catalog_state WHERE id = 1",
  );
  const versionId = active.rows[0]?.active_version_id;
  if (!versionId) return new Set();
  const rows = await client.query<{ code: string }>(
    "SELECT code FROM onec_catalog_products WHERE version_id = $1::uuid",
    [versionId],
  );
  return new Set(rows.rows.map((row) => row.code));
}

export async function applyCatalogImport(
  databaseUrl: string,
  data: ParsedCatalogSet,
  triggerSource: "manual" | "operator_job" = "manual",
): Promise<CatalogApplyResult> {
  const pool = new Pool({ ...createPgPoolOptions(databaseUrl), connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let lockHeld = false;
  let runId: string | undefined;
  let commitAttempted = false;

  try {
    const locked = await tryAcquireCatalogImportLock(client);
    if (!locked) {
      return { ok: false, code: "IMPORT_LOCKED", message: "Another catalog import is in progress." };
    }
    lockHeld = true;

    const existing = await client.query<{ id: string }>(
      "SELECT id FROM onec_catalog_versions WHERE manifest_sha256 = $1 LIMIT 1",
      [data.manifest.manifestSha256],
    );
    if (existing.rows[0]?.id) {
      return {
        ok: false,
        code: "SKIPPED_UNCHANGED",
        message: "Catalog manifest already applied; no duplicate version created.",
      };
    }

    const activeState = await client.query<{ active_version_id: string | null }>(
      "SELECT active_version_id FROM onec_catalog_state WHERE id = 1",
    );
    const previousVersionId = activeState.rows[0]?.active_version_id ?? null;
    const previousCodes = await getActiveProductCodes(client);
    let previousProductMap = new Map<
      string,
      { name: string; group_code: string | null; activity: string }
    >();
    if (previousVersionId) {
      const previousDetails = await client.query<{
        code: string;
        name: string;
        group_code: string | null;
        activity: string;
      }>(
        `SELECT code, name, group_code, activity
         FROM onec_catalog_products
         WHERE version_id = $1::uuid`,
        [previousVersionId],
      );
      previousProductMap = new Map(previousDetails.rows.map((row) => [row.code, row]));
    }
    const incomingCodes = new Set(data.products.map((row) => row.code));
    if (previousCodes.size > 0) {
      if (data.products.length < previousCodes.size) {
        return {
          ok: false,
          code: "RECORD_COUNT_DECREASED",
          message: "Product count decreased compared to active catalog version.",
        };
      }
      for (const code of previousCodes) {
        if (!incomingCodes.has(code)) {
          return {
            ok: false,
            code: "PRODUCT_CODE_LOSS",
            message: `Previously known product code missing from snapshot: ${code}.`,
          };
        }
      }
    }

    const runInsert = await client.query<{ id: string }>(
      `INSERT INTO onec_catalog_import_runs (status, mode, trigger_source, manifest_sha256, source_byte_size)
       VALUES ('running', 'apply', $1, $2, $3)
       RETURNING id`,
      [triggerSource, data.manifest.manifestSha256, data.manifest.totalByteSize],
    );
    runId = runInsert.rows[0]!.id;

    await client.query("BEGIN");

    const versionInsert = await client.query<{ id: string }>(
      `INSERT INTO onec_catalog_versions (manifest_sha256, product_count, is_active)
       VALUES ($1, $2, FALSE)
       RETURNING id`,
      [data.manifest.manifestSha256, data.products.length],
    );
    const versionId = versionInsert.rows[0]!.id;

    for (const group of data.groups) {
      await client.query(
        `INSERT INTO onec_catalog_groups (version_id, code, parent_code)
         VALUES ($1::uuid, $2, $3)`,
        [versionId, group.code, group.parentCode],
      );
    }
    for (const section of data.sections) {
      await client.query(
        `INSERT INTO onec_catalog_sections (version_id, code, name, parent_code)
         VALUES ($1::uuid, $2, $3, $4)`,
        [versionId, section.code, section.name, section.parentCode],
      );
    }
    for (const storage of data.storages) {
      await client.query(
        `INSERT INTO onec_catalog_storages (version_id, code, name, address, email, phone)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
        [versionId, storage.code, storage.name, storage.address, storage.email, storage.phone],
      );
    }
    for (const priceType of data.priceTypes) {
      await client.query(
        `INSERT INTO onec_catalog_price_types (version_id, price_type_code, name)
         VALUES ($1::uuid, $2, $3)`,
        [versionId, priceType.priceTypeCode, priceType.name],
      );
    }
    for (const product of data.products) {
      await client.query(
        `INSERT INTO onec_catalog_products (version_id, code, group_code, activity, name, present_in_snapshot)
         VALUES ($1::uuid, $2, $3, $4, $5, TRUE)`,
        [versionId, product.code, product.groupCode, product.activity, product.name],
      );
      for (const [index, imagePath] of product.images.entries()) {
        await client.query(
          `INSERT INTO onec_catalog_product_images (version_id, product_code, image_path, sort_order)
           VALUES ($1::uuid, $2, $3, $4)`,
          [versionId, product.code, imagePath, index],
        );
      }
      for (const property of product.properties) {
        await client.query(
          `INSERT INTO onec_catalog_product_properties
             (version_id, product_code, property_code, property_name, property_value)
           VALUES ($1::uuid, $2, $3, $4, $5)`,
          [versionId, product.code, property.code, property.name, property.value],
        );
      }
      for (const sectionCode of product.sectionCodes) {
        await client.query(
          `INSERT INTO onec_catalog_product_sections (version_id, product_code, section_code)
           VALUES ($1::uuid, $2, $3)`,
          [versionId, product.code, sectionCode],
        );
      }
      await client.query(
        `INSERT INTO onec_catalog_product_presence (version_id, product_code, present_in_snapshot)
         VALUES ($1::uuid, $2, TRUE)
         ON CONFLICT (version_id, product_code) DO UPDATE SET present_in_snapshot = EXCLUDED.present_in_snapshot`,
        [versionId, product.code],
      );
    }

    const now = new Date();
    let quarantineCount = 0;
    const quarantineRows: QuarantineEntry[] = [...data.quarantine];

    for (const price of data.prices) {
      const classified = classifyPriceRow(data, price);
      if (classified.quarantined) quarantineCount += 1;
      await client.query(
        `INSERT INTO onec_catalog_prices_staging
           (version_id, price_type_code, product_code, price_raw, price_numeric, quarantined, quarantine_reason)
         VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6, $7)`,
        [
          versionId,
          price.priceTypeCode,
          price.productCode,
          price.priceRaw,
          classified.numeric,
          classified.quarantined,
          classified.reason,
        ],
      );
    }
    for (const line of data.stock) {
      const classified = classifyStockRow(data, line);
      if (classified.quarantined) quarantineCount += 1;
      await client.query(
        `INSERT INTO onec_catalog_stock_staging
           (version_id, product_code, storage_code, quantity_raw, quantity_numeric, quarantined, quarantine_reason)
         VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6, $7)`,
        [
          versionId,
          line.productCode,
          line.storageCode,
          line.quantityRaw,
          classified.numeric,
          classified.quarantined,
          classified.reason,
        ],
      );
    }
    for (const line of data.stockExpected) {
      const classified = classifyStockExpectedRow(data, line, now);
      if (classified.quarantined) quarantineCount += 1;
      await client.query(
        `INSERT INTO onec_catalog_stock_expected_staging
           (version_id, product_code, storage_code, quantity_raw, quantity_numeric,
            expected_date_raw, expected_at, expected_expired, available_raw, quarantined, quarantine_reason)
         VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6, $7::timestamptz, $8, $9, $10, $11)`,
        [
          versionId,
          line.productCode,
          line.storageCode,
          line.quantityRaw,
          classified.numeric,
          line.expectedDateRaw,
          classified.expectedAt,
          classified.expectedExpired,
          line.availableRaw,
          classified.quarantined,
          classified.reason,
        ],
      );
    }

    for (const entry of quarantineRows) {
      await client.query(
        `INSERT INTO onec_catalog_quarantine (version_id, layer, reason_code, source_identifiers)
         VALUES ($1::uuid, $2, $3, $4::jsonb)`,
        [versionId, entry.layer, entry.reasonCode, JSON.stringify(entry.sourceIdentifiers)],
      );
    }

    await client.query(
      "UPDATE onec_catalog_versions SET is_active = FALSE WHERE is_active = TRUE",
    );
    await client.query(
      "UPDATE onec_catalog_versions SET is_active = TRUE WHERE id = $1::uuid",
      [versionId],
    );
    await client.query(
      `UPDATE onec_catalog_state
       SET active_version_id = $1::uuid,
           last_successful_manifest_sha256 = $2,
           updated_at = NOW()
       WHERE id = 1`,
      [versionId, data.manifest.manifestSha256],
    );

    let newProducts = 0;
    let changedProducts = 0;
    for (const product of data.products) {
      const prev = previousProductMap.get(product.code);
      if (!prev) {
        newProducts += 1;
        continue;
      }
      if (
        prev.name !== product.name ||
        (prev.group_code ?? null) !== product.groupCode ||
        prev.activity !== product.activity
      ) {
        changedProducts += 1;
      }
    }

    const report = {
      manifestSha256: data.manifest.manifestSha256,
      counts: data.counts,
      quarantineCount,
      commercialReady: false,
      coreApplied: true,
    };

    await client.query(
      `UPDATE onec_catalog_import_runs
       SET finished_at = NOW(),
           status = $2,
           core_applied = TRUE,
           commercial_ready = FALSE,
           applied_version_id = $3::uuid,
           product_count = $4,
           quarantine_count = $5,
           report = $6::jsonb
       WHERE id = $1::uuid`,
      [
        runId,
        quarantineCount > 0 ? "partial" : "success",
        versionId,
        data.products.length,
        quarantineCount,
        JSON.stringify(report),
      ],
    );

    commitAttempted = true;
    await client.query("COMMIT");

    return {
      ok: true,
      runId,
      versionId,
      coreApplied: true,
      commercialReady: false,
      quarantineCount,
      newProducts,
      changedProducts,
      missingFromSnapshot: 0,
    };
  } catch {
    if (commitAttempted) {
      return { ok: false, code: "COMMIT_UNCERTAIN", message: "Catalog apply commit outcome uncertain.", runId };
    }
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    if (runId) {
      await client.query(
        `UPDATE onec_catalog_import_runs
         SET finished_at = NOW(), status = 'failed', error_code = 'DATABASE_ERROR'
         WHERE id = $1::uuid`,
        [runId],
      );
    }
    return { ok: false, code: "DATABASE_ERROR", message: "Catalog apply failed." };
  } finally {
    if (lockHeld) {
      try {
        await releaseCatalogImportLock(client);
        client.release();
      } catch {
        client.release(true);
      }
    } else {
      client.release();
    }
    await pool.end();
  }
}

export function resolveCatalogDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || getDatabaseUrl();
}
