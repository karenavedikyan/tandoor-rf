import type { PoolClient } from "pg";
import { purgeCleanReloadScope } from "../onec-clean-reload/purge";

async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1::text) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

/** Revoke Bitrix client labels and retire codes without resetting sequences to 1. */
export async function revokeLegacyBitrixClientLabels(client: PoolClient): Promise<number> {
  const active = await client.query<{ label_code: string }>(
    `SELECT label_code FROM bitrix24_object_labels WHERE revoked_at IS NULL`,
  );
  for (const row of active.rows) {
    await client.query(
      `
        INSERT INTO bitrix24_label_codes_retired (label_code)
        VALUES ($1)
        ON CONFLICT (label_code) DO NOTHING
      `,
      [row.label_code],
    );
  }
  const revoked = await client.query(
    `UPDATE bitrix24_object_labels SET revoked_at = NOW() WHERE revoked_at IS NULL`,
  );
  await client.query(`DELETE FROM bitrix24_confirmed_objects`);
  await client.query(`DELETE FROM bitrix24_client_card_objects`);
  await client.query(
    `
      UPDATE bitrix24_task_bindings
      SET object_type = NULL,
          object_guid = NULL,
          label_code = NULL,
          binding_status = 'revoked',
          conflict_reason = 'exchange_v3_clean_start',
          updated_at = NOW()
      WHERE binding_status = 'confirmed'
    `,
  );
  return revoked.rowCount ?? 0;
}

export async function purgeHoldingV2Tables(client: PoolClient): Promise<void> {
  const tables = [
    "onec_holding_v2_outlet_type_category",
    "onec_holding_v2_client_type_category",
    "onec_holding_v2_outlet_links",
    "onec_holding_v2_legal_links",
    "onec_holding_v2_reconcile_runs",
    "onec_holding_v2_apply_state",
  ];
  for (const table of tables) {
    if (await tableExists(client, table)) {
      await client.query(`DELETE FROM ${table}`);
    }
  }
}

export async function purgeV3Domain(client: PoolClient): Promise<void> {
  if (await tableExists(client, "onec_v3_holding_composition")) {
    await client.query(`DELETE FROM onec_v3_holding_composition`);
  }
  if (await tableExists(client, "onec_v3_retail_outlets")) {
    await client.query(`DELETE FROM onec_v3_retail_outlets`);
  }
  if (await tableExists(client, "onec_v3_legal_entities")) {
    await client.query(`DELETE FROM onec_v3_legal_entities`);
  }
  if (await tableExists(client, "onec_v3_holdings")) {
    await client.query(`DELETE FROM onec_v3_holdings`);
  }
  if (await tableExists(client, "onec_v3_import_runs")) {
    await client.query(`DELETE FROM onec_v3_import_runs`);
  }
  if (await tableExists(client, "onec_v3_exchange_state")) {
    await client.query(
      `
        UPDATE onec_v3_exchange_state
        SET last_bundle_fingerprint = NULL,
            file_sha256 = '{}'::jsonb,
            last_successful_apply_at = NULL,
            last_attempt_at = NULL,
            apply_blocked = FALSE,
            apply_blocked_reason = NULL,
            updated_at = NOW()
        WHERE id = 1
      `,
    );
  }
}

export type CleanStartDryRunReport = {
  legacyClientsRemoved: number;
  bitrixLabelsRevoked: number;
  v3Cleared: boolean;
};

export async function runExchangeV3CleanStartPurge(client: PoolClient): Promise<CleanStartDryRunReport> {
  await purgeHoldingV2Tables(client);
  const legacy = await purgeCleanReloadScope(client);
  const bitrixLabelsRevoked = await revokeLegacyBitrixClientLabels(client);
  await purgeV3Domain(client);
  return {
    legacyClientsRemoved: legacy.clientsRemoved,
    bitrixLabelsRevoked,
    v3Cleared: true,
  };
}
