import { createHash } from "node:crypto";
import { loadBitrix24Config } from "../config";
import { extractLabelsFromDescription } from "../labels/parser";
import { findLabelByCode } from "../labels/repository";
import { computeChecklistProgress } from "../normalize-checklist";
import { readBitrixChecklistForTask } from "../read-checklist";
import { readBitrixTasksForUser } from "../read-tasks";
import { createOperationContext } from "../transport";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../tasks/config";
import { upsertChecklistSnapshot } from "../tasks/checklist-repository";
import {
  buildSyncScopeSummary,
  insertSyncJournalEntry,
  isPortalBitrixUserConfirmed,
  recordBindingDiagnostic,
  upsertTaskSnapshot,
} from "../tasks/repository";
import { requirePool } from "../../db/pool";
import type { Bitrix24ObjectType } from "../labels/format";
import type { PinnedRequestFn } from "../pinned-request";
import type { ResolvePortalAddressesFn } from "../dns-resolve";
import type { PoolClient } from "pg";
import type { Bitrix24OperationContext, Bitrix24WebhookConfig } from "../types";

export type Bitrix24SyncOptions = {
  bitrixUserId: string;
  apply: boolean;
  maxPages?: number;
  taskId?: string;
  pinnedRequest?: PinnedRequestFn;
  resolvePortalAddresses?: ResolvePortalAddressesFn;
  env?: NodeJS.ProcessEnv;
};

export type Bitrix24SyncResult = {
  ok: boolean;
  status: "success" | "partial" | "failed" | "skipped";
  mode: "dry_run" | "apply";
  tasksFetched: number;
  bindingsConfirmed: number;
  bindingsConflict: number;
  bindingsInvalid: number;
  bindingsPending: number;
  cacheWrites: number;
  versionConflicts: number;
  checklistsSynced: number;
  checklistsFailed: number;
  complete: boolean;
  truncatedReason?: string;
  message: string;
  journalId?: string;
};

function hashDescription(description: string | null): string {
  return createHash("sha256").update(description ?? "").digest("hex");
}

async function syncTaskChecklistSnapshot(
  config: Bitrix24WebhookConfig,
  operation: Bitrix24OperationContext,
  client: PoolClient,
  input: {
    taskId: string;
    objectType: Bitrix24ObjectType | null;
    objectGuid: string | null;
  },
): Promise<"synced" | "failed"> {
  const readResult = await readBitrixChecklistForTask(config, input.taskId, { operation });
  if (!readResult.ok) {
    await upsertChecklistSnapshot(
      {
        portalId: config.portalId,
        taskId: input.taskId,
        objectType: input.objectType,
        objectGuid: input.objectGuid,
        loadStatus: "error",
        syncComplete: false,
        errorCode: readResult.code,
        items: [],
      },
      client,
    );
    return "failed";
  }

  const data = readResult.data;
  if (!data.complete) {
    await upsertChecklistSnapshot(
      {
        portalId: config.portalId,
        taskId: input.taskId,
        objectType: input.objectType,
        objectGuid: input.objectGuid,
        loadStatus: "partial",
        syncComplete: false,
        errorCode: data.truncatedReason ?? "INCOMPLETE",
        items: [],
      },
      client,
    );
    return "failed";
  }

  const progress = computeChecklistProgress(data.items);
  const loadStatus = progress.total === 0 ? "empty" : "loaded";
  await upsertChecklistSnapshot(
    {
      portalId: config.portalId,
      taskId: input.taskId,
      objectType: input.objectType,
      objectGuid: input.objectGuid,
      loadStatus,
      syncComplete: true,
      items: data.items,
    },
    client,
  );
  return "synced";
}

export async function runBitrix24TaskSync(
  options: Bitrix24SyncOptions,
): Promise<Bitrix24SyncResult> {
  const env = options.env ?? process.env;
  const loaded = loadBitrix24Config(env);
  const mode = options.apply ? "apply" : "dry_run";

  if (!loaded.ok) {
    return {
      ok: false,
      status: "failed",
      mode,
      tasksFetched: 0,
      bindingsConfirmed: 0,
      bindingsConflict: 0,
      bindingsInvalid: 0,
      bindingsPending: 0,
      cacheWrites: 0,
      versionConflicts: 0,
      checklistsSynced: 0,
      checklistsFailed: 0,
      complete: false,
      message: "Bitrix24 is not configured.",
    };
  }

  const config = loaded.config;
  const runtime = loadBitrix24TasksRuntimeConfig(env);
  const publishAllowed = isCachePublishAllowed(runtime);
  const scopeSummary = buildSyncScopeSummary(config.portalId, options.bitrixUserId)
    + (options.taskId ? `;task_id=${options.taskId}` : "");

  const confirmed = await isPortalBitrixUserConfirmed(config.portalId, options.bitrixUserId);
  if (!confirmed) {
    const journalId = options.apply
      ? await insertSyncJournalEntry({
          runMode: "apply",
          scopeSummary,
          status: "failed",
          summary: { reason: "UNCONFIRMED_BITRIX_USER", bitrixUserId: options.bitrixUserId },
        })
      : undefined;
    return {
      ok: false,
      status: "failed",
      mode,
      tasksFetched: 0,
      bindingsConfirmed: 0,
      bindingsConflict: 0,
      bindingsInvalid: 0,
      bindingsPending: 0,
      cacheWrites: 0,
      versionConflicts: 0,
      checklistsSynced: 0,
      checklistsFailed: 0,
      complete: false,
      message: "Bitrix user is not linked to this portal.",
      journalId,
    };
  }

  const operation = createOperationContext(config);
  operation.pinnedRequest = options.pinnedRequest;
  operation.resolvePortalAddresses = options.resolvePortalAddresses;

  const readResult = await readBitrixTasksForUser(config, options.bitrixUserId, {
    operation,
    maxPages: options.maxPages ?? config.maxPages,
    taskId: options.taskId,
  });

  if (!readResult.ok || (options.taskId !== undefined && (!readResult.data.complete || readResult.data.tasks.length !== 1))) {
    const reason = readResult.ok ? "PILOT_TASK_NOT_COMPLETE" : readResult.code;
    const message = readResult.ok ? "Pilot task is missing or incomplete; no cache writes." : readResult.message;
    const journalId = options.apply
      ? await insertSyncJournalEntry({
          runMode: "apply",
          scopeSummary,
          status: "failed",
          summary: {
            reason,
            message,
            bitrixUserId: options.bitrixUserId,
          },
        })
      : undefined;
    return {
      ok: false,
      status: "failed",
      mode,
      tasksFetched: 0,
      bindingsConfirmed: 0,
      bindingsConflict: 0,
      bindingsInvalid: 0,
      bindingsPending: 0,
      cacheWrites: 0,
      versionConflicts: 0,
      checklistsSynced: 0,
      checklistsFailed: 0,
      complete: false,
      message,
      journalId,
    };
  }

  let bindingsConfirmed = 0;
  let bindingsConflict = 0;
  let bindingsInvalid = 0;
  let bindingsPending = 0;
  let cacheWrites = 0;
  let versionConflicts = 0;
  let checklistsSynced = 0;
  let checklistsFailed = 0;
  const pool = requirePool();
  const client = options.apply ? await pool.connect() : null;
  let journalId: string | undefined;

  try {
    if (client) {
      await client.query("BEGIN");
    }

    for (const task of readResult.data.tasks) {
      const parsedLabels = extractLabelsFromDescription(task.description);
      let bindingStatus = "unresolved";
      let conflictReason: string | null = null;
      let objectType = null;
      let objectGuid = null;
      let labelCode = null;
      let linkedAt: string | null = null;

      if (!parsedLabels.ok) {
        bindingStatus = parsedLabels.reason === "invalid_token" ? "invalid_label" : "conflict";
        conflictReason = parsedLabels.reason;
        if (parsedLabels.reason === "invalid_token") {
          bindingsInvalid += 1;
        } else {
          bindingsConflict += 1;
        }
      } else if (parsedLabels.labels.length === 0) {
        bindingStatus = "unresolved";
      } else {
        const token = parsedLabels.labels[0]!;
        labelCode = token.labelCode;
        const registry = await findLabelByCode(labelCode, client ?? undefined);
        if (!registry) {
          bindingStatus = "pending_confirmation";
          bindingsPending += 1;
        } else {
          bindingStatus = "confirmed";
          objectType = registry.objectType;
          objectGuid = registry.objectGuid;
          linkedAt = new Date().toISOString();
          bindingsConfirmed += 1;
        }
      }

      if (options.apply && client && bindingStatus !== "confirmed" && bindingStatus !== "unresolved") {
        await recordBindingDiagnostic(
          config.portalId,
          task.taskId,
          bindingStatus,
          conflictReason,
          client,
        );
      }

      if (options.apply && client) {
        const writeResult = await upsertTaskSnapshot(
          {
            portalId: config.portalId,
            taskId: task.taskId,
            responsibleBitrixUserId: task.responsibleId,
            title: task.title,
            statusLabel: task.statusLabel,
            deadline: task.deadline,
            changedAt: task.changedAt ?? "",
            descriptionHash: hashDescription(task.description),
            published: publishAllowed,
            objectType,
            objectGuid,
            labelCode,
            bindingStatus,
            conflictReason,
            linkedAt,
          },
          client,
        );
        if (writeResult.cacheUpdated) {
          cacheWrites += 1;
        }
        if (writeResult.versionConflict) {
          versionConflicts += 1;
          await recordBindingDiagnostic(
            config.portalId,
            task.taskId,
            "version_conflict",
            "same_changed_at_different_content",
            client,
          );
        }

        const checklistResult = await syncTaskChecklistSnapshot(config, operation, client, {
          taskId: task.taskId,
          objectType,
          objectGuid,
        });
        if (checklistResult === "synced") {
          checklistsSynced += 1;
        } else {
          checklistsFailed += 1;
        }
      }
    }

    const runStatus = readResult.data.complete ? "success" : "partial";

    if (client) {
      journalId = await insertSyncJournalEntry(
        {
          runMode: mode,
          scopeSummary,
          status: runStatus,
          summary: {
            tasksFetched: readResult.data.tasks.length,
            bindingsConfirmed,
            bindingsConflict,
            bindingsInvalid,
            bindingsPending,
            cacheWrites,
            versionConflicts,
            checklistsSynced,
            checklistsFailed,
            truncatedReason: readResult.data.truncatedReason ?? null,
          },
        },
        client,
      );
      await client.query("COMMIT");
    }
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK");
      journalId = await insertSyncJournalEntry({
        runMode: mode,
        scopeSummary,
        status: "failed",
        summary: {
          reason: "APPLY_ROLLBACK",
          message: error instanceof Error ? error.message : "sync_apply_failed",
          bitrixUserId: options.bitrixUserId,
        },
      });
    }
    return {
      ok: false,
      status: "failed",
      mode,
      tasksFetched: readResult.data.tasks.length,
      bindingsConfirmed,
      bindingsConflict,
      bindingsInvalid,
      bindingsPending,
      cacheWrites,
      versionConflicts,
      checklistsSynced,
      checklistsFailed,
      complete: false,
      message: "Bitrix24 task sync apply failed and was rolled back.",
      journalId,
    };
  } finally {
    client?.release();
  }

  const complete = readResult.data.complete;
  const status = complete ? "success" : "partial";

  return {
    ok: complete,
    status,
    mode,
    tasksFetched: readResult.data.tasks.length,
    bindingsConfirmed,
    bindingsConflict,
    bindingsInvalid,
    bindingsPending,
    cacheWrites,
    versionConflicts,
    checklistsSynced,
    checklistsFailed,
    complete,
    truncatedReason: readResult.data.truncatedReason,
    message: complete
      ? options.apply
        ? "Bitrix24 task sync applied to local cache."
        : "Bitrix24 task sync dry-run completed."
      : "Bitrix24 task sync completed with partial result.",
    journalId,
  };
}
