import { parseCanonicalBitrixId } from "./parse-id";

export type NormalizedChecklistItem = {
  itemId: string;
  taskId: string;
  parentId: string | null;
  title: string;
  sortIndex: number;
  isComplete: boolean;
  coExecutorBitrixIds: string[];
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

export type ChecklistDedupeResult = {
  items: NormalizedChecklistItem[];
  duplicateConflict: boolean;
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

/** TYPE A = co-executor; TYPE U = observer (not shown as assignee). */
function extractCoExecutorBitrixIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (record.TYPE !== "A") {
      continue;
    }
    const id = parseCanonicalBitrixId(record.ID);
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

function parseTaskId(value: unknown, expectedTaskId: string): string | null {
  const parsed = parseCanonicalBitrixId(value);
  if (!parsed || parsed !== expectedTaskId) {
    return null;
  }
  return parsed;
}

export function normalizeChecklistItem(
  raw: unknown,
  expectedTaskId: string,
): NormalizedChecklistItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const itemId = parseCanonicalBitrixId(record.ID);
  if (!itemId) {
    return null;
  }
  const taskId = parseTaskId(record.TASK_ID, expectedTaskId);
  if (!taskId) {
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
    taskId,
    parentId,
    title,
    sortIndex: parseSortIndex(record.SORT_INDEX),
    isComplete,
    coExecutorBitrixIds: extractCoExecutorBitrixIds(record.MEMBERS),
    isRootGroup: parentId === null,
  };
}

function itemSignature(item: NormalizedChecklistItem): string {
  return [
    item.taskId,
    item.parentId ?? "",
    item.title,
    item.sortIndex,
    item.isComplete,
    item.coExecutorBitrixIds.join(","),
  ].join("|");
}

export function dedupeChecklistItems(items: NormalizedChecklistItem[]): ChecklistDedupeResult {
  const byId = new Map<string, NormalizedChecklistItem>();
  for (const item of items) {
    const prior = byId.get(item.itemId);
    if (prior) {
      if (itemSignature(prior) !== itemSignature(item)) {
        return { items: [], duplicateConflict: true };
      }
      continue;
    }
    byId.set(item.itemId, item);
  }
  return { items: [...byId.values()], duplicateConflict: false };
}

export function isProgressChecklistItem(item: NormalizedChecklistItem): boolean {
  return !item.isRootGroup;
}

export function computeChecklistProgress(items: NormalizedChecklistItem[]): ChecklistProgress {
  let completed = 0;
  let total = 0;
  for (const item of items) {
    if (!isProgressChecklistItem(item)) {
      continue;
    }
    total += 1;
    if (item.isComplete) {
      completed += 1;
    }
  }
  return { completed, total };
}

export type ChecklistStructureValidation =
  | { ok: true }
  | { ok: false; code: "TASK_ID_MISMATCH" | "MISSING_PARENT" | "CYCLE" | "DUPLICATE_CONFLICT" };

export function validateChecklistStructure(items: NormalizedChecklistItem[]): ChecklistStructureValidation {
  const byId = new Map(items.map((item) => [item.itemId, item]));

  for (const item of items) {
    if (item.parentId && !byId.has(item.parentId)) {
      return { ok: false, code: "MISSING_PARENT" };
    }
  }

  for (const item of items) {
    let current = item.parentId;
    const visited = new Set<string>([item.itemId]);
    while (current) {
      if (visited.has(current)) {
        return { ok: false, code: "CYCLE" };
      }
      visited.add(current);
      const parent = byId.get(current);
      if (!parent) {
        return { ok: false, code: "MISSING_PARENT" };
      }
      current = parent.parentId;
    }
  }

  return { ok: true };
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
  const nodes = new Map<string, ChecklistTreeNode>();
  for (const item of items) {
    nodes.set(item.itemId, {
      id: item.itemId,
      title: item.title,
      isGroup: item.isRootGroup,
      isComplete: item.isRootGroup ? null : item.isComplete,
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
      return [];
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
