import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "../types";
import type { DatasetRowCounts, MatchedOnlyDataset } from "./types";
import { isKnownGuid } from "./catalog";

export type PartitionedRoster<T> = {
  matched: T[];
  excluded: T[];
  counts: DatasetRowCounts;
};

function partitionLines<T extends { legalGuid: string }>(
  lines: T[],
  known: Set<string>,
): PartitionedRoster<T> {
  const matched: T[] = [];
  const excluded: T[] = [];
  for (const line of lines) {
    if (isKnownGuid(known, line.legalGuid)) {
      matched.push(line);
    } else {
      excluded.push(line);
    }
  }
  return {
    matched,
    excluded,
    counts: {
      full: lines.length,
      matched: matched.length,
      excluded: excluded.length,
    },
  };
}

export type BundlePartition = {
  saleAggregate: PartitionedRoster<LegalSalesRoster["lines"][0]>;
  saleItems: PartitionedRoster<LegalSaleItemsRoster["lines"][0]>;
  returnsAggregate: PartitionedRoster<LegalReturnsRoster["lines"][0]>;
  returnItems: PartitionedRoster<LegalReturnItemsRoster["lines"][0]>;
  unknownGuids: string[];
};

export function partitionSalesBundle(input: {
  saleAggregate: LegalSalesRoster;
  saleItems: LegalSaleItemsRoster;
  returnsAggregate: LegalReturnsRoster;
  returnItems: LegalReturnItemsRoster;
  known: Set<string>;
}): BundlePartition {
  const saleAggregate = partitionLines(input.saleAggregate.lines, input.known);
  const saleItems = partitionLines(input.saleItems.lines, input.known);
  const returnsAggregate = partitionLines(input.returnsAggregate.lines, input.known);
  const returnItems = partitionLines(input.returnItems.lines, input.known);
  const unknown = new Set<string>();
  for (const line of [
    ...input.saleAggregate.lines,
    ...input.saleItems.lines,
    ...input.returnsAggregate.lines,
    ...input.returnItems.lines,
  ]) {
    if (!isKnownGuid(input.known, line.legalGuid)) {
      unknown.add(line.legalGuid.toLowerCase());
    }
  }
  return {
    saleAggregate,
    saleItems,
    returnsAggregate,
    returnItems,
    unknownGuids: [...unknown].sort(),
  };
}

export function datasetFromKey(
  key: keyof BundlePartition,
): MatchedOnlyDataset | null {
  switch (key) {
    case "saleAggregate":
      return "sale_aggregate";
    case "saleItems":
      return "sale_items";
    case "returnsAggregate":
      return "return_aggregate";
    case "returnItems":
      return "return_items";
    default:
      return null;
  }
}
