import type { PoolClient } from "pg";
import { PURGE_TABLE_GROUPS } from "./constants";

export type PurgeCounts = {
  accessGrantsRemoved: number;
  clientsRemoved: number;
};

async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1::text) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

export async function purgeCleanReloadScope(client: PoolClient): Promise<PurgeCounts> {
  let accessGrantsRemoved = 0;

  for (const statement of PURGE_TABLE_GROUPS.clientOrphans) {
    const result = await client.query(statement);
    if (statement.includes("access_grants")) {
      accessGrantsRemoved = result.rowCount ?? 0;
    }
  }

  if (await tableExists(client, "outlet_distribution_markers")) {
    await client.query("TRUNCATE outlet_distribution_markers RESTART IDENTITY CASCADE");
  }

  const imageTables = PURGE_TABLE_GROUPS.catalogImages.filter((table) => table.length > 0);
  if (imageTables.length > 0) {
    await client.query(
      `TRUNCATE ${imageTables.join(", ")} RESTART IDENTITY CASCADE`,
    );
  }

  await client.query(
    `TRUNCATE ${PURGE_TABLE_GROUPS.catalogCore.join(", ")} RESTART IDENTITY CASCADE`,
  );

  await client.query(
    `UPDATE onec_catalog_state
     SET active_version_id = NULL,
         last_successful_manifest_sha256 = NULL,
         apply_blocked = FALSE,
         apply_blocked_reason = NULL
     WHERE id = 1`,
  );

  await client.query(`TRUNCATE ${PURGE_TABLE_GROUPS.clientDomain.join(", ")} RESTART IDENTITY CASCADE`);

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

  const clientsCount = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_clients`,
  );

  return {
    accessGrantsRemoved,
    clientsRemoved: Number(clientsCount.rows[0]?.count ?? "0"),
  };
}
