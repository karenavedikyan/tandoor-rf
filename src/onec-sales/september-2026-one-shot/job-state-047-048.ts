import type { PoolClient } from "pg";

export async function readSeptemberPreflightJobState(client: PoolClient): Promise<{
  pendingOrRunningImportJobs: number;
}> {
  const row = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE status IN ('pending', 'running')`,
  );
  return { pendingOrRunningImportJobs: Number(row.rows[0]?.count ?? "0") };
}
