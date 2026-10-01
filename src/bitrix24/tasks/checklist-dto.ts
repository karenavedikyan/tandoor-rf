import { formatMskDateTime } from "../../clients/dto";
import { buildChecklistTree, type NormalizedChecklistItem } from "../normalize-checklist";
import type { Bitrix24ObjectType } from "../labels/format";
import { loadBitrix24TasksRuntimeConfig } from "./config";
import { resolveConfirmedResponsibleProfile } from "./responsible-profile";
import { guardPastTimestamp } from "./timestamp-guard";
import {
  findChecklistSnapshot,
  isChecklistBindingMatch,
  isChecklistGenerationMatch,
  type ChecklistSnapshotRow,
} from "./checklist-repository";

export type ChecklistPublicState =
  | { state: "not_loaded" }
  | { state: "empty"; syncedAtLabel: string }
  | { state: "error"; syncedAtLabel: string | null }
  | { state: "partial"; syncedAtLabel: string | null }
  | { state: "stale"; syncedAtLabel: string | null }
  | {
      state: "ready";
      syncedAtLabel: string;
      progress: { completed: number; total: number };
      items: ChecklistItemPublicNode[];
    };

export type ChecklistItemPublicNode = {
  id: string;
  title: string;
  isGroup: boolean;
  isComplete: boolean | null;
  sortIndex: number;
  coExecutorNames: string[];
  children: ChecklistItemPublicNode[];
};

function formatDisplayDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return formatMskDateTime(date);
}

async function resolveCoExecutorNames(
  portalId: string,
  bitrixUserIds: string[],
): Promise<string[]> {
  const names: string[] = [];
  for (const bitrixUserId of bitrixUserIds) {
    const profile = await resolveConfirmedResponsibleProfile(portalId, bitrixUserId);
    if (profile.state === "confirmed" && !names.includes(profile.displayName)) {
      names.push(profile.displayName);
    }
  }
  return names;
}

async function buildPublicTree(
  portalId: string,
  items: NormalizedChecklistItem[],
): Promise<ChecklistItemPublicNode[]> {
  const tree = buildChecklistTree(items);
  async function mapNode(node: ReturnType<typeof buildChecklistTree>[number]): Promise<ChecklistItemPublicNode> {
    const source = items.find((entry) => entry.itemId === node.id);
    const children = await Promise.all(node.children.map((child) => mapNode(child)));
    return {
      id: node.id,
      title: node.title,
      isGroup: node.isGroup,
      isComplete: node.isComplete,
      sortIndex: node.sortIndex,
      coExecutorNames: node.isGroup || !source
        ? []
        : await resolveCoExecutorNames(portalId, source.coExecutorBitrixIds),
      children,
    };
  }
  return Promise.all(tree.map((node) => mapNode(node)));
}

function evaluateSnapshotFreshness(
  snapshot: ChecklistSnapshotRow,
  taskCacheVersion: number,
  taskSyncedAt: string,
  nowMs = Date.now(),
): "ready" | "stale" | "future" | "invalid" {
  if (!isChecklistGenerationMatch(snapshot, taskCacheVersion, taskSyncedAt)) {
    return "stale";
  }
  const syncedGuard = guardPastTimestamp(snapshot.syncedAt, nowMs);
  if (!syncedGuard.ok) {
    return syncedGuard.reason === "future" ? "future" : "stale";
  }
  const runtime = loadBitrix24TasksRuntimeConfig();
  const syncedAtMs = Date.parse(snapshot.syncedAt);
  const taskSyncedAtMs = Date.parse(taskSyncedAt);
  if (!Number.isFinite(taskSyncedAtMs) || syncedAtMs < taskSyncedAtMs) {
    return "stale";
  }
  if (runtime.cacheAccessTtlMs > 0 && syncedAtMs + runtime.cacheAccessTtlMs < nowMs) {
    return "stale";
  }
  return "ready";
}

function mapSnapshotToPublic(
  snapshot: ChecklistSnapshotRow,
  publicTree: ChecklistItemPublicNode[],
  freshness: "ready" | "stale" | "future" | "invalid",
): ChecklistPublicState {
  const syncedAtLabel = formatDisplayDate(snapshot.syncedAt);
  if (freshness === "stale") {
    return { state: "stale", syncedAtLabel };
  }
  if (freshness === "future" || freshness === "invalid") {
    return { state: "error", syncedAtLabel };
  }

  switch (snapshot.loadStatus) {
    case "empty":
      return syncedAtLabel
        ? { state: "empty", syncedAtLabel }
        : { state: "not_loaded" };
    case "error":
      return { state: "error", syncedAtLabel };
    case "partial":
      return { state: "partial", syncedAtLabel };
    case "loaded":
      if (
        !snapshot.syncComplete ||
        snapshot.progressCompleted === null ||
        snapshot.progressTotal === null
      ) {
        return { state: "partial", syncedAtLabel };
      }
      return syncedAtLabel
        ? {
            state: "ready",
            syncedAtLabel,
            progress: {
              completed: snapshot.progressCompleted,
              total: snapshot.progressTotal,
            },
            items: publicTree,
          }
        : { state: "not_loaded" };
    default:
      return { state: "not_loaded" };
  }
}

export async function buildChecklistPublicDto(input: {
  portalId: string;
  taskId: string;
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  taskCacheVersion: number;
  taskSyncedAt: string;
  /** Skip building item tree — list views only need progress/state. */
  listMode?: boolean;
}): Promise<ChecklistPublicState> {
  const snapshot = await findChecklistSnapshot(input.portalId, input.taskId);
  if (!snapshot) {
    return { state: "not_loaded" };
  }
  if (!isChecklistBindingMatch(snapshot, input.objectType, input.objectGuid)) {
    return { state: "not_loaded" };
  }
  const freshness = evaluateSnapshotFreshness(
    snapshot,
    input.taskCacheVersion,
    input.taskSyncedAt,
  );
  const publicTree =
    freshness === "ready" && !input.listMode
      ? await buildPublicTree(input.portalId, snapshot.itemsJson)
      : [];
  return mapSnapshotToPublic(snapshot, publicTree, freshness);
}
