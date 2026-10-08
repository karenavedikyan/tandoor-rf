import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import type { ExtendedSnapshot } from "./extended-types";
import type { ValidatedClientsPayload } from "./types";
import {
  createEmptyClientCodeExchange,
  mergeClientCodeExchangeFields,
  readSnapshotClientCodeExchange,
  type ParsedClientCodeExchange,
} from "./client-code-exchange-fields";

function normalizeClientCodeForCompare(
  exchange: ParsedClientCodeExchange | null | undefined,
): ParsedClientCodeExchange {
  const empty = createEmptyClientCodeExchange();
  if (!exchange) {
    return empty;
  }
  return {
    code1c: exchange.code1c ?? null,
    fieldPresence: {
      code1c: exchange.fieldPresence?.code1c ?? false,
    },
  };
}

function readSnapshotFromRow(raw: unknown): ExtendedSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExtendedSnapshot;
}

export async function clientCodeExchangeIncomingDiffersFromStored(
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
    const previous = readSnapshotClientCodeExchange(snapshot) ?? createEmptyClientCodeExchange();
    const merged = mergeClientCodeExchangeFields(record.clientCode, previous);
    if (!isDeepStrictEqual(normalizeClientCodeForCompare(merged), normalizeClientCodeForCompare(previous))) {
      return true;
    }
  }

  return false;
}
