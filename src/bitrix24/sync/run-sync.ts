import { createHash } from "node:crypto";
import { loadBitrix24Config } from "../config";
import { extractLabelsFromDescription } from "../labels/parser";
import { findLabelByCode } from "../labels/repository";
import { readBitrixTasksForUser } from "../read-tasks";
import { createOperationContext } from "../transport";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../tasks/config";
import {
  insertSyncJournalEntry,
  isPortalBitrixUserConfirmed,
  recordBindingDiagnostic,
  upsertTaskSnapshot,
} from "../tasks/repository";
import { requirePool } from "../../db/pool";
import type { PinnedRequestFn } from "../pinned-request";
import type { ResolvePortalAddressesFn } from "../dns-resolve";

export type Bitrix24SyncOptions = {
  bitrixUserId: string;
  apply: boolean;
  maxPages?: number;
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
  complete: boolean;
  truncatedReason?: string;
  message: string;
  journalId?: string;
};

function hashDescription(description: string | null): string {
  return createHash("sha256").update(description ?? "").digest("hex");
}

function buildScopeSummary(portalId: string, bitrixUserId: string): string {
  return `portal_id=${portalId};bitrix_user_id=${bitrixUserId}`;
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
      complete: false,
      message: "Bitrix24 is not configured.",
    };
  }

  const config = loaded.config;
  const runtime = loadBitrix24TasksRuntimeConfig(env);
  const publishAllowed = isCachePublishAllowed(runtime);
  const scopeSummary = buildScopeSummary(config.portalId, options.bitrixUserId);

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
  });

  if (!readResult.ok) {
    const journalId = options.apply
      ? await insertSyncJournalEntry({
          runMode: "apply",
          scopeSummary,
          status: "failed",
          summary: {
            reason: readResult.code,
            message: readResult.message,
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
      complete: false,
      message: readResult.message,
      journalId,
    };
  }

  let bindingsConfirmed = 0;
  let bindingsConflict = 0;
  let bindingsInvalid = 0;
  let bindingsPending = 0;
  let cacheWrites = 0;
  let versionConflicts = 0;
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
