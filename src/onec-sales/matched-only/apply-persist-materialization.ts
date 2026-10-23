import type { PoolClient } from "pg";
import { saleDecimalStringsEqual } from "../decimal";
import { addSaleMoneyStrings, addSaleQuantityStrings, saleQuantityStringsExactEqual } from "../decimal-sum";
import type { MatchedOnlyBundleInput } from "./guards";
import type { BundlePartition } from "./partition";
import type { MatchedOnlyBundlePlanV1 } from "./types";
import type { ExecutionManifestBudgetV2 } from "./production/manifest-types";

function money(values: string[]): string {
  return addSaleMoneyStrings(values);
}

function qty(values: string[]): string {
  return addSaleQuantityStrings(values);
}

export function buildMatchedTotalsFromPartition(partition: BundlePartition): ExecutionManifestBudgetV2["matchedTotals"] {
  return {
    saleAggregate: {
      matchedIncome: money(partition.saleAggregate.matched.map((l) => String(l.income))),
      matchedQuantity: qty(partition.saleAggregate.matched.map((l) => String(l.quantity))),
    },
    saleItems: {
      matchedIncome: money(partition.saleItems.matched.map((l) => String(l.income))),
      matchedQuantity: qty(partition.saleItems.matched.map((l) => String(l.quantity))),
      matchedCostPrice: money(partition.saleItems.matched.map((l) => String(l.costPrice))),
    },
    returnsAggregate: {
      matchedIncome: money(partition.returnsAggregate.matched.map((l) => String(l.income))),
      matchedQuantity: qty(partition.returnsAggregate.matched.map((l) => String(l.quantity))),
    },
    returnItems: {
      matchedIncome: money(partition.returnItems.matched.map((l) => String(l.income))),
      matchedQuantity: qty(partition.returnItems.matched.map((l) => String(l.quantity))),
    },
  };
}

export async function verifyMatchedMaterializedRows(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  partition: BundlePartition,
  rosters: MatchedOnlyBundleInput,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const months = plan.scope.saleMonthsIso;

  for (const line of partition.saleAggregate.matched) {
    const row = await client.query<{
      quantity: string;
      income: string;
      legal_guid: string;
    }>(
      `SELECT quantity::text, income::text, legal_guid::text
       FROM onec_v3_legal_sales_lines
       WHERE legal_guid = $1::uuid AND sale_month = $2::date AND product_type = $3`,
      [line.legalGuid, line.saleMonthStartIso, line.productType],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Sale aggregate row missing." };
    }
    const persisted = row.rows[0]!;
    if (
      persisted.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() ||
      !saleDecimalStringsEqual(persisted.income, String(line.income)) ||
      !saleQuantityStringsExactEqual(persisted.quantity, String(line.quantity))
    ) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Sale aggregate values mismatch." };
    }
  }

  for (const line of partition.saleItems.matched) {
    const row = await client.query<{
      legal_guid: string;
      income: string;
      quantity: string;
      cost_price: string;
    }>(
      `SELECT legal_guid::text, income::text, quantity::text, cost_price::text
       FROM onec_v3_legal_sale_item_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.saleItems.sourceSha256, line.sourceRowIndex],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Sale item row missing." };
    }
    const persisted = row.rows[0]!;
    if (
      persisted.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() ||
      !saleDecimalStringsEqual(persisted.income, String(line.income)) ||
      !saleQuantityStringsExactEqual(persisted.quantity, String(line.quantity)) ||
      !saleDecimalStringsEqual(persisted.cost_price, String(line.costPrice))
    ) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Sale item values mismatch." };
    }
  }

  for (const line of partition.returnsAggregate.matched) {
    const row = await client.query<{ legal_guid: string; income: string; quantity: string }>(
      `SELECT legal_guid::text, income::text, quantity::text
       FROM onec_v3_legal_return_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.returnsAggregate.sourceSha256, line.sourceRowIndex],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Return aggregate row missing." };
    }
    const persisted = row.rows[0]!;
    if (
      persisted.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() ||
      !saleDecimalStringsEqual(persisted.income, String(line.income)) ||
      !saleQuantityStringsExactEqual(persisted.quantity, String(line.quantity))
    ) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Return aggregate values mismatch." };
    }
  }

  for (const line of partition.returnItems.matched) {
    const row = await client.query<{ legal_guid: string; income: string; quantity: string }>(
      `SELECT legal_guid::text, income::text, quantity::text
       FROM onec_v3_legal_return_item_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.returnItems.sourceSha256, line.sourceRowIndex],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Return item row missing." };
    }
    const persisted = row.rows[0]!;
    if (
      persisted.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() ||
      !saleDecimalStringsEqual(persisted.income, String(line.income)) ||
      !saleQuantityStringsExactEqual(persisted.quantity, String(line.quantity))
    ) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Return item values mismatch." };
    }
  }

  return { ok: true };
}

export async function verifyPersistedTotalsMatchBudget(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  budget: ExecutionManifestBudgetV2,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const months = plan.scope.saleMonthsIso;
  const saleAgg = await client.query<{ income: string; quantity: string }>(
    `SELECT COALESCE(SUM(income),0)::text AS income, COALESCE(SUM(quantity),0)::text AS quantity
     FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  const saleItems = await client.query<{ income: string; quantity: string; cost_price: string }>(
    `SELECT COALESCE(SUM(income),0)::text AS income, COALESCE(SUM(quantity),0)::text AS quantity,
            COALESCE(SUM(cost_price),0)::text AS cost_price
     FROM onec_v3_legal_sale_item_lines
     WHERE sale_month = ANY($1::date[]) AND catalog_matched = true`,
    [months],
  );
  const retAgg = await client.query<{ income: string; quantity: string }>(
    `SELECT COALESCE(SUM(income),0)::text AS income, COALESCE(SUM(quantity),0)::text AS quantity
     FROM onec_v3_legal_return_lines
     WHERE sale_month = ANY($1::date[]) AND catalog_matched = true`,
    [months],
  );
  const retItems = await client.query<{ income: string; quantity: string }>(
    `SELECT COALESCE(SUM(income),0)::text AS income, COALESCE(SUM(quantity),0)::text AS quantity
     FROM onec_v3_legal_return_item_lines
     WHERE sale_month = ANY($1::date[]) AND catalog_matched = true`,
    [months],
  );

  const checks: [string, string, string][] = [
    ["saleAggregate.income", saleAgg.rows[0]?.income ?? "0", budget.matchedTotals.saleAggregate.matchedIncome],
    ["saleAggregate.quantity", saleAgg.rows[0]?.quantity ?? "0", budget.matchedTotals.saleAggregate.matchedQuantity],
    ["saleItems.income", saleItems.rows[0]?.income ?? "0", budget.matchedTotals.saleItems.matchedIncome],
    ["saleItems.quantity", saleItems.rows[0]?.quantity ?? "0", budget.matchedTotals.saleItems.matchedQuantity],
    ["saleItems.cost_price", saleItems.rows[0]?.cost_price ?? "0", budget.matchedTotals.saleItems.matchedCostPrice],
    ["returnsAggregate.income", retAgg.rows[0]?.income ?? "0", budget.matchedTotals.returnsAggregate.matchedIncome],
    [
      "returnsAggregate.quantity",
      retAgg.rows[0]?.quantity ?? "0",
      budget.matchedTotals.returnsAggregate.matchedQuantity,
    ],
    ["returnItems.income", retItems.rows[0]?.income ?? "0", budget.matchedTotals.returnItems.matchedIncome],
    ["returnItems.quantity", retItems.rows[0]?.quantity ?? "0", budget.matchedTotals.returnItems.matchedQuantity],
  ];
  for (const [field, actual, expected] of checks) {
    const moneyField = field.includes("quantity");
    const equal = moneyField
      ? saleQuantityStringsExactEqual(actual, expected)
      : saleDecimalStringsEqual(actual, expected);
    if (!equal) {
      return {
        ok: false,
        code: "PERSISTED_BUDGET_TOTAL_MISMATCH",
        message: `Persisted ${field} does not match approved execution budget.`,
      };
    }
  }
  return { ok: true };
}
