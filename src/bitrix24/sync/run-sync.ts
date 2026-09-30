import { createHash } from "node:crypto";
import { loadBitrix24Config } from "../config";
import { extractLabelsFromDescription } from "../labels/parser";
import { findLabelByCode } from "../labels/repository";
import { readBitrixTasksForUser } from "../read-tasks";
import { createOperationContext } from "../transport";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../tasks/config";
import { recordBindingDiagnostic, upsertTaskSnapshot } from "../tasks/repository";
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
  mode: "dry_run" | "apply";
  tasksFetched: number;
  bindingsConfirmed: number;
  bindingsConflict: number;
  bindingsInvalid: number;
  bindingsPending: number;
  cacheWrites: number;
  complete: boolean;
  truncatedReason?: string;
  message: string;
};

function hashDescription(description: string | null): string {
  return createHash("sha256").update(description ?? "").digest("hex");
}

export async function runBitrix24TaskSync(
  options: Bitrix24SyncOptions,
): Promise<Bitrix24SyncResult> {
  const env = options.env ?? process.env;
  const loaded = loadBitrix24Config(env);
  if (!loaded.ok) {
    return {
      ok: false,
      mode: options.apply ? "apply" : "dry_run",
      tasksFetched: 0,
      bindingsConfirmed: 0,
      bindingsConflict: 0,
      bindingsInvalid: 0,
      bindingsPending: 0,
      cacheWrites: 0,
      complete: false,
      message: "Bitrix24 is not configured.",
    };
  }

  const config = loaded.config;
  const runtime = loadBitrix24TasksRuntimeConfig(env);
  const publishAllowed = isCachePublishAllowed(runtime);
  const operation = createOperationContext(config);
  operation.pinnedRequest = options.pinnedRequest;
  operation.resolvePortalAddresses = options.resolvePortalAddresses;

  const readResult = await readBitrixTasksForUser(config, options.bitrixUserId, {
    operation,
    maxPages: options.maxPages ?? config.maxPages,
  });

  if (!readResult.ok) {
    return {
      ok: false,
      mode: options.apply ? "apply" : "dry_run",
      tasksFetched: 0,
      bindingsConfirmed: 0,
      bindingsConflict: 0,
      bindingsInvalid: 0,
      bindingsPending: 0,
      cacheWrites: 0,
      complete: false,
      message: readResult.message,
    };
  }

  let bindingsConfirmed = 0;
  let bindingsConflict = 0;
  let bindingsInvalid = 0;
  let bindingsPending = 0;
  let cacheWrites = 0;
  const pool = requirePool();
  const client = options.apply ? await pool.connect() : null;

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
      }
    }

    if (client) {
      await client.query(
        `INSERT INTO bitrix24_sync_journal (run_mode, scope_summary, finished_at, status, summary)
         VALUES ($1, $2, NOW(), $3, $4::jsonb)`,
        [
          options.apply ? "apply" : "dry_run",
          `portal_id=${config.portalId};bitrix_user_id=${options.bitrixUserId}`,
          readResult.data.complete ? "success" : "partial",
          JSON.stringify({
            tasksFetched: readResult.data.tasks.length,
            bindingsConfirmed,
            bindingsConflict,
            bindingsInvalid,
            bindingsPending,
            cacheWrites,
          }),
        ],
      );
      await client.query("COMMIT");
    }
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client?.release();
  }

  return {
    ok: true,
    mode: options.apply ? "apply" : "dry_run",
    tasksFetched: readResult.data.tasks.length,
    bindingsConfirmed,
    bindingsConflict,
    bindingsInvalid,
    bindingsPending,
    cacheWrites,
    complete: readResult.data.complete,
    truncatedReason: readResult.data.truncatedReason,
    message: options.apply
      ? "Bitrix24 task sync applied to local cache."
      : "Bitrix24 task sync dry-run completed.",
  };
}
