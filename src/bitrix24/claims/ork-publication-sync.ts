import type { PoolClient } from "pg";
import type { Bitrix24ObjectType } from "../labels/format";
import { evaluateOrkPublishAuthority } from "./ork-publication-auth";
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
  responsibleBitrixUserId: string | null;
  description: string | null;
  taskCacheVersion: number;
  syncExecutorUserId?: string | null;
  publishAllowed: boolean;
};

export type OrkPublicationSyncResult = {
  action:
    | "none"
    | "published"
    | "updated"
    | "revoked"
    | "skipped_admin"
    | "skipped_unauthorized"
    | "skipped_stale";
  denyCode?: string;
  denyMessage?: string;
  parseReason?: string;
};

async function revokeOrkPublication(
  input: OrkPublicationSyncInput,
  client: PoolClient,
): Promise<boolean> {
  const result = await applyOrkSummaryPublicationSync(
    {
      portalId: input.portalId,
      taskId: input.taskId,
      objectType: input.objectType,
      objectGuid: input.objectGuid,
      taskCacheVersion: input.taskCacheVersion,
      syncExecutorUserId: input.syncExecutorUserId ?? null,
      briefText: null,
    },
    client,
  );
  return result === "revoked";
}

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
    const revoked = await revokeOrkPublication(input, client);
    return { action: revoked ? "revoked" : "none" };
  }

  const parsed = parseOrkSummaryFromDescription(input.description);
  if (!parsed.ok) {
    const revoked = await revokeOrkPublication(input, client);
    return {
      action: revoked ? "revoked" : "none",
      parseReason: parsed.reason,
    };
  }

  const authority = await evaluateOrkPublishAuthority({
    portalId: input.portalId,
    responsibleBitrixUserId: input.responsibleBitrixUserId,
    syncExecutorUserId: input.syncExecutorUserId,
  });
  if (!authority.ok) {
    const staleActive =
      active?.publicationOrigin === "ork_sync" &&
      (active.taskCacheVersion === null ||
        active.taskCacheVersion !== input.taskCacheVersion);
    if (staleActive) {
      const revoked = await revokeOrkPublication(input, client);
      return {
        action: revoked ? "revoked" : "none",
        denyCode: authority.code,
        denyMessage: authority.message,
      };
    }
    return {
      action: "skipped_unauthorized",
      denyCode: authority.code,
      denyMessage: authority.message,
    };
  }

  const result = await applyOrkSummaryPublicationSync(
    {
      portalId: input.portalId,
      taskId: input.taskId,
      objectType: input.objectType!,
      objectGuid: input.objectGuid!,
      taskCacheVersion: input.taskCacheVersion,
      syncExecutorUserId: authority.executorUserId,
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
