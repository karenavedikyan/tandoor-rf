import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "./types";

export type DuplicateKeyStats = {
  rawRowCount: number;
  distinctGroupCount: number;
  extraRows: number;
};

export type ParityGroupKey = string;

function aggregateKey(legalGuid: string, month: string, productType: string): string {
  return `${legalGuid.toLowerCase()}|${month}|${productType}`;
}

function itemAggregateKey(legalGuid: string, month: string, productType: string): string {
  return aggregateKey(legalGuid, month, productType);
}

function decimalsClose(a: string, b: string, tolerance: number): boolean {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function sumItemMetrics(lines: LegalSaleItemsRoster["lines"]): Map<string, LegalSalesRoster["lines"][0]> {
  const map = new Map<string, LegalSalesRoster["lines"][0]>();
  for (const line of lines) {
    const key = itemAggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        sourceRowIndex: line.sourceRowIndex,
        legalGuid: line.legalGuid,
        saleMonthYyyyMm: line.saleMonthYyyyMm,
        saleMonthStartIso: line.saleMonthStartIso,
        productType: line.productType,
        quantity: line.quantity,
        income: line.income,
        manualDiscount: line.manualDiscount,
        automaticDiscount: line.automaticDiscount,
        totalDiscount: line.totalDiscount,
        costPrice: line.costPrice,
        additionalExpenses: line.additionalExpenses,
        grossProfit: line.grossProfit,
        profitability: line.profitability,
      });
      continue;
    }
    map.set(key, {
      ...existing,
      quantity: String(Number(existing.quantity) + Number(line.quantity)),
      income: String(Number(existing.income) + Number(line.income)),
      manualDiscount: String(Number(existing.manualDiscount) + Number(line.manualDiscount)),
      automaticDiscount: String(Number(existing.automaticDiscount) + Number(line.automaticDiscount)),
      totalDiscount: String(Number(existing.totalDiscount) + Number(line.totalDiscount)),
      costPrice: String(Number(existing.costPrice) + Number(line.costPrice)),
      additionalExpenses: String(Number(existing.additionalExpenses) + Number(line.additionalExpenses)),
      grossProfit: String(Number(existing.grossProfit) + Number(line.grossProfit)),
      profitability: existing.profitability,
    });
  }
  return map;
}

export function duplicateKeyStats(
  lines: { legalGuid: string; saleMonthYyyyMm: string; productType: string }[],
  itemKey?: (line: { legalGuid: string; saleMonthYyyyMm: string; productType: string; guidItem?: string }) => string,
): DuplicateKeyStats {
  const groups = new Map<string, number>();
  for (const line of lines) {
    const key = itemKey
      ? itemKey(line as { legalGuid: string; saleMonthYyyyMm: string; productType: string; guidItem?: string })
      : aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  let distinct = 0;
  let extra = 0;
  for (const count of groups.values()) {
    distinct += 1;
    if (count > 1) {
      extra += count - 1;
    }
  }
  return { rawRowCount: lines.length, distinctGroupCount: distinct, extraRows: extra };
}

export type SalesBundleAnalyzeReport = {
  salesAggregate: { sha256: string; rows: number; duplicateKeys: DuplicateKeyStats };
  salesItems: { sha256: string; rows: number; duplicateKeys: DuplicateKeyStats };
  returnsAggregate: { sha256: string; rows: number; duplicateKeys: DuplicateKeyStats };
  returnsItems: { sha256: string; rows: number; duplicateKeys: DuplicateKeyStats };
  distinctClientGuids: {
    salesAggregate: number;
    salesItems: number;
    returnsAggregate: number;
    returnsItems: number;
  };
  unmatchedCatalogGuids: string[];
  parity: {
    groupCountAggregate: number;
    groupCountItemsRolledUp: number;
    onlyAggregate: number;
    onlyItems: number;
    metricMismatches: number;
  };
  returnsParity: {
    groupCountAggregate: number;
    groupCountItemsRolledUp: number;
    quantityIncomeMismatches: number;
  };
};

export function analyzeSalesBundle(input: {
  salesAggregate: LegalSalesRoster;
  salesItems: LegalSaleItemsRoster;
  returnsAggregate: LegalReturnsRoster;
  returnsItems: LegalReturnItemsRoster;
  knownCatalogLegalGuids: Set<string>;
}): SalesBundleAnalyzeReport {
  const salesAggDup = duplicateKeyStats(input.salesAggregate.lines);
  const salesItemsDup = duplicateKeyStats(input.salesItems.lines, (line) =>
    `${aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType)}|${(line as { guidItem?: string }).guidItem?.toLowerCase() ?? ""}`,
  );
  const returnsAggDup = duplicateKeyStats(input.returnsAggregate.lines);
  const returnsItemsDup = duplicateKeyStats(input.returnsItems.lines, (line) =>
    `${aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType)}|${(line as { guidItem?: string }).guidItem?.toLowerCase() ?? ""}`,
  );

  const allGuids = new Set<string>();
  for (const roster of [
    input.salesAggregate.lines,
    input.salesItems.lines,
    input.returnsAggregate.lines,
    input.returnsItems.lines,
  ]) {
    for (const line of roster) {
      allGuids.add(line.legalGuid.toLowerCase());
    }
  }
  const unmatched = [...allGuids].filter((g) => !input.knownCatalogLegalGuids.has(g)).sort();

  const aggMap = new Map(
    input.salesAggregate.lines.map((line) => [
      aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType),
      line,
    ]),
  );
  const itemsRolled = sumItemMetrics(input.salesItems.lines);
  let onlyAggregate = 0;
  let onlyItems = 0;
  let metricMismatches = 0;
  for (const key of new Set([...aggMap.keys(), ...itemsRolled.keys()])) {
    const a = aggMap.get(key);
    const b = itemsRolled.get(key);
    if (a && !b) {
      onlyAggregate += 1;
      continue;
    }
    if (b && !a) {
      onlyItems += 1;
      continue;
    }
    if (!a || !b) {
      continue;
    }
    const fields = [
      "quantity",
      "income",
      "manualDiscount",
      "automaticDiscount",
      "totalDiscount",
      "costPrice",
      "additionalExpenses",
      "grossProfit",
    ] as const;
    for (const field of fields) {
      const tol = field === "quantity" ? 1e-6 : 0.01;
      if (!decimalsClose(a[field], b[field], tol)) {
        metricMismatches += 1;
        break;
      }
    }
  }

  type ParsedReturnRollup = { quantity: string; income: string };
  const retAggGroups = new Map<string, ParsedReturnRollup>();
  for (const line of input.returnsAggregate.lines) {
    const key = aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    const existing = retAggGroups.get(key);
    if (!existing) {
      retAggGroups.set(key, { quantity: line.quantity, income: line.income });
    } else {
      retAggGroups.set(key, {
        quantity: String(Number(existing.quantity) + Number(line.quantity)),
        income: String(Number(existing.income) + Number(line.income)),
      });
    }
  }
  const retItemGroups = new Map<string, ParsedReturnRollup>();
  for (const line of input.returnsItems.lines) {
    const key = aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    const existing = retItemGroups.get(key);
    if (!existing) {
      retItemGroups.set(key, { quantity: line.quantity, income: line.income });
    } else {
      retItemGroups.set(key, {
        quantity: String(Number(existing.quantity) + Number(line.quantity)),
        income: String(Number(existing.income) + Number(line.income)),
      });
    }
  }
  let returnsMismatches = 0;
  for (const key of new Set([...retAggGroups.keys(), ...retItemGroups.keys()])) {
    const a = retAggGroups.get(key);
    const b = retItemGroups.get(key);
    if (!a || !b) {
      continue;
    }
    if (!decimalsClose(a.quantity, b.quantity, 1e-6) || !decimalsClose(a.income, b.income, 0.01)) {
      returnsMismatches += 1;
    }
  }

  return {
    salesAggregate: {
      sha256: input.salesAggregate.sourceSha256,
      rows: input.salesAggregate.lineCount,
      duplicateKeys: salesAggDup,
    },
    salesItems: {
      sha256: input.salesItems.sourceSha256,
      rows: input.salesItems.lineCount,
      duplicateKeys: salesItemsDup,
    },
    returnsAggregate: {
      sha256: input.returnsAggregate.sourceSha256,
      rows: input.returnsAggregate.lineCount,
      duplicateKeys: returnsAggDup,
    },
    returnsItems: {
      sha256: input.returnsItems.sourceSha256,
      rows: input.returnsItems.lineCount,
      duplicateKeys: returnsItemsDup,
    },
    distinctClientGuids: {
      salesAggregate: new Set(input.salesAggregate.lines.map((l) => l.legalGuid.toLowerCase())).size,
      salesItems: new Set(input.salesItems.lines.map((l) => l.legalGuid.toLowerCase())).size,
      returnsAggregate: new Set(input.returnsAggregate.lines.map((l) => l.legalGuid.toLowerCase())).size,
      returnsItems: new Set(input.returnsItems.lines.map((l) => l.legalGuid.toLowerCase())).size,
    },
    unmatchedCatalogGuids: unmatched,
    parity: {
      groupCountAggregate: aggMap.size,
      groupCountItemsRolledUp: itemsRolled.size,
      onlyAggregate,
      onlyItems,
      metricMismatches,
    },
    returnsParity: {
      groupCountAggregate: retAggGroups.size,
      groupCountItemsRolledUp: retItemGroups.size,
      quantityIncomeMismatches: returnsMismatches,
    },
  };
}
