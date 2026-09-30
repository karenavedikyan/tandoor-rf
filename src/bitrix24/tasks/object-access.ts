import type { AccessContext } from "../../access/types";
import { canReadClientGuid } from "../../clients/repository";
import type { Bitrix24ObjectType } from "../labels/format";
import { requirePool } from "../../db/pool";

export async function isChildObjectLinkedToHolding(
  holdingGuid: string,
  childType: Bitrix24ObjectType,
  childGuid: string,
): Promise<boolean> {
  if (childType === "holding" && childGuid === holdingGuid) {
    return true;
  }
  const pool = requirePool();
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM bitrix24_object_hierarchy
       WHERE parent_type = 'holding'
         AND parent_guid = $1::uuid
         AND child_type = $2::bitrix24_object_type
         AND child_guid = $3::uuid
     ) AS exists`,
    [holdingGuid, childType, childGuid],
  );
  return result.rows[0]?.exists ?? false;
}

export async function canReadBoundBitrixObject(
  context: AccessContext,
  cardGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): Promise<boolean> {
  if (objectType === "holding") {
    if (objectGuid !== cardGuid) {
      return false;
    }
    return canReadClientGuid(context, cardGuid);
  }
  const linked = await isChildObjectLinkedToHolding(cardGuid, objectType, objectGuid);
  if (!linked) {
    return false;
  }
  return canReadClientGuid(context, objectGuid);
}
