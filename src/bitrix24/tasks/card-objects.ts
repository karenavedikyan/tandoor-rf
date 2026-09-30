import type { Pool, PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "../labels/format";

export type CardObjectMapping = {
  cardGuid: string;
  objectType: Bitrix24ObjectType;
  objectGuid: string;
};

export async function findCardObjectMapping(
  cardGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<CardObjectMapping | null> {
  const result = await client.query<{
    card_guid: string;
    object_type: Bitrix24ObjectType;
    object_guid: string;
  }>(
    `SELECT card_guid, object_type, object_guid
     FROM bitrix24_client_card_objects
     WHERE card_guid = $1::uuid`,
    [cardGuid],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    cardGuid: row.card_guid,
    objectType: row.object_type,
    objectGuid: row.object_guid,
  };
}

export async function confirmCardObjectLink(
  cardGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<void> {
  await client.query(
    `INSERT INTO bitrix24_client_card_objects (card_guid, object_type, object_guid)
     VALUES ($1::uuid, $2::bitrix24_object_type, $3::uuid)
     ON CONFLICT (card_guid) DO UPDATE SET
       object_type = EXCLUDED.object_type,
       object_guid = EXCLUDED.object_guid,
       confirmed_at = NOW()`,
    [cardGuid, objectType, objectGuid],
  );
}

export async function requireCardHoldingGuid(
  cardGuid: string,
  client: Pool | PoolClient = requirePool(),
): Promise<string | null> {
  const mapping = await findCardObjectMapping(cardGuid, client);
  if (!mapping || mapping.objectType !== "holding") {
    return null;
  }
  return mapping.objectGuid;
}
