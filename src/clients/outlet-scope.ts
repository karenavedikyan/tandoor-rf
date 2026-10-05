import type { AccessContext } from "../access/types";
import { query } from "../db/pool";
import { readExtendedSnapshot } from "../onec-clients/extended-apply";
import type { ParsedRetailOutlet } from "../onec-clients/extended-types";
import { filterRetailOutletsForContext } from "./outlet-access";

type ClientOutletRow = {
  guid_manager: string;
  extended_snapshot: unknown;
};

function readCurrentOutlets(snapshot: unknown): ParsedRetailOutlet[] {
  const parsed = readExtendedSnapshot(snapshot);
  if (!parsed) {
    return [];
  }
  if (Array.isArray(parsed.currentRetailOutlets)) {
    return parsed.currentRetailOutlets;
  }
  const legacy = (parsed as { retailOutlets?: ParsedRetailOutlet[] }).retailOutlets;
  return Array.isArray(legacy) ? legacy : [];
}

async function loadClientOutletRow(cardGuid: string): Promise<ClientOutletRow | null> {
  const result = await query<ClientOutletRow>(
    `
      SELECT guid_manager::text, extended_snapshot
      FROM onec_clients
      WHERE guid_client = $1::uuid
    `,
    [cardGuid],
  );
  return result.rows[0] ?? null;
}

function confirmedOutletGuids(outlets: ParsedRetailOutlet[]): Set<string> {
  const guids = new Set<string>();
  for (const outlet of outlets) {
    if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
      guids.add(outlet.guidStore.toLowerCase());
    }
  }
  return guids;
}

export async function listAccessibleOutletGuidsForClient(
  context: AccessContext,
  cardGuid: string,
): Promise<Set<string>> {
  const row = await loadClientOutletRow(cardGuid);
  if (!row) {
    return new Set();
  }
  const outlets = readCurrentOutlets(row.extended_snapshot);
  const filtered = filterRetailOutletsForContext(context, row.guid_manager ?? "", outlets);
  return confirmedOutletGuids(filtered);
}

export async function canAccessRetailOutletGuid(
  context: AccessContext,
  cardGuid: string,
  storeGuid: string,
): Promise<boolean> {
  const allowed = await listAccessibleOutletGuidsForClient(context, cardGuid);
  return allowed.has(storeGuid.toLowerCase());
}
