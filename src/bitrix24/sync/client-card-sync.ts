import type { AccessContext } from "../../access/types";
import { loadAccessContext } from "../../access/context";
import type { PinnedRequestFn } from "../pinned-request";
import type { ResolvePortalAddressesFn } from "../dns-resolve";
import { loadBitrix24Config } from "../config";
import { createOperationContext } from "../transport";
import { formatMskDateTime } from "../../clients/dto";
import { requirePool } from "../../db/pool";
import {
  evaluateUserBitrixTaskConfig,
} from "../tasks/access";
import {
  findTaskSnapshotById,
  listPublishedTaskSnapshotForResponsibleScope,
  type PublishedTaskSnapshotEntry,
  unpublishResponsibleTasksNotInSet,
} from "../tasks/repository";
import { canReadBoundBitrixObject, isObjectLinkedToClientCard } from "../tasks/object-access";
import { listConfirmedLabelTargetsForCard } from "./card-labels";
import { ensureEmployeePortalLinkVerified } from "../tasks/employee-verification";
import {
  beginManualSyncCardSession,
  loadManualSyncMinIntervalMs,
  type ManualSyncLockResult,
} from "./manual-sync-lock";
import { runBitrix24TaskSync, type Bitrix24SyncResult } from "./run-sync";
import { discoverResponsibleTasksForCard, type TaskDiscoveryResult } from "./task-discovery";
import {
  mapManualSyncDenyMessage,
  resolveManualSyncScope,
  verifyManualSyncOutcome,
  verifyManualSyncSource,
  type ManualSyncDenyCode,
  type ManualSyncScopeResult,
} from "./sync-access";

export type ClientCardSyncOptions = {
  context: AccessContext;
  cardGuid: string;
  objectType: import("../labels/format").Bitrix24ObjectType;
  objectGuid: string;
  holdingGuid: string;
  pinnedRequest?: PinnedRequestFn;
  resolvePortalAddresses?: ResolvePortalAddressesFn;
  env?: NodeJS.ProcessEnv;
};

export type ClientCardSyncResponse =
  | {
      httpStatus: 200;
      body: {
        status: "success" | "partial" | "failed";
        complete: boolean;
        message: string;
        syncedAt: string;
        syncedAtLabel: string;
        tasksSynced: number;
        checklistsSynced: number;
      };
    }
  | {
      httpStatus: 403 | 404 | 429 | 503;
      body: {
        code: string;
        message: string;
        retryAfterMs?: number;
      };
    };

type SyncBatchResult = {
  aggregate: Bitrix24SyncResult;
  sourceDeny: ManualSyncDenyCode | null;
  lockDeny: ManualSyncLockResult | null;
  writtenTaskIds: string[];
};

function baseSyncResult(): Bitrix24SyncResult {
  return {
    ok: true,
    status: "success",
    mode: "apply",
    tasksFetched: 0,
    bindingsConfirmed: 0,
    bindingsConflict: 0,
    bindingsInvalid: 0,
    bindingsPending: 0,
    cacheWrites: 0,
    versionConflicts: 0,
    checklistsSynced: 0,
    checklistsFailed: 0,
    orkPublicationsRevoked: 0,
    orkPublishSkipped: 0,
    complete: true,
    message: "success",
  };
}

function discoveryFailureResult(code: string): Bitrix24SyncResult {
  return {
    ...baseSyncResult(),
    ok: false,
    status: "failed",
    complete: false,
    message: code,
  };
}

function emptyWorkingDiscoveryResult(): Bitrix24SyncResult {
  return {
    ...baseSyncResult(),
    ok: true,
    status: "success",
    complete: true,
    message: "NO_TASKS_FOUND",
  };
}

function mapSyncResultMessage(result: Bitrix24SyncResult): string {
  if (result.message === "NO_TASKS_FOUND") {
    return "Подходящие задачи не найдены.";
  }
  if (result.status === "success" && result.complete) {
    return "Данные задач и чек-листов обновлены.";
  }
  if (result.status === "partial") {
    return "Синхронизация завершена частично. Часть данных могла не обновиться.";
  }
  return "Не удалось обновить данные из Bitrix24.";
}

function mapTransportFailure(code: string): string {
  switch (code) {
    case "FORBIDDEN":
      return "Bitrix24 отклонил запрос. Проверьте права webhook.";
    case "RATE_LIMITED":
      return "Bitrix24 временно ограничил частоту запросов. Повторите позже.";
    case "TIMEOUT":
    case "MAX_DURATION":
      return "Превышено время ожидания ответа Bitrix24.";
    default:
      return "Не удалось получить данные из Bitrix24.";
  }
}

function denyResponse(
  httpStatus: 403 | 404 | 429 | 503,
  code: ManualSyncDenyCode | "SYNC_IN_PROGRESS" | "COOLDOWN",
  retryAfterMs?: number,
): ClientCardSyncResponse {
  const message =
    code === "SYNC_IN_PROGRESS"
      ? "Синхронизация уже выполняется."
      : code === "COOLDOWN"
        ? "Повторный запуск пока недоступен. Подождите и попробуйте снова."
        : mapManualSyncDenyMessage(code as ManualSyncDenyCode);
  return {
    httpStatus,
    body: {
      code,
      message,
      ...(retryAfterMs !== undefined ? { retryAfterMs: Math.max(0, retryAfterMs) } : {}),
    },
  };
}

function mergeSyncResults(
  aggregate: Bitrix24SyncResult,
  result: Bitrix24SyncResult,
): Bitrix24SyncResult {
  const mergedStatus =
    aggregate.status === "failed" || result.status === "failed"
      ? aggregate.status === "partial" || result.status === "partial" || aggregate.cacheWrites > 0 || result.cacheWrites > 0
        ? "partial"
        : "failed"
      : aggregate.status === "partial" || result.status === "partial"
        ? "partial"
        : "success";
  return {
    ...aggregate,
    ok: mergedStatus !== "failed",
    status: mergedStatus,
    tasksFetched: aggregate.tasksFetched + result.tasksFetched,
    cacheWrites: aggregate.cacheWrites + result.cacheWrites,
    checklistsSynced: aggregate.checklistsSynced + result.checklistsSynced,
    checklistsFailed: aggregate.checklistsFailed + result.checklistsFailed,
    complete: aggregate.complete && result.complete,
    message: result.complete ? aggregate.message : result.message,
  };
}

function applyDiscoveryState(
  aggregate: Bitrix24SyncResult,
  discovery: TaskDiscoveryResult,
): Bitrix24SyncResult {
  if (discovery.fatalError && aggregate.cacheWrites === 0) {
    return discoveryFailureResult(discovery.fatalError);
  }
  if (!discovery.complete) {
    return {
      ...aggregate,
      ok: aggregate.cacheWrites > 0 ? aggregate.ok : false,
      status: aggregate.cacheWrites > 0 ? "partial" : "failed",
      complete: false,
      truncatedReason: discovery.truncatedReason ?? discovery.fatalError,
      message: discovery.truncatedReason ?? discovery.fatalError ?? aggregate.message,
    };
  }
  return aggregate;
}

async function syncTaskBatch(
  options: ClientCardSyncOptions,
  scope: Extract<ManualSyncScopeResult, { ok: true }>,
  env: NodeJS.ProcessEnv,
): Promise<SyncBatchResult> {
  const loaded = loadBitrix24Config(env);
  if (!loaded.ok) {
    return {
      aggregate: { ...baseSyncResult(), ok: false, status: "failed", complete: false, message: "NOT_CONFIGURED" },
      sourceDeny: "NOT_CONFIGURED",
      lockDeny: null,
      writtenTaskIds: [],
    };
  }

  const operation = createOperationContext(loaded.config);
  operation.pinnedRequest = options.pinnedRequest;
  operation.resolvePortalAddresses = options.resolvePortalAddresses;

  const minIntervalMs = loadManualSyncMinIntervalMs(env);
  const session = await beginManualSyncCardSession(
    scope.portalId,
    options.cardGuid,
    options.context.userId,
    minIntervalMs,
    { admissionDeadlineMs: Date.now() + operation.deadline.remainingMs() },
  );
  if (!session.ok) {
    return {
      aggregate: baseSyncResult(),
      sourceDeny: null,
      lockDeny: session,
      writtenTaskIds: [],
    };
  }

  let aggregate: Bitrix24SyncResult | null = null;
  let sourceDeny: ManualSyncDenyCode | null = null;
  let writtenTaskIds: string[] = [];
  let failedDiscoveredTaskIds: string[] = [];
  let discovery: TaskDiscoveryResult | null = null;
  let publishedSnapshot: PublishedTaskSnapshotEntry[] = [];

  try {
    if (scope.mode === "working") {
      const holdingLock = await session.acquireHoldingLock(scope.holdingGuid);
      if (!holdingLock.ok) {
        return {
          aggregate: baseSyncResult(),
          sourceDeny: null,
          lockDeny: holdingLock,
          writtenTaskIds: [],
        };
      }
    }

    const verification = await ensureEmployeePortalLinkVerified(
      options.context.userId,
      scope.portalId,
      loaded.config,
      operation,
      { force: scope.mode === "working", expectedIdentity: scope },
    );
    if (!verification.ok) {
      return {
        aggregate: baseSyncResult(),
        sourceDeny: verification.code as ManualSyncDenyCode,
        lockDeny: null,
        writtenTaskIds: [],
      };
    }

    let taskIdsToSync = [...scope.taskIds];
    if (scope.mode === "working") {
      const currentContext = await loadAccessContext(options.context.userId);
      const currentScope = await resolveManualSyncScope(currentContext, options.cardGuid, scope);
      if (!currentScope.ok || currentScope.bitrixUserId !== scope.bitrixUserId ||
          currentScope.confirmedAtMs !== scope.confirmedAtMs) {
        return { aggregate: baseSyncResult(), sourceDeny: "NO_CLIENT_ACCESS", lockDeny: null, writtenTaskIds: [] };
      }
      const labelTargets = [];
      for (const target of await listConfirmedLabelTargetsForCard(options.cardGuid, scope.holdingGuid)) {
        if (await canReadBoundBitrixObject(currentContext, options.cardGuid, target.objectType, target.objectGuid)) {
          labelTargets.push(target);
        }
      }
      if (labelTargets.length === 0) {
        return { aggregate: baseSyncResult(), sourceDeny: "CARD_NOT_LINKED", lockDeny: null, writtenTaskIds: [] };
      }
      publishedSnapshot = await listPublishedTaskSnapshotForResponsibleScope({
        portalId: scope.portalId,
        bitrixUserId: scope.bitrixUserId,
        objectType: scope.objectType,
        objectGuid: scope.objectGuid,
        holdingGuid: scope.holdingGuid,
      });
      discovery = await discoverResponsibleTasksForCard({
        config: loaded.config,
        bitrixUserId: scope.bitrixUserId,
        cardGuid: options.cardGuid,
        holdingGuid: scope.holdingGuid,
        operation,
        labelTargets,
      });
      if (discovery.fatalError && discovery.taskIds.length === 0) {
        return {
          aggregate: discoveryFailureResult(discovery.fatalError),
          sourceDeny: null,
          lockDeny: null,
          writtenTaskIds: [],
        };
      }
      taskIdsToSync = discovery.taskIds;
    }

    if (taskIdsToSync.length > 0) {
      const taskLock = await session.acquireTaskLocks(taskIdsToSync);
      if (!taskLock.ok) {
        return {
          aggregate: baseSyncResult(),
          sourceDeny: null,
          lockDeny: taskLock,
          writtenTaskIds: [],
        };
      }
    }

    if (taskIdsToSync.length === 0) {
      aggregate =
        scope.mode === "working" && discovery && discovery.complete && !discovery.fatalError
          ? emptyWorkingDiscoveryResult()
          : discovery && !discovery.complete
            ? applyDiscoveryState(baseSyncResult(), discovery)
            : baseSyncResult();
    } else {
      for (const taskId of taskIdsToSync) {
        if (operation.deadline.expired()) {
          aggregate = aggregate
            ? { ...aggregate, status: "partial", complete: false, ok: aggregate.cacheWrites > 0 }
            : { ...baseSyncResult(), status: "partial", complete: false, ok: false };
          break;
        }
        const prior = await findTaskSnapshotById(scope.portalId, taskId);
        const result = await runBitrix24TaskSync({
          bitrixUserId: scope.bitrixUserId,
          apply: true,
          taskId,
          pinnedRequest: options.pinnedRequest,
          resolvePortalAddresses: options.resolvePortalAddresses,
          env,
          operation,
          syncExecutorUserId: options.context.userId,
          assertTaskScope: async (task) => {
            const deny = await verifyManualSyncSource(
              options.context.userId,
              scope.portalId,
              options.cardGuid,
              scope.bitrixUserId,
              task,
            );
            if (!deny) return;
            sourceDeny = deny;
            if (
              prior?.objectType &&
              prior.objectGuid &&
              ["BINDING_UNCONFIRMED", "TASK_NOT_ON_CARD", "SUMMARY_ONLY"].includes(deny) &&
              (await isObjectLinkedToClientCard(
                options.cardGuid,
                prior.objectType,
                prior.objectGuid,
              ))
            ) {
              await requirePool().query(
                `UPDATE bitrix24_task_cache SET published = false, cache_version = cache_version + 1
                 WHERE portal_id = $1 AND task_id = $2 AND cache_version = $3`,
                [scope.portalId, taskId, prior.cacheVersion],
              );
            }
            throw new Error("MANUAL_SYNC_SCOPE_DENIED");
          },
        });
        aggregate = aggregate ? mergeSyncResults(aggregate, result) : result;
        if (result.cacheWrites > 0) {
          writtenTaskIds.push(taskId);
        } else if (result.status === "failed" || !result.complete) {
          failedDiscoveredTaskIds.push(taskId);
        }
        if (sourceDeny) break;
      }
      aggregate ??= baseSyncResult();
      if (discovery) {
        aggregate = applyDiscoveryState(aggregate, discovery);
      }
    }

    const syncFullySucceeded =
      aggregate.status === "success" &&
      aggregate.complete === true &&
      failedDiscoveredTaskIds.length === 0;
    const freshContext = await loadAccessContext(options.context.userId);
    const freshScope = await resolveManualSyncScope(freshContext, options.cardGuid, scope);
    const accessDeny = await evaluateUserBitrixTaskConfig(freshContext, scope.portalId);
    if (!freshScope.ok || freshScope.bitrixUserId !== scope.bitrixUserId ||
        freshScope.confirmedAtMs !== scope.confirmedAtMs) sourceDeny = "NO_CLIENT_ACCESS";
    const discoveredKeepIds = discovery?.taskIds ?? [];
    const canUnpublish =
      scope.mode === "working" &&
      discovery?.hasLabelTargets === true &&
      discovery.complete === true &&
      !discovery.fatalError &&
      !sourceDeny &&
      !accessDeny &&
      syncFullySucceeded;

    if (canUnpublish) {
      const toUnpublish: PublishedTaskSnapshotEntry[] = [];
      for (const entry of publishedSnapshot) {
        if (!discoveredKeepIds.includes(entry.taskId) &&
            await canReadBoundBitrixObject(freshContext, options.cardGuid, entry.objectType, entry.objectGuid)) {
          toUnpublish.push(entry);
        }
      }
      if (toUnpublish.length > 0) {
        const sweepLocks = await session.acquireTaskLocks(toUnpublish.map((entry) => entry.taskId));
        if (!sweepLocks.ok) {
          aggregate = {
            ...aggregate,
            status: "partial",
            complete: false,
            ok: true,
          };
        } else {
          await unpublishResponsibleTasksNotInSet({
            portalId: scope.portalId,
            bitrixUserId: scope.bitrixUserId,
            objectType: scope.objectType,
            objectGuid: scope.objectGuid,
            holdingGuid: scope.holdingGuid,
            keepTaskIds: discoveredKeepIds,
            snapshotEntries: toUnpublish,
          });
        }
      }
    }
  } finally {
    await session.release();
  }

  return {
    aggregate: aggregate ?? baseSyncResult(),
    sourceDeny,
    lockDeny: null,
    writtenTaskIds,
  };
}

export async function runClientCardBitrix24Sync(
  options: ClientCardSyncOptions,
): Promise<ClientCardSyncResponse> {
  const env = options.env ?? process.env;
  const scope = await resolveManualSyncScope(options.context, options.cardGuid, {
    objectType: options.objectType,
    objectGuid: options.objectGuid,
    holdingGuid: options.holdingGuid,
  });
  if (!scope.ok) {
    const status = scope.code === "NOT_CONFIGURED" ? 503 : 403;
    return denyResponse(status, scope.code);
  }

  const batch = await syncTaskBatch(options, scope, env);
  if (batch.lockDeny && !batch.lockDeny.ok) {
    return denyResponse(429, batch.lockDeny.code, batch.lockDeny.retryAfterMs);
  }
  if (batch.sourceDeny) {
    return denyResponse(403, batch.sourceDeny);
  }

  const postDeny = await verifyManualSyncOutcome(
    options.context,
    scope.portalId,
    options.cardGuid,
    batch.writtenTaskIds,
  );
  if (postDeny) {
    return denyResponse(403, postDeny);
  }

  const result = batch.aggregate;
  const finishedAt = new Date();

  if (!result.ok && result.status === "failed" && result.tasksFetched === 0 && result.cacheWrites === 0) {
    return {
      httpStatus: 200,
      body: {
        status: "failed",
        complete: false,
        message: mapTransportFailure(result.message),
        syncedAt: finishedAt.toISOString(),
        syncedAtLabel: formatMskDateTime(finishedAt),
        tasksSynced: 0,
        checklistsSynced: 0,
      },
    };
  }

  const responseStatus = result.status === "skipped" ? "failed" : result.status;

  return {
    httpStatus: 200,
    body: {
      status: responseStatus,
      complete: result.complete,
      message: mapSyncResultMessage(result),
      syncedAt: finishedAt.toISOString(),
      syncedAtLabel: formatMskDateTime(finishedAt),
      tasksSynced: result.cacheWrites,
      checklistsSynced: result.checklistsSynced,
    },
  };
}
