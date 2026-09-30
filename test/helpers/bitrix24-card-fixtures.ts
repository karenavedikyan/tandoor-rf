import { confirmObject } from "../../src/bitrix24/labels/repository";
import { confirmCardObjectLink } from "../../src/bitrix24/tasks/card-objects";
import type { Bitrix24ObjectType } from "../../src/bitrix24/labels/format";
import { confirmObjectHierarchyLink } from "../../src/bitrix24/tasks/repository";

export const HOLDING_ONE = "44444444-4444-4444-8444-444444444444";
export const HOLDING_TWO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export async function linkCardToHolding(cardGuid: string, holdingGuid: string): Promise<void> {
  await confirmObject("holding", holdingGuid, null);
  await confirmCardObjectLink(cardGuid, "holding", holdingGuid);
}

export async function linkChildToHolding(
  holdingGuid: string,
  childType: Bitrix24ObjectType,
  childGuid: string,
): Promise<void> {
  await confirmObjectHierarchyLink(holdingGuid, childType, childGuid);
}
