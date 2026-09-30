import type { Bitrix24ObjectType } from "./format";
import { formatLabelToken } from "./format";
import {
  findActiveLabel,
  isObjectConfirmed,
  issueLabelInTransaction,
  LabelRepositoryError,
  restoreRevokedLabel,
  type ObjectLabelRow,
} from "./repository";

export type LabelIssueResult =
  | { ok: true; label: ObjectLabelRow; token: string; created: boolean; restored?: boolean }
  | {
      ok: false;
      code: "OBJECT_NOT_CONFIRMED" | "LABEL_REVOKED" | "LABEL_SEQUENCE_EXHAUSTED";
      message: string;
    };

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
  actorUserId: string | null = null,
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
    const issued = await issueLabelInTransaction(objectType, objectGuid, actorUserId);
    return {
      ok: true,
      label: issued,
      token: formatLabelToken(issued.labelCode),
      created: issued.created,
      restored: issued.restored,
    };
  } catch (error) {
    if (error instanceof LabelRepositoryError) {
      if (error.code === "OBJECT_NOT_CONFIRMED") {
        return {
          ok: false,
          code: "OBJECT_NOT_CONFIRMED",
          message: "Привязка ожидает подтверждения данных 1С.",
        };
      }
      if (error.code === "LABEL_REVOKED") {
        return {
          ok: false,
          code: "LABEL_REVOKED",
          message: "Метка была отозвана. Для восстановления используйте явную операцию restore.",
        };
      }
      if (error.code === "LABEL_SEQUENCE_EXHAUSTED") {
        return {
          ok: false,
          code: "LABEL_SEQUENCE_EXHAUSTED",
          message: "Диапазон кодов меток для этого типа объекта исчерпан.",
        };
      }
    }
    throw error;
  }
}

export async function restoreClientLabel(
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  actorUserId: string | null = null,
): Promise<LabelIssueResult> {
  try {
    const restored = await restoreRevokedLabel(objectType, objectGuid, actorUserId);
    return {
      ok: true,
      label: restored,
      token: formatLabelToken(restored.labelCode),
      created: false,
      restored: true,
    };
  } catch (error) {
    if (error instanceof LabelRepositoryError) {
      if (error.code === "OBJECT_NOT_CONFIRMED") {
        return {
          ok: false,
          code: "OBJECT_NOT_CONFIRMED",
          message: "Привязка ожидает подтверждения данных 1С.",
        };
      }
      if (error.code === "LABEL_REVOKED") {
        return {
          ok: false,
          code: "LABEL_REVOKED",
          message: "Нет отозванной метки для восстановления.",
        };
      }
    }
    throw error;
  }
}
