import type { PoolClient } from "pg";
import { PURGE_TABLE_GROUPS } from "./constants";

export type PurgeCounts = {
  accessGrantsRemoved: number;
  clientsRemoved: number;
  rosterRowsRemoved: number;
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

  const clientsBefore = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_clients`,
  );
  const clientsRemoved = Number(clientsBefore.rows[0]?.count ?? "0");

  let rosterRowsRemoved = 0;
  if (await tableExists(client, "onec_wholesale_employee_roster")) {
    const rosterBefore = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster`,
    );
    rosterRowsRemoved = Number(rosterBefore.rows[0]?.count ?? "0");
  }

  for (const statement of PURGE_TABLE_GROUPS.clientOrphans) {
    const result = await client.query(statement);
    if (statement.includes("access_grants")) {
      accessGrantsRemoved = result.rowCount ?? 0;
    }
  }

  if (await tableExists(client, "outlet_distribution_markers")) {
    await client.query("TRUNCATE outlet_distribution_markers RESTART IDENTITY CASCADE");
  }

  if (await tableExists(client, "client_review_records")) {
    await client.query("TRUNCATE client_review_records RESTART IDENTITY CASCADE");
  }

  await client.query(`TRUNCATE ${PURGE_TABLE_GROUPS.clientDomain.join(", ")} RESTART IDENTITY CASCADE`);

  if (await tableExists(client, "onec_wholesale_employee_roster")) {
    await client.query(`TRUNCATE ${PURGE_TABLE_GROUPS.rosterDomain.join(", ")} RESTART IDENTITY CASCADE`);
    await client.query(
      `
        UPDATE onec_wholesale_roster_state
        SET source_sha256 = repeat('0', 64),
            employee_count = 0,
            imported_at = NOW()
        WHERE id = 1
      `,
    );
  }

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

  return {
    accessGrantsRemoved,
    clientsRemoved,
    rosterRowsRemoved,
  };
}
