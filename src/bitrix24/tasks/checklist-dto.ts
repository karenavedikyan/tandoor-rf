import { formatMskDateTime } from "../../clients/dto";
import { buildChecklistTree, type NormalizedChecklistItem } from "../normalize-checklist";
import type { Bitrix24ObjectType } from "../labels/format";
import { resolveConfirmedResponsibleProfile } from "./responsible-profile";
import {
  findChecklistSnapshot,
  isChecklistBindingMatch,
  type ChecklistSnapshotRow,
} from "./checklist-repository";

export type ChecklistPublicState =
  | { state: "not_loaded" }
  | { state: "empty"; syncedAtLabel: string }
  | { state: "error"; syncedAtLabel: string | null }
  | { state: "partial"; syncedAtLabel: string | null }
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
  responsibleName: string | null;
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

async function resolveItemResponsibleName(
  portalId: string,
  items: NormalizedChecklistItem[],
  itemId: string,
): Promise<string | null> {
  const item = items.find((entry) => entry.itemId === itemId);
  if (!item || item.memberBitrixIds.length !== 1) {
    return null;
  }
  const profile = await resolveConfirmedResponsibleProfile(portalId, item.memberBitrixIds[0]);
  return profile.state === "confirmed" ? profile.displayName : null;
}

async function buildPublicTree(
  portalId: string,
  items: NormalizedChecklistItem[],
): Promise<ChecklistItemPublicNode[]> {
  const tree = buildChecklistTree(items);
  async function mapNode(node: ReturnType<typeof buildChecklistTree>[number]): Promise<ChecklistItemPublicNode> {
    const children = await Promise.all(node.children.map((child) => mapNode(child)));
    return {
      id: node.id,
      title: node.title,
      isGroup: node.isGroup,
      isComplete: node.isComplete,
      sortIndex: node.sortIndex,
      responsibleName: node.isGroup ? null : await resolveItemResponsibleName(portalId, items, node.id),
      children,
    };
  }
  return Promise.all(tree.map((node) => mapNode(node)));
}

function mapSnapshotToPublic(
  snapshot: ChecklistSnapshotRow,
  items: NormalizedChecklistItem[],
  publicTree: ChecklistItemPublicNode[],
): ChecklistPublicState {
  const syncedAtLabel = formatDisplayDate(snapshot.syncedAt);
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
}): Promise<ChecklistPublicState> {
  const snapshot = await findChecklistSnapshot(input.portalId, input.taskId);
  if (!snapshot) {
    return { state: "not_loaded" };
  }
  if (!isChecklistBindingMatch(snapshot, input.objectType, input.objectGuid)) {
    return { state: "not_loaded" };
  }
  const publicTree = await buildPublicTree(input.portalId, snapshot.itemsJson);
  return mapSnapshotToPublic(snapshot, snapshot.itemsJson, publicTree);
}
