import type { PoolClient } from "pg";
import type { Bitrix24ObjectType } from "../labels/format";
import { parseOrkSummaryFromDescription } from "./ork-parser";
import {
  applyOrkSummaryPublicationSync,
  findActiveSummaryPublicationMeta,
} from "../tasks/work-repository";

export type OrkPublicationSyncInput = {
  portalId: string;
  taskId: string;
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  bindingStatus: string;
  description: string | null;
  taskCacheVersion: number;
  syncExecutorUserId: string;
  publishAllowed: boolean;
};

export type OrkPublicationSyncResult =
  | { action: "none" | "published" | "updated" | "revoked" | "skipped_admin" | "skipped_stale" }
  ;

export async function syncOrkPublicationFromDescription(
  input: OrkPublicationSyncInput,
  client: PoolClient,
): Promise<OrkPublicationSyncResult> {
  if (!input.publishAllowed) {
    return { action: "none" };
  }

  const active = await findActiveSummaryPublicationMeta(input.portalId, input.taskId, client);
  if (active?.publicationOrigin === "admin") {
    return { action: "skipped_admin" };
  }

  const bindingReady =
    input.bindingStatus === "confirmed" &&
    input.objectType !== null &&
    input.objectGuid !== null;

  if (!bindingReady) {
    const revoked = await applyOrkSummaryPublicationSync(
      {
        portalId: input.portalId,
        taskId: input.taskId,
        objectType: input.objectType,
        objectGuid: input.objectGuid,
        taskCacheVersion: input.taskCacheVersion,
        syncExecutorUserId: input.syncExecutorUserId,
        briefText: null,
      },
      client,
    );
    return { action: revoked ? "revoked" : "none" };
  }

  const parsed = parseOrkSummaryFromDescription(input.description);
  if (!parsed.ok) {
    const revoked = await applyOrkSummaryPublicationSync(
      {
        portalId: input.portalId,
        taskId: input.taskId,
        objectType: input.objectType!,
        objectGuid: input.objectGuid!,
        taskCacheVersion: input.taskCacheVersion,
        syncExecutorUserId: input.syncExecutorUserId,
        briefText: null,
      },
      client,
    );
    return { action: revoked ? "revoked" : "none" };
  }

  const result = await applyOrkSummaryPublicationSync(
    {
      portalId: input.portalId,
      taskId: input.taskId,
      objectType: input.objectType!,
      objectGuid: input.objectGuid!,
      taskCacheVersion: input.taskCacheVersion,
      syncExecutorUserId: input.syncExecutorUserId,
      briefText: parsed.briefText,
    },
    client,
  );
  if (result === "inserted") {
    return { action: "published" };
  }
  if (result === "updated") {
    return { action: "updated" };
  }
  return { action: "none" };
}
