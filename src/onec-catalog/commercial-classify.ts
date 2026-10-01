import { parseCatalogDecimal, mapDecimalFailureToQuarantine } from "./decimal";
import { markExpectedCalendarExpiry, parseExpectedCalendar } from "./dates";
import { QUARANTINE_REASON } from "./constants";
import type { ParsedCatalogSet, QuarantineEntry } from "./types";

export type CommercialRowClassification = {
  quarantined: boolean;
  reason: string | null;
  numeric: string | null;
  expectedDateRaw: string | null;
  expectedExpired: boolean;
};

export type CommercialClassification = {
  prices: CommercialRowClassification[];
  stock: CommercialRowClassification[];
  stockExpected: CommercialRowClassification[];
  quarantineEntries: QuarantineEntry[];
  quarantineRowCount: number;
  quarantineReasonCounts: Record<string, number>;
};

function bumpReason(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function classifyPriceRow(
  data: ParsedCatalogSet & {
    priceTypeCodes: Set<string>;
    productCodes: Set<string>;
  },
  row: ParsedCatalogSet["prices"][number],
): CommercialRowClassification {
  if (!data.priceTypeCodes.has(row.priceTypeCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.UNKNOWN_PRICE_TYPE, numeric: null, expectedDateRaw: null, expectedExpired: false };
  }
  if (!data.productCodes.has(row.productCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_PRODUCT, numeric: null, expectedDateRaw: null, expectedExpired: false };
  }
  if (row.priceRaw.trim() === "") {
    return { quarantined: true, reason: QUARANTINE_REASON.INVALID_DECIMAL, numeric: null, expectedDateRaw: null, expectedExpired: false };
  }
  const parsed = parseCatalogDecimal(row.priceRaw);
  if (!parsed.ok) {
    return {
      quarantined: true,
      reason: mapDecimalFailureToQuarantine(parsed.code),
      numeric: null,
      expectedDateRaw: null,
      expectedExpired: false,
    };
  }
  return { quarantined: false, reason: null, numeric: parsed.numeric, expectedDateRaw: null, expectedExpired: false };
}

function classifyStockRow(
  data: ParsedCatalogSet & {
    productCodes: Set<string>;
    storageCodes: Set<string>;
  },
  row: ParsedCatalogSet["stock"][number],
): CommercialRowClassification {
  if (!data.productCodes.has(row.productCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_PRODUCT, numeric: null, expectedDateRaw: null, expectedExpired: false };
  }
  if (!data.storageCodes.has(row.storageCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_STORAGE, numeric: null, expectedDateRaw: null, expectedExpired: false };
  }
  if (row.quantityRaw.trim() === "") {
    return { quarantined: false, reason: null, numeric: null, expectedDateRaw: null, expectedExpired: false };
  }
  const parsed = parseCatalogDecimal(row.quantityRaw);
  if (!parsed.ok) {
    return {
      quarantined: true,
      reason: mapDecimalFailureToQuarantine(parsed.code),
      numeric: null,
      expectedDateRaw: null,
      expectedExpired: false,
    };
  }
  return { quarantined: false, reason: null, numeric: parsed.numeric, expectedDateRaw: null, expectedExpired: false };
}

function classifyStockExpectedRow(
  data: ParsedCatalogSet & {
    productCodes: Set<string>;
    storageCodes: Set<string>;
  },
  row: ParsedCatalogSet["stockExpected"][number],
  reference: Date,
): CommercialRowClassification {
  if (!data.productCodes.has(row.productCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_PRODUCT, numeric: null, expectedDateRaw: row.expectedDateRaw, expectedExpired: false };
  }
  if (!data.storageCodes.has(row.storageCode)) {
    return { quarantined: true, reason: QUARANTINE_REASON.MISSING_STORAGE, numeric: null, expectedDateRaw: row.expectedDateRaw, expectedExpired: false };
  }
  let expectedExpired = false;
  if (row.expectedDateRaw) {
    const parsedDate = parseExpectedCalendar(row.expectedDateRaw);
    if (!parsedDate.ok) {
      return { quarantined: true, reason: QUARANTINE_REASON.INVALID_DATE, numeric: null, expectedDateRaw: row.expectedDateRaw, expectedExpired: false };
    }
    expectedExpired = markExpectedCalendarExpiry(parsedDate, reference).expired;
  }
  if (row.quantityRaw.trim() === "") {
    return { quarantined: false, reason: null, numeric: null, expectedDateRaw: row.expectedDateRaw, expectedExpired };
  }
  const parsed = parseCatalogDecimal(row.quantityRaw);
  if (!parsed.ok) {
    return {
      quarantined: true,
      reason: mapDecimalFailureToQuarantine(parsed.code),
      numeric: null,
      expectedDateRaw: row.expectedDateRaw,
      expectedExpired,
    };
  }
  return { quarantined: false, reason: null, numeric: parsed.numeric, expectedDateRaw: row.expectedDateRaw, expectedExpired };
}

export function buildCatalogCodeSets(
  data: ParsedCatalogSet,
): ParsedCatalogSet & {
  productCodes: Set<string>;
  groupCodes: Set<string>;
  sectionCodes: Set<string>;
  storageCodes: Set<string>;
  priceTypeCodes: Set<string>;
} {
  const indexed = data as ParsedCatalogSet & {
    productCodes: Set<string>;
    groupCodes: Set<string>;
    sectionCodes: Set<string>;
    storageCodes: Set<string>;
    priceTypeCodes: Set<string>;
  };
  indexed.productCodes = new Set(data.products.map((row) => row.code));
  indexed.groupCodes = new Set(data.groups.map((row) => row.code));
  indexed.sectionCodes = new Set(data.sections.map((row) => row.code));
  indexed.storageCodes = new Set(data.storages.map((row) => row.code));
  indexed.priceTypeCodes = new Set(data.priceTypes.map((row) => row.priceTypeCode));
  return indexed;
}

export function classifyCommercialData(
  data: ParsedCatalogSet,
  reference = new Date(),
): CommercialClassification {
  const indexed = buildCatalogCodeSets(data);
  const prices = indexed.prices.map((row) => classifyPriceRow(indexed, row));
  const stock = indexed.stock.map((row) => classifyStockRow(indexed, row));
  const stockExpected = indexed.stockExpected.map((row) =>
    classifyStockExpectedRow(indexed, row, reference),
  );

  const quarantineEntries: QuarantineEntry[] = [];
  const quarantineReasonCounts: Record<string, number> = {};
  let quarantineRowCount = 0;

  const record = (layer: QuarantineEntry["layer"], reason: string, sourceIdentifiers: Record<string, string>) => {
    quarantineRowCount += 1;
    bumpReason(quarantineReasonCounts, reason);
    quarantineEntries.push({ layer, reasonCode: reason, sourceIdentifiers });
  };

  indexed.prices.forEach((row, index) => {
    const classified = prices[index]!;
    if (!classified.quarantined || !classified.reason) return;
    record("prices", classified.reason, {
      priceTypeCode: row.priceTypeCode,
      productCode: row.productCode,
      priceRaw: row.priceRaw,
    });
  });
  indexed.stock.forEach((row, index) => {
    const classified = stock[index]!;
    if (!classified.quarantined || !classified.reason) return;
    record("stock", classified.reason, {
      productCode: row.productCode,
      storageCode: row.storageCode,
      quantityRaw: row.quantityRaw,
    });
  });
  indexed.stockExpected.forEach((row, index) => {
    const classified = stockExpected[index]!;
    if (!classified.quarantined || !classified.reason) return;
    record("stock_expected", classified.reason, {
      productCode: row.productCode,
      storageCode: row.storageCode,
      quantityRaw: row.quantityRaw,
      expectedDateRaw: row.expectedDateRaw ?? "",
      availableRaw: row.availableRaw ?? "",
    });
  });

  return {
    prices,
    stock,
    stockExpected,
    quarantineEntries,
    quarantineRowCount,
    quarantineReasonCounts,
  };
}
