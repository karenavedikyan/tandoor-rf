import type { AccessContext } from "../../access/types";
import { canReadClientGuid } from "../../clients/repository";
import type { Bitrix24ObjectType } from "../labels/format";
import { requirePool } from "../../db/pool";
import { findCardObjectMapping, requireCardHoldingGuid } from "./card-objects";

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

export async function isObjectLinkedToClientCard(
  cardGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): Promise<boolean> {
  const holdingGuid = await requireCardHoldingGuid(cardGuid);
  if (!holdingGuid) {
    return false;
  }
  if (objectType === "holding") {
    return objectGuid === holdingGuid;
  }
  return isChildObjectLinkedToHolding(holdingGuid, objectType, objectGuid);
}

async function hasExplicitBitrixObjectGrant(
  context: AccessContext,
  objectGuid: string,
): Promise<boolean> {
  if (context.role === "admin" || context.fullClientBase) {
    return true;
  }
  const pool = requirePool();
  const denied = await pool.query(
    `SELECT 1 FROM access_denials
     WHERE user_id = $1::uuid AND revoked_at IS NULL
       AND (scope_type = 'all_clients' OR object_id = $2::uuid)
     LIMIT 1`,
    [context.userId, objectGuid],
  );
  if ((denied.rowCount ?? 0) > 0) {
    return false;
  }
  const granted = await pool.query(
    `SELECT 1 FROM access_grants
     WHERE user_id = $1::uuid AND object_id = $2::uuid AND revoked_at IS NULL
     LIMIT 1`,
    [context.userId, objectGuid],
  );
  return (granted.rowCount ?? 0) > 0;
}

export async function canReadBoundBitrixObject(
  context: AccessContext,
  cardGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): Promise<boolean> {
  if (!(await canReadClientGuid(context, cardGuid))) {
    return false;
  }
  if (!(await isObjectLinkedToClientCard(cardGuid, objectType, objectGuid))) {
    return false;
  }
  if (objectType === "holding") {
    return true;
  }
  return hasExplicitBitrixObjectGrant(context, objectGuid);
}

export async function canRestoreBitrixObjectLabel(
  context: AccessContext,
  cardGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): Promise<boolean> {
  if (context.role === "assistant") {
    return false;
  }
  if (context.role === "admin") {
    return canReadBoundBitrixObject(context, cardGuid, objectType, objectGuid);
  }
  if (!["manager", "rop", "director", "regional_manager"].includes(context.role)) {
    return false;
  }
  return canReadBoundBitrixObject(context, cardGuid, objectType, objectGuid);
}

export async function resolveCardHoldingForRead(
  cardGuid: string,
): Promise<{ holdingGuid: string } | null> {
  const mapping = await findCardObjectMapping(cardGuid);
  if (!mapping || mapping.objectType !== "holding") {
    return null;
  }
  return { holdingGuid: mapping.objectGuid };
}
