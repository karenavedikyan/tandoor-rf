import type { PoolClient } from "pg";

export async function readSeptemberPreflightJobState(client: PoolClient): Promise<{
  pendingOrRunningImportJobs: number;
  pendingOrRunningDiagnosticJobs: number;
}> {
  const [importRow, diagnosticRow] = await Promise.all([
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE status IN ('pending', 'running')`,
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_diagnostic_jobs WHERE status IN ('pending', 'running')`,
    ),
  ]);
  return {
    pendingOrRunningImportJobs: Number(importRow.rows[0]?.count ?? "0"),
    pendingOrRunningDiagnosticJobs: Number(diagnosticRow.rows[0]?.count ?? "0"),
  };
}
