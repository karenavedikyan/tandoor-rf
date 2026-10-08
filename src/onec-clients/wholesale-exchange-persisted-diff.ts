import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import type { ExtendedSnapshot } from "./extended-types";
import type { ValidatedClientsPayload } from "./types";
import {
  createEmptyWholesaleClientExchange,
  mergeWholesaleClientExchangeFields,
  readSnapshotWholesaleClientExchange,
  type ParsedWholesaleClientExchange,
} from "./wholesale-client-exchange-fields";

function normalizeWholesaleForCompare(
  wholesale: ParsedWholesaleClientExchange | null | undefined,
): ParsedWholesaleClientExchange {
  const empty = createEmptyWholesaleClientExchange();
  if (!wholesale) {
    return empty;
  }
  return {
    top150: wholesale.top150 ?? null,
    outletCategory: wholesale.outletCategory ?? null,
    fieldPresence: {
      top150: wholesale.fieldPresence?.top150 ?? false,
      outletCategory: wholesale.fieldPresence?.outletCategory ?? false,
    },
  };
}

function readSnapshotFromRow(raw: unknown): ExtendedSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExtendedSnapshot;
}

/** True when merged incoming wholesale would change persisted extended_snapshot.wholesaleExchange. */
export async function wholesaleExchangeIncomingDiffersFromStored(
  client: PoolClient,
  payload: ValidatedClientsPayload,
): Promise<boolean> {
  const records = payload.extendedRecords;
  if (!records || records.length === 0) {
    return false;
  }

  const guids = records.map((record) => record.guid_client);
  const rows = await client.query<{ guid_client: string; extended_snapshot: unknown }>(
    `
      SELECT guid_client::text, extended_snapshot
      FROM onec_clients
      WHERE guid_client = ANY($1::uuid[])
    `,
    [guids],
  );
  const snapshotByGuid = new Map(
    rows.rows.map((row) => [row.guid_client.toLowerCase(), readSnapshotFromRow(row.extended_snapshot)]),
  );

  for (const record of records) {
    const snapshot = snapshotByGuid.get(record.guid_client.toLowerCase()) ?? null;
    const previous = readSnapshotWholesaleClientExchange(snapshot) ?? createEmptyWholesaleClientExchange();
    const merged = mergeWholesaleClientExchangeFields(record.wholesaleExchange, previous);
    if (!isDeepStrictEqual(normalizeWholesaleForCompare(merged), normalizeWholesaleForCompare(previous))) {
      return true;
    }
  }

  return false;
}
