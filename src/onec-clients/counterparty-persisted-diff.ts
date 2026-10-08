import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import type { ExtendedSnapshot } from "./extended-types";
import type { ValidatedClientsPayload } from "./types";
import {
  createEmptyCounterpartyExchange,
  mergeCounterpartyExchangeFields,
  readSnapshotCounterpartyExchange,
  type ParsedCounterpartyExchange,
} from "./counterparty-exchange-fields";

function normalizeCounterpartyForCompare(
  exchange: ParsedCounterpartyExchange | null | undefined,
): ParsedCounterpartyExchange {
  const empty = createEmptyCounterpartyExchange();
  if (!exchange) {
    return empty;
  }
  return {
    counterparty: exchange.counterparty ?? null,
    legalEntityType: exchange.legalEntityType ?? null,
    ogrn: exchange.ogrn ?? null,
    fullName: exchange.fullName ?? null,
    fieldPresence: {
      counterparty: exchange.fieldPresence?.counterparty ?? false,
      legalEntityType: exchange.fieldPresence?.legalEntityType ?? false,
      ogrn: exchange.fieldPresence?.ogrn ?? false,
      fullName: exchange.fieldPresence?.fullName ?? false,
    },
  };
}

function readSnapshotFromRow(raw: unknown): ExtendedSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExtendedSnapshot;
}

/** True when merged incoming counterparty would change persisted extended_snapshot.counterparty. */
export async function counterpartyExchangeIncomingDiffersFromStored(
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
    const previous = readSnapshotCounterpartyExchange(snapshot) ?? createEmptyCounterpartyExchange();
    const merged = mergeCounterpartyExchangeFields(record.counterparty, previous);
    if (!isDeepStrictEqual(normalizeCounterpartyForCompare(merged), normalizeCounterpartyForCompare(previous))) {
      return true;
    }
  }

  return false;
}
