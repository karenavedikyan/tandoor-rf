import { parseCanonicalBitrixId } from "./parse-id";

export type NormalizedChecklistItem = {
  itemId: string;
  parentId: string | null;
  title: string;
  sortIndex: number;
  isComplete: boolean;
  memberBitrixIds: string[];
  isRootGroup: boolean;
};

export type ChecklistProgress = {
  completed: number;
  total: number;
};

export type ChecklistTreeNode = {
  id: string;
  title: string;
  isGroup: boolean;
  isComplete: boolean | null;
  sortIndex: number;
  children: ChecklistTreeNode[];
};

function parseSortIndex(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function parseParentId(value: unknown): string | null {
  if (value === 0 || value === "0" || value === null || value === undefined) {
    return null;
  }
  return parseCanonicalBitrixId(String(value));
}

function parseIsComplete(value: unknown): boolean | null {
  if (value === "Y" || value === true) {
    return true;
  }
  if (value === "N" || value === false) {
    return false;
  }
  return null;
}

function extractMemberBitrixIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (record.TYPE !== "U") {
      continue;
    }
    const id = parseCanonicalBitrixId(record.ID);
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

export function normalizeChecklistItem(raw: unknown): NormalizedChecklistItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const itemId = parseCanonicalBitrixId(record.ID);
  if (!itemId) {
    return null;
  }
  const title = typeof record.TITLE === "string" ? record.TITLE.trim() : "";
  if (!title) {
    return null;
  }
  const isComplete = parseIsComplete(record.IS_COMPLETE);
  if (isComplete === null) {
    return null;
  }
  const parentId = parseParentId(record.PARENT_ID);
  return {
    itemId,
    parentId,
    title,
    sortIndex: parseSortIndex(record.SORT_INDEX),
    isComplete,
    memberBitrixIds: extractMemberBitrixIds(record.MEMBERS),
    isRootGroup: parentId === null,
  };
}

export function dedupeChecklistItems(items: NormalizedChecklistItem[]): NormalizedChecklistItem[] {
  const seen = new Set<string>();
  const result: NormalizedChecklistItem[] = [];
  for (const item of items) {
    if (seen.has(item.itemId)) {
      continue;
    }
    seen.add(item.itemId);
    result.push(item);
  }
  return result;
}

function childIdSet(items: NormalizedChecklistItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.parentId) {
      ids.add(item.parentId);
    }
  }
  return ids;
}

export function isActionableChecklistItem(
  item: NormalizedChecklistItem,
  parentsWithChildren: Set<string>,
): boolean {
  if (item.isRootGroup) {
    return false;
  }
  return !parentsWithChildren.has(item.itemId);
}

export function computeChecklistProgress(items: NormalizedChecklistItem[]): ChecklistProgress {
  const parentsWithChildren = childIdSet(items);
  let completed = 0;
  let total = 0;
  for (const item of items) {
    if (!isActionableChecklistItem(item, parentsWithChildren)) {
      continue;
    }
    total += 1;
    if (item.isComplete) {
      completed += 1;
    }
  }
  return { completed, total };
}

function sortNodes(nodes: ChecklistTreeNode[]): ChecklistTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.sortIndex !== right.sortIndex) {
      return left.sortIndex - right.sortIndex;
    }
    return left.id.localeCompare(right.id);
  });
}

export function buildChecklistTree(items: NormalizedChecklistItem[]): ChecklistTreeNode[] {
  const parentsWithChildren = childIdSet(items);
  const nodes = new Map<string, ChecklistTreeNode>();
  for (const item of items) {
    const actionable = isActionableChecklistItem(item, parentsWithChildren);
    nodes.set(item.itemId, {
      id: item.itemId,
      title: item.title,
      isGroup: !actionable,
      isComplete: actionable ? item.isComplete : null,
      sortIndex: item.sortIndex,
      children: [],
    });
  }

  const roots: ChecklistTreeNode[] = [];
  for (const item of items) {
    const node = nodes.get(item.itemId);
    if (!node) {
      continue;
    }
    if (!item.parentId) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(item.parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function finalizeTreeLevel(level: ChecklistTreeNode[]): ChecklistTreeNode[] {
    return sortNodes(level).map((node) => ({
      ...node,
      children: finalizeTreeLevel(node.children),
    }));
  }

  return finalizeTreeLevel(roots);
}
