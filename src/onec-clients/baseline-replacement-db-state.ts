import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ArchiveDependencyContext } from "./baseline-replacement-preflight";

export type DbBaselineClientState = {
  guid_client: string;
  name_client: string;
  source_sha256: string | null;
  guid_manager: string;
  baseline_status: string;
};

export type DbBaselineStateCapture = {
  clients: DbBaselineClientState[];
  dependencyStateSha256: string | null;
};

export async function captureDbBaselineState(client: PoolClient): Promise<DbBaselineStateCapture> {
  const result = await client.query<DbBaselineClientState>(
    `
      SELECT
        guid_client::text,
        name_client,
        source_sha256,
        guid_manager::text,
        COALESCE(baseline_status, 'active') AS baseline_status
      FROM onec_clients
      WHERE COALESCE(baseline_status, 'active') = 'active'
      ORDER BY guid_client
    `,
  );
  return { clients: result.rows, dependencyStateSha256: null };
}

export function computeDependencyStateSha256(context: ArchiveDependencyContext | null): string | null {
  if (!context || context.availability !== "loaded") {
    return null;
  }
  const canonical = JSON.stringify({
    v: 1,
    grants: [...context.activeAccessGrantCountByClient.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([guid, count]) => ({ guid, count })),
    bitrix: [...context.bitrixTaskCountByClient.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([guid, count]) => ({ guid, count })),
    outlets: [...context.confirmedOutletsByClient.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([guid, count]) => ({ guid, count })),
    childLinks: [...context.childHoldingLinkCountByClient.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([guid, count]) => ({ guid, count })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function computeDbBaselineStateSha256(capture: DbBaselineStateCapture): string {
  const canonical = JSON.stringify({
    v: 2,
    clients: capture.clients
      .map((row) => ({
        guid_client: row.guid_client.toLowerCase(),
        name_client: row.name_client,
        source_sha256: row.source_sha256?.toLowerCase() ?? null,
        guid_manager: row.guid_manager.toLowerCase(),
        baseline_status: row.baseline_status,
      }))
      .sort((a, b) => a.guid_client.localeCompare(b.guid_client)),
    dependencyStateSha256: capture.dependencyStateSha256?.toLowerCase() ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function captureDbBaselineStateWithDependencies(
  client: PoolClient,
  dependencyContext: ArchiveDependencyContext | null,
): Promise<DbBaselineStateCapture> {
  const capture = await captureDbBaselineState(client);
  capture.dependencyStateSha256 = computeDependencyStateSha256(dependencyContext);
  return capture;
}

export async function captureDbBaselineStateConsistent(
  client: PoolClient,
  dependencyContext: ArchiveDependencyContext | null,
): Promise<DbBaselineStateCapture> {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const capture = await captureDbBaselineStateWithDependencies(client, dependencyContext);
    await client.query("COMMIT");
    return capture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
