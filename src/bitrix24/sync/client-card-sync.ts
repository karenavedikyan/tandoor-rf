import type { AccessContext } from "../../access/types";
import type { PinnedRequestFn } from "../pinned-request";
import type { ResolvePortalAddressesFn } from "../dns-resolve";
import { loadBitrix24Config } from "../config";
import { createOperationContext } from "../transport";
import { formatMskDateTime } from "../../clients/dto";
import { requirePool } from "../../db/pool";
import {
  findTaskSnapshotById,
  unpublishResponsibleTasksNotInSet,
} from "../tasks/repository";
import { isObjectLinkedToClientCard } from "../tasks/object-access";
import { ensureEmployeePortalLinkVerified } from "../tasks/employee-verification";
import {
  acquireManualSyncCardLock,
  acquireManualSyncLocks,
  loadManualSyncMinIntervalMs,
  type ManualSyncLockResult,
} from "./manual-sync-lock";
import { runBitrix24TaskSync, type Bitrix24SyncResult } from "./run-sync";
import { discoverResponsibleTasksForCard } from "./task-discovery";
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
  syncedTaskIds: string[];
};

function emptySyncResult(): Bitrix24SyncResult {
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
    complete: true,
    message: "success",
  };
}

function mapSyncResultMessage(result: Bitrix24SyncResult): string {
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
  return {
    ...aggregate,
    ok: aggregate.ok && result.ok,
    status:
      aggregate.status === "failed" || result.status === "failed"
        ? aggregate.status === "partial" || result.status === "partial"
          ? "partial"
          : "failed"
        : aggregate.status === "partial" || result.status === "partial"
          ? "partial"
          : "success",
    tasksFetched: aggregate.tasksFetched + result.tasksFetched,
    cacheWrites: aggregate.cacheWrites + result.cacheWrites,
    checklistsSynced: aggregate.checklistsSynced + result.checklistsSynced,
    checklistsFailed: aggregate.checklistsFailed + result.checklistsFailed,
    complete: aggregate.complete && result.complete,
    message: result.complete ? aggregate.message : result.message,
  };
}

async function syncTaskBatch(
  options: ClientCardSyncOptions,
  scope: Extract<ManualSyncScopeResult, { ok: true }>,
  env: NodeJS.ProcessEnv,
): Promise<SyncBatchResult> {
  const loaded = loadBitrix24Config(env);
  if (!loaded.ok) {
    return {
      aggregate: { ...emptySyncResult(), ok: false, status: "failed", complete: false, message: "NOT_CONFIGURED" },
      sourceDeny: "NOT_CONFIGURED",
      lockDeny: null,
      syncedTaskIds: [],
    };
  }

  const operation = createOperationContext(loaded.config);
  operation.pinnedRequest = options.pinnedRequest;
  operation.resolvePortalAddresses = options.resolvePortalAddresses;

  const verification = await ensureEmployeePortalLinkVerified(
    options.context.userId,
    scope.portalId,
    loaded.config,
    operation,
    { force: scope.mode === "working" },
  );
  if (!verification.ok) {
    return {
      aggregate: emptySyncResult(),
      sourceDeny: verification.code as ManualSyncDenyCode,
      lockDeny: null,
      syncedTaskIds: [],
    };
  }

  let taskIdsToSync = [...scope.taskIds];
  let discoveryComplete = true;
  if (scope.mode === "working") {
    const discovery = await discoverResponsibleTasksForCard({
      config: loaded.config,
      bitrixUserId: scope.bitrixUserId,
      cardGuid: options.cardGuid,
      holdingGuid: scope.holdingGuid,
      operation,
    });
    taskIdsToSync = discovery.taskIds;
    discoveryComplete = discovery.complete;
  }

  const minIntervalMs = loadManualSyncMinIntervalMs(env);
  const cardLock = await acquireManualSyncCardLock(
    scope.portalId,
    options.cardGuid,
    options.context.userId,
    minIntervalMs,
  );
  if (!cardLock.ok) {
    return {
      aggregate: emptySyncResult(),
      sourceDeny: null,
      lockDeny: cardLock,
      syncedTaskIds: [],
    };
  }

  const taskLock =
    taskIdsToSync.length > 0
      ? await acquireManualSyncLocks(scope.portalId, taskIdsToSync, minIntervalMs)
      : { ok: true as const, release: async () => {} };
  if (!taskLock.ok) {
    await cardLock.release();
    return {
      aggregate: emptySyncResult(),
      sourceDeny: null,
      lockDeny: taskLock,
      syncedTaskIds: [],
    };
  }

  let aggregate: Bitrix24SyncResult | null = taskIdsToSync.length === 0 ? emptySyncResult() : null;
  let sourceDeny: ManualSyncDenyCode | null = null;
  try {
    for (const taskId of taskIdsToSync) {
      if (operation.deadline.expired()) {
        aggregate = aggregate
          ? { ...aggregate, status: "partial", complete: false }
          : { ...emptySyncResult(), status: "partial", complete: false };
        discoveryComplete = false;
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
      if (sourceDeny) break;
    }

    if (scope.mode === "working" && discoveryComplete && !sourceDeny) {
      await unpublishResponsibleTasksNotInSet({
        portalId: scope.portalId,
        bitrixUserId: scope.bitrixUserId,
        objectType: scope.objectType,
        objectGuid: scope.objectGuid,
        holdingGuid: scope.holdingGuid,
        keepTaskIds: taskIdsToSync,
      });
    }
  } finally {
    await taskLock.release();
    await cardLock.release();
  }

  return {
    aggregate: aggregate ?? emptySyncResult(),
    sourceDeny,
    lockDeny: null,
    syncedTaskIds: taskIdsToSync,
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
    batch.syncedTaskIds,
  );
  if (postDeny) {
    return denyResponse(403, postDeny);
  }

  const result = batch.aggregate;
  const finishedAt = new Date();

  if (!result.ok && result.status === "failed" && result.tasksFetched === 0) {
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
