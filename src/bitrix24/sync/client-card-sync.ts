import type { AccessContext } from "../../access/types";
import type { PinnedRequestFn } from "../pinned-request";
import type { ResolvePortalAddressesFn } from "../dns-resolve";
import { formatMskDateTime } from "../../clients/dto";
import {
  acquireManualSyncLocks,
  loadManualSyncMinIntervalMs,
} from "./manual-sync-lock";
import { runBitrix24TaskSync, type Bitrix24SyncResult } from "./run-sync";
import {
  mapManualSyncDenyMessage,
  resolveManualSyncScope,
  verifyManualSyncOutcome,
  type ManualSyncDenyCode,
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
    const status =
      scope.code === "NOT_CONFIGURED"
        ? 503
        : scope.code === "TASK_NOT_ON_CARD" ||
            scope.code === "SUMMARY_ONLY" ||
            scope.code === "BINDING_UNCONFIRMED"
          ? 403
          : 403;
    return denyResponse(status, scope.code);
  }

  const minIntervalMs = loadManualSyncMinIntervalMs(env);
  const lock = await acquireManualSyncLocks(scope.portalId, scope.taskIds, minIntervalMs);
  if (!lock.ok) {
    return denyResponse(429, lock.code, lock.retryAfterMs);
  }

  let aggregate: Bitrix24SyncResult | null = null;
  try {
    for (const taskId of scope.taskIds) {
      const result = await runBitrix24TaskSync({
        bitrixUserId: scope.bitrixUserId,
        apply: true,
        taskId,
        pinnedRequest: options.pinnedRequest,
        resolvePortalAddresses: options.resolvePortalAddresses,
        env,
      });
      aggregate = aggregate ? mergeSyncResults(aggregate, result) : result;
    }
  } finally {
    await lock.release();
  }

  const result = aggregate!;
  const postDeny = await verifyManualSyncOutcome(
    options.context,
    scope.portalId,
    options.cardGuid,
    scope.taskIds,
  );
  if (postDeny) {
    return denyResponse(403, postDeny);
  }

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
