import { parseCatalogDecimal } from "./decimal";
import { parseExpectedDate } from "./dates";
import { QUARANTINE_REASON } from "./constants";
import type {
  ParsedCatalogSet,
  QuarantineEntry,
  ValidationIssue,
} from "./types";

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
  const productCodes = new Set(data.products.map((row) => row.code));
  const groupCodes = new Set(data.groups.map((row) => row.code));
  const sectionCodes = new Set(data.sections.map((row) => row.code));
  const storageCodes = new Set(data.storages.map((row) => row.code));
  const priceTypeCodes = new Set(data.priceTypes.map((row) => row.priceTypeCode));

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

  const quarantine: QuarantineEntry[] = [];

  for (const price of data.prices) {
    if (!priceTypeCodes.has(price.priceTypeCode)) {
      quarantine.push({
        layer: "prices",
        reasonCode: QUARANTINE_REASON.UNKNOWN_PRICE_TYPE,
        sourceIdentifiers: {
          priceTypeCode: price.priceTypeCode,
          productCode: price.productCode,
          priceRaw: price.priceRaw,
        },
      });
      continue;
    }
    if (!productCodes.has(price.productCode)) {
      quarantine.push({
        layer: "prices",
        reasonCode: QUARANTINE_REASON.MISSING_PRODUCT,
        sourceIdentifiers: {
          priceTypeCode: price.priceTypeCode,
          productCode: price.productCode,
          priceRaw: price.priceRaw,
        },
      });
      continue;
    }
    const parsed = parseCatalogDecimal(price.priceRaw);
    if (!parsed.ok) {
      quarantine.push({
        layer: "prices",
        reasonCode: QUARANTINE_REASON.INVALID_DECIMAL,
        sourceIdentifiers: {
          priceTypeCode: price.priceTypeCode,
          productCode: price.productCode,
          priceRaw: price.priceRaw,
        },
      });
    }
  }

  for (const line of data.stock) {
    if (!productCodes.has(line.productCode)) {
      quarantine.push({
        layer: "stock",
        reasonCode: QUARANTINE_REASON.MISSING_PRODUCT,
        sourceIdentifiers: {
          productCode: line.productCode,
          storageCode: line.storageCode,
          quantityRaw: line.quantityRaw,
        },
      });
      continue;
    }
    if (!storageCodes.has(line.storageCode)) {
      quarantine.push({
        layer: "stock",
        reasonCode: QUARANTINE_REASON.MISSING_STORAGE,
        sourceIdentifiers: {
          productCode: line.productCode,
          storageCode: line.storageCode,
          quantityRaw: line.quantityRaw,
        },
      });
      continue;
    }
    const parsed = parseCatalogDecimal(line.quantityRaw);
    if (!parsed.ok && line.quantityRaw.trim() !== "") {
      quarantine.push({
        layer: "stock",
        reasonCode: QUARANTINE_REASON.INVALID_DECIMAL,
        sourceIdentifiers: {
          productCode: line.productCode,
          storageCode: line.storageCode,
          quantityRaw: line.quantityRaw,
        },
      });
    }
  }

  for (const line of data.stockExpected) {
    if (!productCodes.has(line.productCode)) {
      quarantine.push({
        layer: "stock_expected",
        reasonCode: QUARANTINE_REASON.MISSING_PRODUCT,
        sourceIdentifiers: {
          productCode: line.productCode,
          storageCode: line.storageCode,
          quantityRaw: line.quantityRaw,
          expectedDateRaw: line.expectedDateRaw ?? "",
        },
      });
      continue;
    }
    if (!storageCodes.has(line.storageCode)) {
      quarantine.push({
        layer: "stock_expected",
        reasonCode: QUARANTINE_REASON.MISSING_STORAGE,
        sourceIdentifiers: {
          productCode: line.productCode,
          storageCode: line.storageCode,
          quantityRaw: line.quantityRaw,
        },
      });
      continue;
    }
    if (line.expectedDateRaw) {
      const parsedDate = parseExpectedDate(line.expectedDateRaw, now);
      if (!parsedDate.ok) {
        quarantine.push({
          layer: "stock_expected",
          reasonCode: QUARANTINE_REASON.INVALID_DATE,
          sourceIdentifiers: {
            productCode: line.productCode,
            storageCode: line.storageCode,
            expectedDateRaw: line.expectedDateRaw,
          },
        });
      }
    }
    const parsedQty = parseCatalogDecimal(line.quantityRaw);
    if (!parsedQty.ok && line.quantityRaw.trim() !== "") {
      quarantine.push({
        layer: "stock_expected",
        reasonCode: QUARANTINE_REASON.INVALID_DECIMAL,
        sourceIdentifiers: {
          productCode: line.productCode,
          storageCode: line.storageCode,
          quantityRaw: line.quantityRaw,
        },
      });
    }
  }

  data.quarantine = quarantine;
  data.counts.quarantine = quarantine.length;

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, data };
}
