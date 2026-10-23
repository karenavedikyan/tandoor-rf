import { addSaleMoneyStrings, addSaleQuantityStrings } from "../decimal-sum";
import type { BundlePartition } from "../matched-only/partition";
import type { OperatorDataScopeV1 } from "./operator-data-scope";

type MoneyLine = {
  quantity: string | number;
  income: string | number;
  manualDiscount?: string | number;
  automaticDiscount?: string | number;
  totalDiscount?: string | number;
  costPrice?: string | number;
  additionalExpenses?: string | number;
  grossProfit?: string | number;
};

function sumMoney(values: (string | number | undefined)[]): string {
  return addSaleMoneyStrings(values.filter((v) => v !== undefined).map((v) => String(v)));
}

function sumQty(values: (string | number)[]): string {
  return addSaleQuantityStrings(values.map((v) => String(v)));
}

function rollupSaleAggregate(lines: MoneyLine[]) {
  return {
    quantity: sumQty(lines.map((l) => l.quantity)),
    income: sumMoney(lines.map((l) => l.income)),
    manualDiscount: sumMoney(lines.map((l) => l.manualDiscount ?? "0")),
    automaticDiscount: sumMoney(lines.map((l) => l.automaticDiscount ?? "0")),
    totalDiscount: sumMoney(lines.map((l) => l.totalDiscount ?? "0")),
    costPrice: sumMoney(lines.map((l) => l.costPrice ?? "0")),
    additionalExpenses: sumMoney(lines.map((l) => l.additionalExpenses ?? "0")),
    grossProfit: sumMoney(lines.map((l) => l.grossProfit ?? "0")),
  };
}

function rollupSaleItems(lines: MoneyLine[]) {
  return rollupSaleAggregate(lines);
}

function rollupReturns(lines: MoneyLine[]) {
  return {
    quantity: sumQty(lines.map((l) => l.quantity)),
    income: sumMoney(lines.map((l) => l.income)),
  };
}

function compareBucket(actual: Record<string, string>, expected: Record<string, string>): boolean {
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      return false;
    }
  }
  return true;
}

export function buildOperatorFinancialTotalsFromPartition(partition: BundlePartition) {
  const all = <T>(p: { matched: T[]; excluded: T[] }) => [...p.matched, ...p.excluded];
  return {
    saleAggregate: {
      full: rollupSaleAggregate(all(partition.saleAggregate)),
      matched: rollupSaleAggregate(partition.saleAggregate.matched),
      excluded: rollupSaleAggregate(partition.saleAggregate.excluded),
    },
    saleItems: {
      full: rollupSaleItems(all(partition.saleItems)),
      matched: rollupSaleItems(partition.saleItems.matched),
      excluded: rollupSaleItems(partition.saleItems.excluded),
    },
    returnsAggregate: {
      full: rollupReturns(all(partition.returnsAggregate)),
      matched: rollupReturns(partition.returnsAggregate.matched),
      excluded: rollupReturns(partition.returnsAggregate.excluded),
    },
    returnItems: {
      full: rollupReturns(all(partition.returnItems)),
      matched: rollupReturns(partition.returnItems.matched),
      excluded: rollupReturns(partition.returnItems.excluded),
    },
  };
}

export function assertFinancialTotalsMatchScope(
  scope: OperatorDataScopeV1,
  computed: ReturnType<typeof buildOperatorFinancialTotalsFromPartition>,
): { ok: true } | { ok: false; code: string; message: string } {
  for (const dataset of [
    "saleAggregate",
    "saleItems",
    "returnsAggregate",
    "returnItems",
  ] as const) {
    const expected = scope.financialTotals[dataset];
    const actual = computed[dataset];
    if (!expected) {
      return { ok: false, code: "SCOPE_FINANCIAL_MISSING", message: `Missing financialTotals.${dataset}` };
    }
    for (const bucket of ["full", "matched", "excluded"] as const) {
      if (!compareBucket(actual[bucket] as Record<string, string>, expected[bucket] as Record<string, string>)) {
        return {
          ok: false,
          code: "FINANCIAL_TOTALS_MISMATCH",
          message: `Financial totals mismatch: ${dataset}.${bucket}`,
        };
      }
    }
  }
  return { ok: true };
}
