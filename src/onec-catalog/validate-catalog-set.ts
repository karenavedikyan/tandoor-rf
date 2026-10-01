import { classifyCommercialData } from "./commercial-classify";
import type { ParsedCatalogSet, ValidationIssue } from "./types";

function detectCycle(
  nodes: Map<string, string | null>,
  label: string,
): ValidationIssue | null {
  for (const start of nodes.keys()) {
    const visited = new Set<string>();
    let current: string | null | undefined = start;
    while (current) {
      if (visited.has(current)) {
        return {
          code: "HIERARCHY_CYCLE",
          message: `Cycle detected in ${label} hierarchy involving code ${current}.`,
        };
      }
      visited.add(current);
      const parent = nodes.get(current);
      if (parent && !nodes.has(parent)) {
        return {
          code: "MISSING_PARENT",
          message: `Unknown parent ${parent} in ${label} hierarchy for code ${current}.`,
        };
      }
      current = parent ?? null;
    }
  }
  return null;
}

export function validateCatalogSet(
  data: ParsedCatalogSet,
  now = new Date(),
): { ok: true; data: ParsedCatalogSet } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  if (data.products.length === 0) {
    issues.push({
      code: "EMPTY_CATALOG",
      message: "Base catalog must contain at least one product.",
      file: "catalog/products/data.xml",
    });
  }

  const productCodes = new Set(data.products.map((row) => row.code));
  const groupCodes = new Set(data.groups.map((row) => row.code));
  const sectionCodes = new Set(data.sections.map((row) => row.code));

  const groupParents = new Map(data.groups.map((row) => [row.code, row.parentCode]));
  const sectionParents = new Map(data.sections.map((row) => [row.code, row.parentCode]));
  for (const cycleIssue of [
    detectCycle(groupParents, "group"),
    detectCycle(sectionParents, "section"),
  ]) {
    if (cycleIssue) issues.push(cycleIssue);
  }

  for (const product of data.products) {
    if (product.groupCode && !groupCodes.has(product.groupCode)) {
      issues.push({
        code: "MISSING_GROUP",
        message: `Product ${product.code} references unknown group ${product.groupCode}.`,
        file: "catalog/products/data.xml",
      });
    }
    for (const sectionCode of product.sectionCodes) {
      if (!sectionCodes.has(sectionCode)) {
        issues.push({
          code: "MISSING_SECTION",
          message: `Product ${product.code} references unknown section ${sectionCode}.`,
          file: "catalog/products/data.xml",
        });
      }
    }
    if (!product.code.trim() || !product.name.trim()) {
      issues.push({
        code: "INVALID_PRODUCT",
        message: "Product requires non-empty code and name.",
        file: "catalog/products/data.xml",
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const commercial = classifyCommercialData(data, now);
  data.quarantine = commercial.quarantineEntries;
  data.counts.quarantine = commercial.quarantineRowCount;
  data.counts.quarantineReasonCounts = commercial.quarantineReasonCounts;

  return { ok: true, data };
}
