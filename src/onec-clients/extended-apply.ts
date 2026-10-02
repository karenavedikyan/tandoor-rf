import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { resolveManagerAccountLinks } from "./manager-status";
import type {
  ExtendedSnapshot,
  ParsedExtendedClientRecord,
  ParsedRetailOutlet,
  RetailOutletHistoryEntry,
} from "./extended-types";
import type { ValidatedClientsPayload } from "./types";

type ExistingExtendedRow = {
  guid_client: string;
  extended_snapshot: unknown;
  extended_source_sha256: string | null;
  extended_imported_at: Date | null;
};

export async function loadLinkedEmployeeGuids(client: PoolClient): Promise<Set<string>> {
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
  linkedEmployees: ReadonlySet<string>,
): ParsedExtendedClientRecord {
  const regionalManager = resolveManagerAccountLinks([record.regionalManager], linkedEmployees)[0]!;
  const hardwareManager = resolveManagerAccountLinks([record.hardwareManager], linkedEmployees)[0]!;
  const headOfSales = resolveManagerAccountLinks([record.headOfSales], linkedEmployees)[0]!;
  const retailOutlets = record.retailOutlets.map((outlet) => ({
    ...outlet,
    managers: {
      manager: resolveManagerAccountLinks([outlet.managers.manager], linkedEmployees)[0]!,
      regionalManager: resolveManagerAccountLinks([outlet.managers.regionalManager], linkedEmployees)[0]!,
      hardwareManager: resolveManagerAccountLinks([outlet.managers.hardwareManager], linkedEmployees)[0]!,
      headOfSales: resolveManagerAccountLinks([outlet.managers.headOfSales], linkedEmployees)[0]!,
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

function readExistingSnapshot(snapshot: unknown): ExtendedSnapshot | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  return snapshot as ExtendedSnapshot;
}

function appendHistory(
  previous: ExtendedSnapshot | null,
  sourceSha256: string,
  capturedAt: string,
): RetailOutletHistoryEntry[] {
  const history = previous?.retailOutletHistory ? [...previous.retailOutletHistory] : [];
  const previousCurrent = previous?.currentRetailOutlets ?? [];
  if (previousCurrent.length === 0) {
    return history;
  }
  if (!previous || previous.sourceSha256 === sourceSha256) {
    return history;
  }
  history.push({
    sourceSha256: previous.sourceSha256,
    capturedAt: previous.importedAt,
    retailOutlets: previousCurrent,
  });
  return history;
}

export function buildExtendedSnapshotJson(
  record: ParsedExtendedClientRecord,
  previousSnapshot: unknown,
  sourceSha256: string,
  importedAt: string,
): ExtendedSnapshot {
  const previous = readExistingSnapshot(previousSnapshot);
  const hasExtendedBlock = record.recordFormat === "extended_v1" || record.hasExtendedManagerFields;
  const effectiveImportedAt =
    previous?.sourceSha256 === sourceSha256 ? previous.importedAt : importedAt;
  return {
    formatVersion: "extended_v1",
    sourceSha256,
    importedAt: effectiveImportedAt,
    isHolding: record.isHolding,
    regionalManager: record.regionalManager,
    hardwareManager: record.hardwareManager,
    headOfSales: record.headOfSales,
    currentRetailOutlets: record.retailOutlets,
    retailOutletHistory: appendHistory(previous, sourceSha256, importedAt),
    blocks: {
      clientExtendedReady: false,
      outletNormalizedReady: false,
      clientExtendedBlockedReason: hasExtendedBlock ? "awaiting_live_json_verification" : "extended_block_not_present_in_record",
    },
  };
}

export function extendedSnapshotsEqual(left: ExtendedSnapshot | null, right: ExtendedSnapshot): boolean {
  if (!left) {
    return false;
  }
  return isDeepStrictEqual(left, right);
}

export function isExtendedApplyPayload(payload: ValidatedClientsPayload): boolean {
  return payload.sourceFormat === "extended_v1" && Array.isArray(payload.extendedRecords);
}

export function resolveExtendedRecordsForApply(
  payload: ValidatedClientsPayload,
  linkedEmployees: ReadonlySet<string>,
): Map<string, ParsedExtendedClientRecord> {
  const map = new Map<string, ParsedExtendedClientRecord>();
  if (!isExtendedApplyPayload(payload)) {
    return map;
  }
  for (const record of payload.extendedRecords!) {
    if (record.recordFormat !== "extended_v1" && !record.hasExtendedManagerFields) {
      continue;
    }
    map.set(record.guid_client, resolveRecordManagers(record, linkedEmployees));
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
        extended_source_sha256,
        extended_imported_at
      FROM onec_clients
      WHERE extended_snapshot IS NOT NULL
         OR extended_format_version IS NOT NULL
    `,
  );
  const map = new Map<string, ExistingExtendedRow>();
  for (const row of result.rows) {
    map.set(row.guid_client, row);
  }
  return map;
}

export function readExtendedSnapshot(snapshot: unknown): ExtendedSnapshot | null {
  return readExistingSnapshot(snapshot);
}
