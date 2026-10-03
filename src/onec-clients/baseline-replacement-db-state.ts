import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { loadExchangeState, type ExchangeStateRow } from "../onec-exchange/state";
import type { ArchiveDependencyContext } from "./baseline-replacement-preflight";

export type DbBaselineClientState = {
  guid_client: string;
  name_client: string;
  address: string;
  telephone: unknown;
  source_sha256: string | null;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  baseline_status: string;
  baseline_archive_reason: string | null;
  baseline_archive_source_sha256: string | null;
  is_holding: boolean | null;
  extended_format_version: string | null;
  extended_source_sha256: string | null;
  extended_snapshot_sha256: string | null;
  extended_freshness_state: string | null;
  holding_link_state: string | null;
  guid_holding_pending: string | null;
  manager_roster_state: string | null;
};

export type DbBaselineOutletState = {
  guid_store: string;
  guid_client: string;
  is_closed: boolean | null;
  first_source_sha256: string | null;
  last_source_sha256: string | null;
  closure_history_sha256: string | null;
};

export type DbExchangeStateCapture = {
  last_successful_apply_sha256: string | null;
  accepted_baseline_sha256: string | null;
  last_verified_sha256: string | null;
  apply_blocked: boolean;
  apply_blocked_reason: string | null;
};

export type DbBaselineStateCapture = {
  clients: DbBaselineClientState[];
  outlets: DbBaselineOutletState[];
  exchange: DbExchangeStateCapture | null;
  dependencyStateSha256: string | null;
};

function hashJson(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function normalizeTelephone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? []));
}

function captureExchangeState(row: ExchangeStateRow): DbExchangeStateCapture {
  return {
    last_successful_apply_sha256: row.last_successful_apply_sha256?.toLowerCase() ?? null,
    accepted_baseline_sha256: row.accepted_baseline_sha256?.toLowerCase() ?? null,
    last_verified_sha256: row.last_verified_sha256?.toLowerCase() ?? null,
    apply_blocked: row.apply_blocked,
    apply_blocked_reason: row.apply_blocked_reason,
  };
}

export function computeDependencyStateSha256(context: ArchiveDependencyContext | null): string | null {
  if (!context || context.availability !== "loaded") {
    return null;
  }
  const canonical = JSON.stringify({
    v: 2,
    grants: [...context.activeAccessGrants]
      .map(({ objectId, userId }) => ({
        objectId: objectId.toLowerCase(),
        userId: userId.toLowerCase(),
      }))
      .sort((a, b) => a.objectId.localeCompare(b.objectId) || a.userId.localeCompare(b.userId)),
    employeeLinks: [...context.employeeLinks]
      .map(({ employeeId, userId }) => ({
        employeeId: employeeId.toLowerCase(),
        userId: userId.toLowerCase(),
      }))
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.userId.localeCompare(b.userId)),
    bitrixBindings: [...context.bitrixTaskBindings]
      .map(({ cardGuid, taskId }) => ({
        cardGuid: cardGuid.toLowerCase(),
        taskId: taskId.toLowerCase(),
      }))
      .sort((a, b) => a.cardGuid.localeCompare(b.cardGuid) || a.taskId.localeCompare(b.taskId)),
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
    v: 3,
    clients: capture.clients
      .map((row) => ({
        guid_client: row.guid_client.toLowerCase(),
        name_client: row.name_client,
        address: row.address,
        telephone: normalizeTelephone(row.telephone),
        source_sha256: row.source_sha256?.toLowerCase() ?? null,
        guid_holding: row.guid_holding?.toLowerCase() ?? null,
        name_holding: row.name_holding,
        guid_manager: row.guid_manager.toLowerCase(),
        name_manager: row.name_manager,
        baseline_status: row.baseline_status,
        baseline_archive_reason: row.baseline_archive_reason,
        baseline_archive_source_sha256: row.baseline_archive_source_sha256?.toLowerCase() ?? null,
        is_holding: row.is_holding,
        extended_format_version: row.extended_format_version,
        extended_source_sha256: row.extended_source_sha256?.toLowerCase() ?? null,
        extended_snapshot_sha256: row.extended_snapshot_sha256?.toLowerCase() ?? null,
        extended_freshness_state: row.extended_freshness_state,
        holding_link_state: row.holding_link_state,
        guid_holding_pending: row.guid_holding_pending?.toLowerCase() ?? null,
        manager_roster_state: row.manager_roster_state,
      }))
      .sort((a, b) => a.guid_client.localeCompare(b.guid_client)),
    outlets: capture.outlets
      .map((row) => ({
        guid_store: row.guid_store.toLowerCase(),
        guid_client: row.guid_client.toLowerCase(),
        is_closed: row.is_closed,
        first_source_sha256: row.first_source_sha256?.toLowerCase() ?? null,
        last_source_sha256: row.last_source_sha256?.toLowerCase() ?? null,
        closure_history_sha256: row.closure_history_sha256?.toLowerCase() ?? null,
      }))
      .sort((a, b) => a.guid_store.localeCompare(b.guid_store)),
    exchange: capture.exchange,
    dependencyStateSha256: capture.dependencyStateSha256?.toLowerCase() ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function captureDbBaselineState(client: PoolClient): Promise<DbBaselineStateCapture> {
  const clients = await client.query<DbBaselineClientState & { extended_snapshot: unknown; closure_history?: unknown }>(
    `
      SELECT
        guid_client::text,
        name_client,
        address,
        telephone,
        source_sha256,
        guid_holding::text,
        name_holding,
        guid_manager::text,
        name_manager,
        COALESCE(baseline_status, 'active') AS baseline_status,
        baseline_archive_reason,
        baseline_archive_source_sha256,
        is_holding,
        extended_format_version,
        extended_source_sha256,
        extended_snapshot,
        extended_freshness_state,
        holding_link_state,
        guid_holding_pending::text,
        manager_roster_state
      FROM onec_clients
      ORDER BY guid_client
    `,
  );

  let outlets: DbBaselineOutletState[] = [];
  try {
    const outletResult = await client.query<{
      guid_store: string;
      guid_client: string;
      is_closed: boolean | null;
      first_source_sha256: string | null;
      last_source_sha256: string | null;
      closure_history: unknown;
    }>(
      `
        SELECT
          guid_store::text,
          guid_client::text,
          is_closed,
          first_source_sha256,
          last_source_sha256,
          closure_history
        FROM onec_retail_outlets
        ORDER BY guid_store
      `,
    );
    outlets = outletResult.rows.map((row) => ({
      guid_store: row.guid_store,
      guid_client: row.guid_client,
      is_closed: row.is_closed,
      first_source_sha256: row.first_source_sha256,
      last_source_sha256: row.last_source_sha256,
      closure_history_sha256: hashJson(row.closure_history),
    }));
  } catch {
    outlets = [];
  }

  let exchange: DbExchangeStateCapture | null = null;
  try {
    exchange = captureExchangeState(await loadExchangeState(client));
  } catch {
    exchange = null;
  }

  return {
    clients: clients.rows.map((row) => ({
      guid_client: row.guid_client,
      name_client: row.name_client,
      address: row.address,
      telephone: row.telephone,
      source_sha256: row.source_sha256,
      guid_holding: row.guid_holding,
      name_holding: row.name_holding,
      guid_manager: row.guid_manager,
      name_manager: row.name_manager,
      baseline_status: row.baseline_status,
      baseline_archive_reason: row.baseline_archive_reason,
      baseline_archive_source_sha256: row.baseline_archive_source_sha256,
      is_holding: row.is_holding,
      extended_format_version: row.extended_format_version,
      extended_source_sha256: row.extended_source_sha256,
      extended_snapshot_sha256: hashJson(row.extended_snapshot),
      extended_freshness_state: row.extended_freshness_state,
      holding_link_state: row.holding_link_state,
      guid_holding_pending: row.guid_holding_pending,
      manager_roster_state: row.manager_roster_state,
    })),
    outlets,
    exchange,
    dependencyStateSha256: null,
  };
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
