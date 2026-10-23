import type { PoolClient } from "pg";
import { tryAcquireImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import { readTargetDbIdentityFromClient } from "../../onec-exchange-v3/target-db-identity";
import { captureSeptember047048BeforeState } from "./before-state-047-048";
import type { September047048Backup } from "./backup";
import { septemberBackupSha256 } from "./backup";
import { assertExternalWriteAuthorization } from "./operator-guard";
import { SEPTEMBER_2026_SALE_MONTH_ISO } from "./scope-pins";

const IMPORT_STATE_TABLES = [
  "onec_v3_legal_sales_import_state",
  "onec_v3_legal_sale_item_import_state",
  "onec_v3_legal_return_import_state",
  "onec_v3_legal_return_item_import_state",
] as const;

/** Restore scoped 047–048 state only (no 049 tables, no apply_runs). */
export async function restoreSeptember047048Backup(
  client: PoolClient,
  backup: September047048Backup,
): Promise<void> {
  const months = [backup.snapshot.saleMonthIso];
  await client.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_return_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_return_item_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_sales_month_activation WHERE sale_month = ANY($1::date[])`, [months]);

  for (const row of backup.snapshot.saleAggregateLines as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        )
        VALUES (
          $1::uuid, $2::date, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric,
          $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13, $14::timestamptz
        )
      `,
      [
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.quantity,
        row.income,
        row.manual_discount,
        row.automatic_discount,
        row.total_discount,
        row.cost_price,
        row.additional_expenses,
        row.gross_profit,
        row.profitability,
        row.source_sha256,
        row.imported_at,
      ],
    );
  }

  for (const row of backup.snapshot.saleItemLines as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sale_item_lines (
          source_sha256, source_row_index, legal_guid, sale_month, product_type,
          guid_item, name_item, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          catalog_matched, imported_at
        )
        VALUES (
          $1, $2, $3::uuid, $4::date, $5, $6::uuid, $7, $8::numeric, $9::numeric,
          $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
          $17, $18::timestamptz
        )
      `,
      [
        row.source_sha256,
        row.source_row_index,
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.guid_item,
        row.name_item,
        row.quantity,
        row.income,
        row.manual_discount,
        row.automatic_discount,
        row.total_discount,
        row.cost_price,
        row.additional_expenses,
        row.gross_profit,
        row.profitability,
        row.catalog_matched,
        row.imported_at,
      ],
    );
  }

  for (const row of backup.snapshot.returnLines as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_return_lines (
          source_sha256, source_row_index, legal_guid, sale_month, product_type,
          quantity, income, catalog_matched, imported_at
        )
        VALUES ($1, $2, $3::uuid, $4::date, $5, $6::numeric, $7::numeric, $8, $9::timestamptz)
      `,
      [
        row.source_sha256,
        row.source_row_index,
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.quantity,
        row.income,
        row.catalog_matched,
        row.imported_at,
      ],
    );
  }

  for (const row of backup.snapshot.returnItemLines as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_return_item_lines (
          source_sha256, source_row_index, legal_guid, sale_month, product_type,
          guid_item, name_item, quantity, income, catalog_matched, imported_at
        )
        VALUES ($1, $2, $3::uuid, $4::date, $5, $6::uuid, $7, $8::numeric, $9::numeric, $10, $11::timestamptz)
      `,
      [
        row.source_sha256,
        row.source_row_index,
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.guid_item,
        row.name_item,
        row.quantity,
        row.income,
        row.catalog_matched,
        row.imported_at,
      ],
    );
  }

  for (const table of IMPORT_STATE_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE id = 1`);
  }

  for (const row of backup.snapshot.importStates as {
    dataset: string;
    source_sha256: string;
    row_count: string;
    imported_at: string;
  }[]) {
    const table =
      row.dataset === "sale_aggregate"
        ? "onec_v3_legal_sales_import_state"
        : row.dataset === "sale_items"
          ? "onec_v3_legal_sale_item_import_state"
          : row.dataset === "return_aggregate"
            ? "onec_v3_legal_return_import_state"
            : "onec_v3_legal_return_item_import_state";
    await client.query(
      `
        INSERT INTO ${table} (id, source_sha256, row_count, imported_at)
        VALUES (1, $1, $2::int, $3::timestamptz)
        ON CONFLICT (id) DO UPDATE SET
          source_sha256 = EXCLUDED.source_sha256,
          row_count = EXCLUDED.row_count,
          imported_at = EXCLUDED.imported_at
      `,
      [row.source_sha256, row.row_count, row.imported_at],
    );
  }

  for (const row of backup.snapshot.monthActivations as {
    dataset: string;
    sale_month: string;
    source_sha256: string;
    activated_at: string;
  }[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_month_activation (dataset, sale_month, source_sha256, activated_at)
        VALUES ($1, $2::date, $3, $4::timestamptz)
        ON CONFLICT (dataset, sale_month) DO UPDATE SET
          source_sha256 = EXCLUDED.source_sha256,
          activated_at = EXCLUDED.activated_at
      `,
      [row.dataset, row.sale_month, row.source_sha256, row.activated_at],
    );
  }
}

export async function executeSeptember2026Rollback(input: {
  databaseUrl: string;
  backup: September047048Backup;
  expectedBackupSha256: string;
  externalAuthorizationRef: string;
  /** When set, live scoped digest must match (post-apply guard). */
  expectedLiveAfterStateSha256?: string;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const auth = assertExternalWriteAuthorization();
  if (!auth.ok) return auth;
  if (auth.ref !== input.externalAuthorizationRef) {
    return { ok: false, code: "EXTERNAL_AUTHORIZATION_MISMATCH", message: "Authorization ref mismatch." };
  }
  const computedSha = septemberBackupSha256(input.backup);
  if (computedSha !== input.expectedBackupSha256) {
    return { ok: false, code: "BACKUP_SHA_MISMATCH", message: "Backup SHA mismatch." };
  }
  if (input.backup.snapshot.saleMonthIso !== SEPTEMBER_2026_SALE_MONTH_ISO) {
    return { ok: false, code: "ROLLBACK_SCOPE_MISMATCH", message: "Backup month outside September 2026 scope." };
  }

  const pool = createImportPool(input.databaseUrl);
  const client = await pool.connect();
  try {
    const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
    if (identity.fingerprint !== input.backup.targetDbFingerprint) {
      return { ok: false, code: "TARGET_FINGERPRINT_MISMATCH", message: "Live DB fingerprint mismatch." };
    }
    const live = await captureSeptember047048BeforeState(client);
    if (input.expectedLiveAfterStateSha256) {
      if (live.digest !== input.expectedLiveAfterStateSha256) {
        return { ok: false, code: "LIVE_AFTER_DRIFT", message: "Live after-state digest drift." };
      }
    }

    await client.query("BEGIN");
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      return { ok: false, code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    await restoreSeptember047048Backup(client, input.backup);
    const after = await captureSeptember047048BeforeState(client);
    if (after.digest !== input.backup.beforeStateSha256) {
      await client.query("ROLLBACK");
      return { ok: false, code: "ROLLBACK_VERIFY_FAILED", message: "Restored state digest mismatch." };
    }
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    return { ok: false, code: "ROLLBACK_FAILED", message: e instanceof Error ? e.message : "Rollback failed." };
  } finally {
    client.release();
    await pool.end();
  }
}
