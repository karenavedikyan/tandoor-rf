import { computeCatalogContentCounts } from "./catalog-counts";
import { classifyCommercialData } from "./commercial-classify";
import { MAX_CLASSIFICATION_WARNING_SAMPLES, type CatalogImportProfile } from "./constants";
import type { CatalogClassificationWarning, ParsedCatalogSet, ValidationIssue } from "./types";

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

function collectMissingGroupReferenceWarning(
  products: ParsedCatalogSet["products"],
  groupCodes: Set<string>,
): CatalogClassificationWarning | null {
  const affectedProducts: Array<{ code: string; groupCode: string }> = [];
  const missingGroupCodes = new Set<string>();
  for (const product of products) {
    if (!product.groupCode) continue;
    if (groupCodes.has(product.groupCode)) continue;
    affectedProducts.push({ code: product.code, groupCode: product.groupCode });
    missingGroupCodes.add(product.groupCode);
  }
  if (affectedProducts.length === 0) return null;
  return {
    code: "MISSING_GROUP_REFERENCE",
    message: `${affectedProducts.length} product(s) reference ${missingGroupCodes.size} group code(s) absent from groups/data.xml; original group_code is preserved.`,
    affectedProductCount: affectedProducts.length,
    uniqueMissingGroupCodeCount: missingGroupCodes.size,
    sampleProductCodes: affectedProducts
      .slice(0, MAX_CLASSIFICATION_WARNING_SAMPLES)
      .map((row) => row.code),
    sampleGroupCodes: [...missingGroupCodes].slice(0, MAX_CLASSIFICATION_WARNING_SAMPLES),
  };
}

export type ValidateCatalogSetOptions = {
  profile?: CatalogImportProfile;
  now?: Date;
};

export function validateCatalogSet(
  data: ParsedCatalogSet,
  options: ValidateCatalogSetOptions = {},
): { ok: true; data: ParsedCatalogSet } | { ok: false; issues: ValidationIssue[] } {
  const profile = options.profile ?? data.profile ?? "full";
  const now = options.now ?? new Date();
  const issues: ValidationIssue[] = [];
  data.profile = profile;

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

  const missingGroupWarning = collectMissingGroupReferenceWarning(data.products, groupCodes);
  if (profile === "full") {
    for (const product of data.products) {
      if (product.groupCode && !groupCodes.has(product.groupCode)) {
        issues.push({
          code: "MISSING_GROUP",
          message: `Product ${product.code} references unknown group ${product.groupCode}.`,
          file: "catalog/products/data.xml",
        });
      }
    }
  }
  for (const product of data.products) {
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

  data.classificationWarnings = missingGroupWarning ? [missingGroupWarning] : [];
  data.classificationIncomplete = data.classificationWarnings.length > 0;
  const contentCounts = computeCatalogContentCounts(data.products);
  data.counts.propertyCount = contentCounts.propertyCount;
  data.counts.imagePathCount = contentCounts.imagePathCount;

  if (profile === "distribution") {
    data.commercialStatus = "not_requested";
    data.quarantine = [];
    data.counts.quarantine = 0;
    data.counts.quarantineReasonCounts = {};
    return { ok: true, data };
  }

  data.commercialStatus = "classified";
  const commercial = classifyCommercialData(data, now);
  data.quarantine = commercial.quarantineEntries;
  data.counts.quarantine = commercial.quarantineRowCount;
  data.counts.quarantineReasonCounts = commercial.quarantineReasonCounts;

  return { ok: true, data };
}
