import type { PoolClient } from "pg";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import { confirmObject, findActiveLabel, issueLabelOnClient, LabelRepositoryError } from "../bitrix24/labels/repository";

export type V3BitrixBootstrapStats = {
  labelsIssued: number;
  labelsSkippedExisting: number;
  labelsSkippedRevoked: number;
};

async function ensureLabel(
  client: PoolClient,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string | null,
  stats: V3BitrixBootstrapStats,
): Promise<void> {
  const active = await findActiveLabel(objectType, objectGuid, client);
  if (active) {
    stats.labelsSkippedExisting += 1;
    return;
  }
  await confirmObject(objectType, objectGuid, actorUserId, client);
  const issued = await issueLabelOnClient(objectType, objectGuid, actorUserId, client);
  if (issued.created) {
    stats.labelsIssued += 1;
  } else {
    stats.labelsSkippedExisting += 1;
  }
}

/** Issue LK_H / LK_J / LK_T for v3 objects; idempotent on re-import (existing labels kept). */
export async function bootstrapBitrixLabelsForV3Domain(
  client: PoolClient,
  actorUserId: string | null = null,
): Promise<V3BitrixBootstrapStats> {
  const stats: V3BitrixBootstrapStats = {
    labelsIssued: 0,
    labelsSkippedExisting: 0,
    labelsSkippedRevoked: 0,
  };

  const holdings = await client.query<{ guid_holding: string }>(
    `SELECT guid_holding::text FROM onec_v3_holdings ORDER BY guid_holding`,
  );
  for (const row of holdings.rows) {
    await ensureLabel(client, "holding", row.guid_holding, actorUserId, stats);
  }

  const legal = await client.query<{ guid_client: string }>(
    `SELECT guid_client::text FROM onec_v3_legal_entities ORDER BY guid_client`,
  );
  for (const row of legal.rows) {
    await ensureLabel(client, "legal_entity", row.guid_client, actorUserId, stats);
  }

  const retail = await client.query<{ guid_store: string }>(
    `SELECT guid_store::text FROM onec_v3_retail_outlets ORDER BY guid_store`,
  );
  for (const row of retail.rows) {
    await ensureLabel(client, "outlet", row.guid_store, actorUserId, stats);
  }

  return stats;
}
