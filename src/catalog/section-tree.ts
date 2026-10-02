export type CatalogSectionRow = {
  code: string;
  name: string;
  parent_code: string | null;
};

export type CatalogSectionTreeNode = {
  code: string;
  name: string;
  parentCode: string | null;
  children: CatalogSectionTreeNode[];
};

export function buildSectionTree(rows: CatalogSectionRow[]): CatalogSectionTreeNode[] {
  const byCode = new Map<string, CatalogSectionTreeNode>();
  for (const row of rows) {
    byCode.set(row.code, {
      code: row.code,
      name: row.name,
      parentCode: row.parent_code,
      children: [],
    });
  }

  function wouldCreateCycle(childCode: string, parentCode: string): boolean {
    const visiting = new Set<string>();
    let current: string | null = parentCode;
    while (current) {
      if (current === childCode) return true;
      if (visiting.has(current)) return true;
      visiting.add(current);
      current = byCode.get(current)?.parentCode?.trim() || null;
      if (current && !byCode.has(current)) current = null;
    }
    return false;
  }

  const roots: CatalogSectionTreeNode[] = [];
  for (const node of byCode.values()) {
    const parentCode = node.parentCode?.trim() || null;
    if (
      !parentCode ||
      !byCode.has(parentCode) ||
      parentCode === node.code ||
      wouldCreateCycle(node.code, parentCode)
    ) {
      roots.push(node);
      continue;
    }
    byCode.get(parentCode)!.children.push(node);
  }

  const sortNodes = (nodes: CatalogSectionTreeNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, "ru") || a.code.localeCompare(b.code));
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

export function expandSectionCodes(
  rows: CatalogSectionRow[],
  rootCode: string | null,
): string[] | null {
  if (!rootCode) return null;
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    const parent = row.parent_code?.trim() || "";
    const list = childrenByParent.get(parent) ?? [];
    list.push(row.code);
    childrenByParent.set(parent, list);
  }

  const result = new Set<string>();
  const visiting = new Set<string>();

  function walk(code: string): void {
    if (visiting.has(code)) return;
    if (result.has(code)) return;
    visiting.add(code);
    result.add(code);
    for (const child of childrenByParent.get(code) ?? []) {
      walk(child);
    }
    visiting.delete(code);
  }

  if (!rows.some((row) => row.code === rootCode)) {
    return [rootCode];
  }
  walk(rootCode);
  return [...result];
}
