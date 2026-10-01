import type { Bitrix24ObjectType } from "../labels/format";
import { formatLabelToken } from "../labels/format";
import { findActiveLabel } from "../labels/repository";
import { requirePool } from "../../db/pool";
import { requireCardHoldingGuid } from "../tasks/card-objects";

export type CardLabelTarget = {
  objectType: Bitrix24ObjectType;
  objectGuid: string;
  labelCode: string;
  token: string;
};

export async function listConfirmedLabelTargetsForCard(
  cardGuid: string,
  holdingGuid: string,
): Promise<CardLabelTarget[]> {
  const pool = requirePool();
  const cardHolding = await requireCardHoldingGuid(cardGuid);
  if (!cardHolding || cardHolding !== holdingGuid) {
    return [];
  }

  const targets: CardLabelTarget[] = [];
  const holdingLabel = await findActiveLabel("holding", holdingGuid);
  if (holdingLabel) {
    targets.push({
      objectType: "holding",
      objectGuid: holdingGuid,
      labelCode: holdingLabel.labelCode,
      token: formatLabelToken(holdingLabel.labelCode),
    });
  }

  const children = await pool.query<{
    child_type: Bitrix24ObjectType;
    child_guid: string;
  }>(
    `SELECT child_type, child_guid
     FROM bitrix24_object_hierarchy
     WHERE parent_type = 'holding' AND parent_guid = $1::uuid`,
    [holdingGuid],
  );
  for (const row of children.rows) {
    const label = await findActiveLabel(row.child_type, row.child_guid);
    if (label) {
      targets.push({
        objectType: row.child_type,
        objectGuid: row.child_guid,
        labelCode: label.labelCode,
        token: formatLabelToken(label.labelCode),
      });
    }
  }
  return targets;
}
