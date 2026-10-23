import type { PoolClient } from "pg";
import { tryAcquireImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import { readTargetDbIdentityFromClient } from "../../onec-exchange-v3/target-db-identity";
import { captureSeptember047048BeforeState } from "./before-state-047-048";
import type { September047048Backup } from "./backup";
import { septemberBackupSha256 } from "./backup";
import { assertExternalWriteAuthorization } from "./operator-guard";
import { SEPTEMBER_2026_SALE_MONTH_ISO } from "./scope-pins";
import { restorePgJsonRowset } from "./scoped-pg-json-snapshot";

const IMPORT_STATE_TABLES = [
  "onec_v3_legal_sales_import_state",
  "onec_v3_legal_sale_item_import_state",
  "onec_v3_legal_return_import_state",
  "onec_v3_legal_return_item_import_state",
] as const;

const IMPORT_STATE_DATASET_TABLE: Record<string, (typeof IMPORT_STATE_TABLES)[number]> = {
  sale_aggregate: "onec_v3_legal_sales_import_state",
  sale_items: "onec_v3_legal_sale_item_import_state",
  return_aggregate: "onec_v3_legal_return_import_state",
  return_items: "onec_v3_legal_return_item_import_state",
};

/** Restore scoped 047–048 state only (no 049 tables, no apply_runs, no global sequences). */
export async function restoreSeptember047048Backup(
  client: PoolClient,
  backup: September047048Backup,
): Promise<void> {
  if (backup.snapshot.v !== 2) {
    throw new Error("BACKUP_SNAPSHOT_VERSION_UNSUPPORTED");
  }
  const months = [backup.snapshot.saleMonthIso];
  await client.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_return_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_return_item_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_sales_month_activation WHERE sale_month = ANY($1::date[])`, [months]);

  await restorePgJsonRowset(client, "onec_v3_legal_sales_lines", backup.snapshot.saleAggregateLinesJson);
  await restorePgJsonRowset(client, "onec_v3_legal_sale_item_lines", backup.snapshot.saleItemLinesJson);
  await restorePgJsonRowset(client, "onec_v3_legal_return_lines", backup.snapshot.returnLinesJson);
  await restorePgJsonRowset(client, "onec_v3_legal_return_item_lines", backup.snapshot.returnItemLinesJson);
  await restorePgJsonRowset(
    client,
    "onec_v3_legal_sales_month_activation",
    backup.snapshot.monthActivationsJson,
  );

  for (const table of IMPORT_STATE_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE id = 1`);
  }
  for (const [dataset, table] of Object.entries(IMPORT_STATE_DATASET_TABLE)) {
    await client.query(
      `
        INSERT INTO ${table} (id, source_sha256, row_count, imported_at)
        SELECT 1, r.source_sha256, r.row_count, r.imported_at
        FROM json_to_recordset($1::json) AS r(
          dataset text,
          source_sha256 char(64),
          row_count integer,
          imported_at timestamptz
        )
        WHERE r.dataset = $2
      `,
      [backup.snapshot.importStatesJson, dataset],
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
