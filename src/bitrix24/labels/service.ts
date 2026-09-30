import type { Bitrix24ObjectType } from "./format";
import { formatLabelToken } from "./format";
import {
  findActiveLabel,
  isObjectConfirmed,
  issueLabelInTransaction,
  type ObjectLabelRow,
} from "./repository";

export type LabelIssueResult =
  | { ok: true; label: ObjectLabelRow; token: string; created: boolean }
  | { ok: false; code: "OBJECT_NOT_CONFIRMED"; message: string };

export type LabelLookupResult =
  | { ok: true; label: ObjectLabelRow; token: string }
  | { ok: false; code: "NOT_ISSUED" | "OBJECT_NOT_CONFIRMED"; message: string };

export async function getExistingClientLabel(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): Promise<LabelLookupResult> {
  const confirmed = await isObjectConfirmed(objectType, objectGuid);
  if (!confirmed) {
    return {
      ok: false,
      code: "OBJECT_NOT_CONFIRMED",
      message: "Привязка ожидает подтверждения данных 1С.",
    };
  }
  const label = await findActiveLabel(objectType, objectGuid);
  if (!label) {
    return {
      ok: false,
      code: "NOT_ISSUED",
      message: "Метка для объекта ещё не выдана.",
    };
  }
  return { ok: true, label, token: formatLabelToken(label.labelCode) };
}

export async function issueClientLabel(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): Promise<LabelIssueResult> {
  const confirmed = await isObjectConfirmed(objectType, objectGuid);
  if (!confirmed) {
    return {
      ok: false,
      code: "OBJECT_NOT_CONFIRMED",
      message: "Привязка ожидает подтверждения данных 1С.",
    };
  }
  try {
    const issued = await issueLabelInTransaction(objectType, objectGuid);
    return {
      ok: true,
      label: issued,
      token: formatLabelToken(issued.labelCode),
      created: issued.created,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "OBJECT_NOT_CONFIRMED") {
      return {
        ok: false,
        code: "OBJECT_NOT_CONFIRMED",
        message: "Привязка ожидает подтверждения данных 1С.",
      };
    }
    throw error;
  }
}
