import type { AccessContext } from "../../access/types";
import { loadAccessContext } from "../../access/context";
import type { Bitrix24ObjectType } from "../labels/format";
import { loadBitrix24Config } from "../config";
import {
  isCachePublishAllowed,
  isPilotTaskFilterActive,
  isWorkingModeActive,
  loadBitrix24TasksRuntimeConfig,
} from "../tasks/config";
import {
  canViewBitrixTaskSummaryForUser,
  canViewFullBitrixTaskForUser,
} from "../tasks/work-access";
import { canReadBoundBitrixObject, isObjectLinkedToClientCard } from "../tasks/object-access";
import {
  evaluateUserBitrixTaskConfig,
  type TaskVisibilityDenyCode,
} from "../tasks/access";
import {
  findEmployeePortalLink,
  findPublishedTaskById,
  findTaskSnapshotById,
  listPublishedTasksForObject,
} from "../tasks/repository";
import { listConfirmedLabelTargetsForCard } from "./card-labels";

export type ManualSyncDenyCode =
  | TaskVisibilityDenyCode
  | "NOT_CONFIGURED"
  | "CARD_NOT_LINKED"
  | "TASK_NOT_ON_CARD"
  | "BINDING_UNCONFIRMED"
  | "SUMMARY_ONLY"
  | "BITRIX_USER_INACTIVE"
  | "VERIFICATION_FAILED";

export type ManualSyncScopeResult =
  | {
      ok: true;
      mode: "pilot" | "working";
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
    case "BINDING_UNCONFIRMED":
      return "Задача не подтверждена для объекта этой карточки.";
    case "SUMMARY_ONLY":
      return "Недостаточно прав для синхронизации полной задачи и чек-листа.";
    case "NOT_PUBLISHED":
      return "Кэш задач Bitrix24 не опубликован.";
    case "BITRIX_USER_INACTIVE":
      return "Учётная запись Bitrix24 сотрудника неактивна.";
    case "VERIFICATION_FAILED":
      return "Не удалось подтвердить доступ к Bitrix24.";
    default:
      return "Синхронизация недоступна.";
  }
}

async function assessManualSyncPrecheck(
  context: AccessContext,
  portalId: string,
  cardGuid: string,
  taskId: string,
  bitrixUserId: string,
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

  if (cached.responsibleBitrixUserId !== bitrixUserId) {
    const summaryOnly = await canViewBitrixTaskSummaryForUser(
      context,
      portalId,
      cached,
      cardGuid,
    );
    if (summaryOnly) {
      return "SUMMARY_ONLY";
    }
    return "TASK_NOT_ON_CARD";
  }

  if (
    !(await canReadBoundBitrixObject(context, cardGuid, cached.objectType, cached.objectGuid))
  ) {
    return "TASK_NOT_ON_CARD";
  }

  return null;
}

async function resolvePilotManualSyncScope(
  context: AccessContext,
  portalId: string,
  cardGuid: string,
  link: { bitrixUserId: string },
  input: {
    objectType: Bitrix24ObjectType;
    objectGuid: string;
    holdingGuid: string;
  },
): Promise<ManualSyncScopeResult> {
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (isPilotTaskFilterActive(runtime) && runtime.pilotTaskIds.size === 0) {
    return { ok: false, code: "PILOT_LIST_MISSING" };
  }

  const pilotIds = [...runtime.pilotTaskIds];
  if (pilotIds.length === 0) {
    return { ok: false, code: "PILOT_LIST_MISSING" };
  }

  const eligible: string[] = [];
  let lastDeny: ManualSyncDenyCode | null = null;
  for (const taskId of pilotIds) {
    const deny = await assessManualSyncPrecheck(
      context,
      portalId,
      cardGuid,
      taskId,
      link.bitrixUserId,
    );
    if (deny === "TASK_NOT_ON_CARD" || deny === "SUMMARY_ONLY") {
      lastDeny = deny;
      continue;
    }
    if (deny) {
      return { ok: false, code: deny };
    }
    eligible.push(taskId);
  }

  if (eligible.length === 0) {
    return { ok: false, code: lastDeny ?? "TASK_NOT_ON_CARD" };
  }

  return {
    ok: true,
    mode: "pilot",
    portalId,
    bitrixUserId: link.bitrixUserId,
    taskIds: eligible,
    objectType: input.objectType,
    objectGuid: input.objectGuid,
    holdingGuid: input.holdingGuid,
  };
}

async function resolveWorkingManualSyncScope(
  context: AccessContext,
  portalId: string,
  cardGuid: string,
  link: { bitrixUserId: string },
  input: {
    objectType: Bitrix24ObjectType;
    objectGuid: string;
    holdingGuid: string;
  },
): Promise<ManualSyncScopeResult> {
  if (
    !(await canReadBoundBitrixObject(context, cardGuid, input.objectType, input.objectGuid))
  ) {
    return { ok: false, code: "NO_CLIENT_ACCESS" };
  }

  const labelTargets = await listConfirmedLabelTargetsForCard(cardGuid, input.holdingGuid);
  const cachedTasks = await listPublishedTasksForObject(
    portalId,
    input.objectType,
    input.objectGuid,
  );
  const cachedEligible = cachedTasks
    .filter((task) => task.responsibleBitrixUserId === link.bitrixUserId)
    .map((task) => task.taskId);

  if (labelTargets.length === 0 && cachedEligible.length === 0) {
    return {
      ok: true,
      mode: "working",
      portalId,
      bitrixUserId: link.bitrixUserId,
      taskIds: [],
      objectType: input.objectType,
      objectGuid: input.objectGuid,
      holdingGuid: input.holdingGuid,
    };
  }

  return {
    ok: true,
    mode: "working",
    portalId,
    bitrixUserId: link.bitrixUserId,
    taskIds: cachedEligible,
    objectType: input.objectType,
    objectGuid: input.objectGuid,
    holdingGuid: input.holdingGuid,
  };
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

  const link = await findEmployeePortalLink(context.userId, loaded.config.portalId);
  if (!link) {
    return { ok: false, code: "NO_EMPLOYEE_LINK" };
  }

  if (isWorkingModeActive(runtime)) {
    return resolveWorkingManualSyncScope(
      context,
      loaded.config.portalId,
      cardGuid,
      link,
      input,
    );
  }

  return resolvePilotManualSyncScope(
    context,
    loaded.config.portalId,
    cardGuid,
    link,
    input,
  );
}

export async function verifyManualSyncOutcome(
  context: AccessContext,
  portalId: string,
  cardGuid: string,
  taskIds: string[],
): Promise<ManualSyncDenyCode | null> {
  context = await loadAccessContext(context.userId);
  if (context.status !== "active") return "NO_CLIENT_ACCESS";
  const configDeny = await evaluateUserBitrixTaskConfig(context, portalId);
  if (configDeny) {
    return configDeny;
  }
  const link = await findEmployeePortalLink(context.userId, portalId);
  if (!link) {
    return "NO_EMPLOYEE_LINK";
  }

  for (const taskId of taskIds) {
    const snapshot = await findTaskSnapshotById(portalId, taskId);
    if (!snapshot) {
      return "BINDING_UNCONFIRMED";
    }
    if (
      snapshot.bindingStatus !== "confirmed" ||
      !snapshot.objectType ||
      !snapshot.objectGuid
    ) {
      return "BINDING_UNCONFIRMED";
    }
    const linked = await isObjectLinkedToClientCard(
      cardGuid,
      snapshot.objectType,
      snapshot.objectGuid,
    );
    if (!linked) {
      return "TASK_NOT_ON_CARD";
    }
    if (snapshot.responsibleBitrixUserId !== link.bitrixUserId) {
      return "TASK_NOT_ON_CARD";
    }
    const full = await canViewFullBitrixTaskForUser(context, portalId, snapshot, cardGuid);
    if (!full) {
      return "SUMMARY_ONLY";
    }
  }
  return null;
}

export async function verifyManualSyncSource(
  userId: string,
  portalId: string,
  cardGuid: string,
  bitrixUserId: string,
  task: {
    taskId: string;
    responsibleBitrixUserId: string | null;
    bindingStatus: string;
    objectType: Bitrix24ObjectType | null;
    objectGuid: string | null;
  },
): Promise<ManualSyncDenyCode | null> {
  const context = await loadAccessContext(userId);
  if (context.status !== "active") return "NO_CLIENT_ACCESS";
  const configDeny = await evaluateUserBitrixTaskConfig(context, portalId);
  if (configDeny) return configDeny;

  const runtime = loadBitrix24TasksRuntimeConfig();
  if (isPilotTaskFilterActive(runtime) && !runtime.pilotTaskIds.has(task.taskId)) {
    return "PILOT_FILTER";
  }

  const link = await findEmployeePortalLink(userId, portalId);
  if (!link || link.bitrixUserId !== bitrixUserId) return "NO_EMPLOYEE_LINK";
  if (task.bindingStatus !== "confirmed" || !task.objectType || !task.objectGuid) {
    return "BINDING_UNCONFIRMED";
  }
  if (!(await isObjectLinkedToClientCard(cardGuid, task.objectType, task.objectGuid))) {
    return "TASK_NOT_ON_CARD";
  }
  if (task.responsibleBitrixUserId !== link.bitrixUserId) return "SUMMARY_ONLY";
  if (!(await canReadBoundBitrixObject(context, cardGuid, task.objectType, task.objectGuid))) {
    return "NO_CLIENT_ACCESS";
  }
  return null;
}
