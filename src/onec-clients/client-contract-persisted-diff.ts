import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import type { ExtendedSnapshot } from "./extended-types";
import type { ValidatedClientsPayload } from "./types";
import {
  createEmptyClientContractExchange,
  mergeClientContractExchangeFields,
  readSnapshotClientContractExchange,
  type ParsedClientContractExchange,
} from "./client-contract-exchange-fields";

function normalizeClientContractForCompare(
  exchange: ParsedClientContractExchange | null | undefined,
): ParsedClientContractExchange {
  const empty = createEmptyClientContractExchange();
  if (!exchange) {
    return empty;
  }
  return {
    primaryContract: exchange.primaryContract ?? null,
    mainAgreement: exchange.mainAgreement ?? null,
    fieldPresence: {
      primaryContract: exchange.fieldPresence?.primaryContract ?? false,
      mainAgreement: exchange.fieldPresence?.mainAgreement ?? false,
    },
  };
}

function readSnapshotFromRow(raw: unknown): ExtendedSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExtendedSnapshot;
}

/** True when merged incoming clientContract would change persisted extended_snapshot.clientContract. */
export async function clientContractExchangeIncomingDiffersFromStored(
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
    const previous = readSnapshotClientContractExchange(snapshot) ?? createEmptyClientContractExchange();
    const merged = mergeClientContractExchangeFields(record.clientContract, previous);
    if (
      !isDeepStrictEqual(normalizeClientContractForCompare(merged), normalizeClientContractForCompare(previous))
    ) {
      return true;
    }
  }

  return false;
}
