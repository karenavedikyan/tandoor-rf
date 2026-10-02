import type { PoolClient } from "pg";
import { resolveManagerStates } from "./manager-status";
import type { ParsedExtendedClientRecord, ParsedRetailOutlet } from "./extended-types";
import type { ValidatedClientsPayload } from "./types";

type ExistingExtendedRow = {
  guid_client: string;
  extended_snapshot: unknown;
  extended_source_sha256: string | null;
};

export async function loadKnownEmployeeGuids(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE revoked_at IS NULL
    `,
  );
  return new Set(result.rows.map((row) => row.employee_id.toLowerCase()));
}

function resolveRecordManagers(
  record: ParsedExtendedClientRecord,
  knownEmployees: ReadonlySet<string>,
): ParsedExtendedClientRecord {
  const regionalManager = resolveManagerStates([record.regionalManager], knownEmployees)[0]!;
  const hardwareManager = resolveManagerStates([record.hardwareManager], knownEmployees)[0]!;
  const headOfSales = resolveManagerStates([record.headOfSales], knownEmployees)[0]!;
  const retailOutlets = record.retailOutlets.map((outlet) => ({
    ...outlet,
    managers: {
      manager: resolveManagerStates([outlet.managers.manager], knownEmployees)[0]!,
      regionalManager: resolveManagerStates([outlet.managers.regionalManager], knownEmployees)[0]!,
      hardwareManager: resolveManagerStates([outlet.managers.hardwareManager], knownEmployees)[0]!,
      headOfSales: resolveManagerStates([outlet.managers.headOfSales], knownEmployees)[0]!,
    },
  }));
  return {
    ...record,
    regionalManager,
    hardwareManager,
    headOfSales,
    retailOutlets,
  };
}

function mergeStaleOutlets(
  previousOutlets: ParsedRetailOutlet[],
  incomingOutlets: ParsedRetailOutlet[],
): ParsedRetailOutlet[] {
  const incomingOrdinals = new Set(incomingOutlets.map((outlet) => outlet.ordinal));
  const stale = previousOutlets
    .filter((outlet) => !incomingOrdinals.has(outlet.ordinal))
    .map((outlet) => ({
      ...outlet,
      presentInCurrentSnapshot: false as const,
    }));
  return [...incomingOutlets, ...stale];
}

function readPreviousOutlets(snapshot: unknown): ParsedRetailOutlet[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [];
  }
  const retailOutlets = (snapshot as { retailOutlets?: unknown }).retailOutlets;
  if (!Array.isArray(retailOutlets)) {
    return [];
  }
  return retailOutlets.filter(
    (item): item is ParsedRetailOutlet =>
      item !== null && typeof item === "object" && typeof (item as ParsedRetailOutlet).ordinal === "number",
  );
}

export function buildExtendedSnapshotJson(
  record: ParsedExtendedClientRecord,
  previousSnapshot: unknown,
  sourceSha256: string,
): Record<string, unknown> {
  const previousOutlets = readPreviousOutlets(previousSnapshot);
  const mergedOutlets = mergeStaleOutlets(previousOutlets, record.retailOutlets);
  return {
    formatVersion: "extended_v1",
    sourceSha256,
    isHolding: record.isHolding,
    regionalManager: record.regionalManager,
    hardwareManager: record.hardwareManager,
    headOfSales: record.headOfSales,
    retailOutlets: mergedOutlets,
    blocks: {
      clientExtendedReady: true,
      outletNormalizedReady: false,
    },
  };
}

export function isExtendedApplyPayload(payload: ValidatedClientsPayload): boolean {
  return payload.sourceFormat === "extended_v1" && Array.isArray(payload.extendedRecords);
}

export function resolveExtendedRecordsForApply(
  payload: ValidatedClientsPayload,
  knownEmployees: ReadonlySet<string>,
): Map<string, ParsedExtendedClientRecord> {
  const map = new Map<string, ParsedExtendedClientRecord>();
  if (!isExtendedApplyPayload(payload)) {
    return map;
  }
  for (const record of payload.extendedRecords!) {
    if (record.recordFormat !== "extended_v1") {
      continue;
    }
    map.set(record.guid_client, resolveRecordManagers(record, knownEmployees));
  }
  return map;
}

export async function loadExistingExtendedSnapshots(
  client: PoolClient,
): Promise<Map<string, ExistingExtendedRow>> {
  const result = await client.query<ExistingExtendedRow>(
    `
      SELECT
        guid_client::text,
        extended_snapshot,
        extended_source_sha256
      FROM onec_clients
      WHERE extended_snapshot IS NOT NULL
    `,
  );
  const map = new Map<string, ExistingExtendedRow>();
  for (const row of result.rows) {
    map.set(row.guid_client, row);
  }
  return map;
}
