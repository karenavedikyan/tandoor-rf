import type { PoolClient } from "pg";

async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1::text) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

export type LegacyClientPurgePlan = {
  onecClients: number;
  onecRetailOutlets: number;
  accessGrantsClient: number;
  clientReviewRecords: number;
  holdingV2LegalLinks: number;
  importJobs: number;
};

/** SELECT-only counts for dry-run (no mutations). */
export async function countLegacyClientScope(client: PoolClient): Promise<LegacyClientPurgePlan> {
  const onecClients = Number(
    (await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_clients`)).rows[0]?.count ?? "0",
  );
  const onecRetailOutlets = Number(
    (await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_retail_outlets`)).rows[0]?.count ??
      "0",
  );
  const accessGrantsClient = Number(
    (
      await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM access_grants WHERE grant_type = 'client'`,
      )
    ).rows[0]?.count ?? "0",
  );
  let clientReviewRecords = 0;
  if (await tableExists(client, "client_review_records")) {
    clientReviewRecords = Number(
      (await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM client_review_records`)).rows[0]
        ?.count ?? "0",
    );
  }
  let holdingV2LegalLinks = 0;
  if (await tableExists(client, "onec_holding_v2_legal_links")) {
    holdingV2LegalLinks = Number(
      (await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_holding_v2_legal_links`)).rows[0]
        ?.count ?? "0",
    );
  }
  const importJobs = Number(
    (await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_import_jobs`)).rows[0]?.count ?? "0",
  );
  return {
    onecClients,
    onecRetailOutlets,
    accessGrantsClient,
    clientReviewRecords,
    holdingV2LegalLinks,
    importJobs,
  };
}

export type LegacyClientPurgeResult = LegacyClientPurgePlan & {
  accessGrantsRemoved: number;
};

/**
 * Removes legacy client domain only. Preserves users, sessions, employee roster, team memberships, catalog.
 */
export async function purgeLegacyClientDomain(client: PoolClient): Promise<LegacyClientPurgeResult> {
  const before = await countLegacyClientScope(client);
  let accessGrantsRemoved = 0;

  const orphanStatements = [
    `DELETE FROM access_grants WHERE grant_type = 'client'`,
    `DELETE FROM access_denials WHERE scope_type = 'client'`,
    `DELETE FROM delegation_clients`,
    `DELETE FROM delegation_change_request_clients`,
    `DELETE FROM bitrix24_manual_sync_card_cooldown`,
    `DELETE FROM bitrix24_client_card_objects`,
    `DELETE FROM outlet_distribution_marker_events`,
  ];
  for (const statement of orphanStatements) {
    const result = await client.query(statement);
    if (statement.includes("access_grants")) {
      accessGrantsRemoved = result.rowCount ?? 0;
    }
  }

  if (await tableExists(client, "outlet_distribution_markers")) {
    await client.query(`DELETE FROM outlet_distribution_markers`);
  }
  if (await tableExists(client, "client_review_history")) {
    await client.query(`DELETE FROM client_review_history`);
  }
  if (await tableExists(client, "client_review_records")) {
    await client.query(`DELETE FROM client_review_records`);
  }

  const holdingV2Tables = [
    "onec_holding_v2_outlet_type_category",
    "onec_holding_v2_client_type_category",
    "onec_holding_v2_outlet_links",
    "onec_holding_v2_legal_links",
    "onec_holding_v2_reconcile_runs",
  ];
  for (const table of holdingV2Tables) {
    if (await tableExists(client, table)) {
      await client.query(`DELETE FROM ${table}`);
    }
  }
  if (await tableExists(client, "onec_holding_v2_apply_state")) {
    await client.query(
      `UPDATE onec_holding_v2_apply_state SET last_normalized_state_sha256 = NULL, last_source_sha256 = NULL, last_applied_at = NULL WHERE id = 1`,
    );
  }

  await client.query(`DELETE FROM onec_import_jobs`);
  await client.query(`DELETE FROM onec_client_quarantine_records`);
  await client.query(`DELETE FROM onec_baseline_replacement_runs`);
  await client.query(`DELETE FROM onec_extended_contract_confirmations`);
  await client.query(`DELETE FROM onec_client_import_runs`);
  await client.query(`DELETE FROM onec_retail_outlets`);
  await client.query(`DELETE FROM onec_clients`);

  await client.query(
    `
      UPDATE onec_exchange_state
      SET last_checked_at = NULL,
          last_checked_sha256 = NULL,
          last_successful_apply_at = NULL,
          last_successful_apply_sha256 = NULL,
          accepted_baseline_sha256 = NULL,
          last_source_modified_at = NULL,
          last_attempt_at = NULL,
          last_verified_at = NULL,
          last_verified_sha256 = NULL,
          apply_blocked = FALSE,
          apply_blocked_reason = NULL,
          updated_at = NOW()
      WHERE id = 1
    `,
  );

  return { ...before, accessGrantsRemoved };
}
