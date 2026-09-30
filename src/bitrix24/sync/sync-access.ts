import type { AccessContext } from "../../access/types";
import type { Bitrix24ObjectType } from "../labels/format";
import { loadBitrix24Config } from "../config";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../tasks/config";
import {
  canViewFullBitrixTaskForUser,
} from "../tasks/work-access";
import { isObjectLinkedToClientCard } from "../tasks/object-access";
import {
  evaluateUserBitrixTaskConfig,
  type TaskVisibilityDenyCode,
} from "../tasks/access";
import { findEmployeePortalLink, findPublishedTaskById } from "../tasks/repository";

export type ManualSyncDenyCode =
  | TaskVisibilityDenyCode
  | "NOT_CONFIGURED"
  | "CARD_NOT_LINKED"
  | "TASK_NOT_ON_CARD"
  | "SUMMARY_ONLY";

export type ManualSyncScopeResult =
  | {
      ok: true;
      portalId: string;
      bitrixUserId: string;
      taskIds: string[];
      objectType: Bitrix24ObjectType;
      objectGuid: string;
      holdingGuid: string;
    }
  | { ok: false; code: ManualSyncDenyCode };

export function mapManualSyncDenyMessage(code: ManualSyncDenyCode): string {
  switch (code) {
    case "NOT_CONFIGURED":
      return "Интеграция Bitrix24 не настроена.";
    case "CARD_NOT_LINKED":
      return "Карточка клиента не привязана к подтверждённому объекту.";
    case "NO_EMPLOYEE_LINK":
      return "Связь сотрудника с порталом Bitrix24 не подтверждена.";
    case "ACCESS_EXPIRED":
      return "Подтверждение доступа к Bitrix24 истекло.";
    case "PILOT_LIST_MISSING":
      return "Список разрешённых задач пилота не настроен.";
    case "PILOT_FILTER":
      return "Задача не входит в разрешённый список пилота.";
    case "TASK_NOT_ON_CARD":
      return "Задача не относится к этой карточке клиента.";
    case "SUMMARY_ONLY":
      return "Недостаточно прав для синхронизации полной задачи и чек-листа.";
    case "NOT_PUBLISHED":
      return "Кэш задач Bitrix24 не опубликован.";
    default:
      return "Синхронизация недоступна.";
  }
}

async function isPilotTaskEligibleForCard(
  context: AccessContext,
  portalId: string,
  cardGuid: string,
  taskId: string,
): Promise<ManualSyncDenyCode | null> {
  const cached = await findPublishedTaskById(portalId, taskId);
  if (!cached?.objectType || !cached.objectGuid) {
    return null;
  }
  const linked = await isObjectLinkedToClientCard(
    cardGuid,
    cached.objectType,
    cached.objectGuid,
  );
  if (!linked) {
    return "TASK_NOT_ON_CARD";
  }
  const full = await canViewFullBitrixTaskForUser(context, portalId, cached, cardGuid);
  if (!full) {
    return "SUMMARY_ONLY";
  }
  return null;
}

export async function resolveManualSyncScope(
  context: AccessContext,
  cardGuid: string,
  input: {
    objectType: Bitrix24ObjectType;
    objectGuid: string;
    holdingGuid: string;
  },
): Promise<ManualSyncScopeResult> {
  const loaded = loadBitrix24Config();
  if (!loaded.ok) {
    return { ok: false, code: "NOT_CONFIGURED" };
  }
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!isCachePublishAllowed(runtime)) {
    return { ok: false, code: "NOT_PUBLISHED" };
  }

  const configDeny = await evaluateUserBitrixTaskConfig(context, loaded.config.portalId);
  if (configDeny) {
    return { ok: false, code: configDeny };
  }

  if (runtime.pilotAllowListRequired && runtime.pilotTaskIds.size === 0) {
    return { ok: false, code: "PILOT_LIST_MISSING" };
  }

  const link = await findEmployeePortalLink(context.userId, loaded.config.portalId);
  if (!link) {
    return { ok: false, code: "NO_EMPLOYEE_LINK" };
  }

  const pilotIds = [...runtime.pilotTaskIds];
  if (pilotIds.length === 0) {
    return { ok: false, code: "PILOT_LIST_MISSING" };
  }

  const eligible: string[] = [];
  for (const taskId of pilotIds) {
    const deny = await isPilotTaskEligibleForCard(
      context,
      loaded.config.portalId,
      cardGuid,
      taskId,
    );
    if (deny === "TASK_NOT_ON_CARD" || deny === "SUMMARY_ONLY") {
      continue;
    }
    if (deny) {
      return { ok: false, code: deny };
    }
    eligible.push(taskId);
  }

  if (eligible.length === 0) {
    const firstDeny = await isPilotTaskEligibleForCard(
      context,
      loaded.config.portalId,
      cardGuid,
      pilotIds[0]!,
    );
    if (firstDeny) {
      return { ok: false, code: firstDeny };
    }
    eligible.push(pilotIds[0]!);
  }

  return {
    ok: true,
    portalId: loaded.config.portalId,
    bitrixUserId: link.bitrixUserId,
    taskIds: eligible,
    objectType: input.objectType,
    objectGuid: input.objectGuid,
    holdingGuid: input.holdingGuid,
  };
}

export async function verifyManualSyncOutcome(
  context: AccessContext,
  portalId: string,
  cardGuid: string,
  taskIds: string[],
): Promise<ManualSyncDenyCode | null> {
  for (const taskId of taskIds) {
    const deny = await isPilotTaskEligibleForCard(context, portalId, cardGuid, taskId);
    if (deny) {
      return deny;
    }
  }
  return null;
}
