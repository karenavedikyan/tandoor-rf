import type { PoolClient } from "pg";
import { saleDecimalStringsEqual } from "../decimal";
import { addSaleMoneyStrings, addSaleQuantityStrings, saleQuantityStringsExactEqual } from "../decimal-sum";
import type { MatchedOnlyBundleInput } from "./guards";
import type { BundlePartition } from "./partition";
import type { MatchedOnlyBundlePlanV1 } from "./types";
import type {
  DatasetFinancialRollupV2,
  ExecutionManifestBudgetV2,
  SaleItemsFinancialRollupV2,
} from "./production/manifest-types";
import { verifyExpectedImportMetadata } from "./apply-persist-metadata";

function money(values: string[]): string {
  return addSaleMoneyStrings(values);
}

function qty(values: string[]): string {
  return addSaleQuantityStrings(values);
}

function normSha(sha: string): string {
  return sha.trim();
}

function normMonth(value: string): string {
  return value.slice(0, 10);
}

function financialRollup(
  full: { income: string | number; quantity: string | number }[],
  matched: { income: string | number; quantity: string | number }[],
  excluded: { income: string | number; quantity: string | number }[],
): DatasetFinancialRollupV2 {
  const sum = (lines: { income: string | number; quantity: string | number }[]) => ({
    income: money(lines.map((l) => String(l.income))),
    quantity: qty(lines.map((l) => String(l.quantity))),
  });
  return { full: sum(full), matched: sum(matched), excluded: sum(excluded) };
}

function saleItemsFinancialRollup(
  partition: BundlePartition["saleItems"],
): SaleItemsFinancialRollupV2 {
  const sum = (lines: { income: string | number; quantity: string | number; costPrice: string | number }[]) => ({
    income: money(lines.map((l) => String(l.income))),
    quantity: qty(lines.map((l) => String(l.quantity))),
    costPrice: money(lines.map((l) => String(l.costPrice))),
  });
  return {
    full: sum(allPartitionLines(partition)),
    matched: sum(partition.matched),
    excluded: sum(partition.excluded),
  };
}

function allPartitionLines<T>(part: { matched: T[]; excluded: T[] }): T[] {
  return [...part.matched, ...part.excluded];
}

export function buildFinancialTotalsFromPartition(partition: BundlePartition): ExecutionManifestBudgetV2["financialTotals"] {
  return {
    saleAggregate: financialRollup(
      allPartitionLines(partition.saleAggregate),
      partition.saleAggregate.matched,
      partition.saleAggregate.excluded,
    ),
    saleItems: saleItemsFinancialRollup(partition.saleItems),
    returnsAggregate: financialRollup(
      allPartitionLines(partition.returnsAggregate),
      partition.returnsAggregate.matched,
      partition.returnsAggregate.excluded,
    ),
    returnItems: financialRollup(
      allPartitionLines(partition.returnItems),
      partition.returnItems.matched,
      partition.returnItems.excluded,
    ),
  };
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

function multisetMismatch(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) {
    return true;
  }
  const a = [...actual].sort();
  const e = [...expected].sort();
  return a.join("\n") !== e.join("\n");
}

export async function verifyMatchedMaterializedRows(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  partition: BundlePartition,
  rosters: MatchedOnlyBundleInput,
  planHash: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const months = plan.scope.saleMonthsIso;
  const saleAggKeys: string[] = [];
  for (const line of partition.saleAggregate.matched) {
    saleAggKeys.push(`${line.legalGuid.toLowerCase()}|${line.saleMonthStartIso}|${line.productType}`);
    const row = await client.query<Record<string, string>>(
      `SELECT legal_guid::text, sale_month::text, product_type,
              quantity::text, income::text, manual_discount::text, automatic_discount::text,
              total_discount::text, cost_price::text, additional_expenses::text, gross_profit::text,
              profitability::text, trim(source_sha256) AS source_sha256
       FROM onec_v3_legal_sales_lines
       WHERE legal_guid = $1::uuid AND sale_month = $2::date AND product_type = $3`,
      [line.legalGuid, line.saleMonthStartIso, line.productType],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Sale aggregate row missing." };
    }
    const p = row.rows[0]!;
    const checks: [string, string, string][] = [
      ["income", p.income, String(line.income)],
      ["quantity", p.quantity, String(line.quantity)],
      ["manual_discount", p.manual_discount, String(line.manualDiscount)],
      ["automatic_discount", p.automatic_discount, String(line.automaticDiscount)],
      ["total_discount", p.total_discount, String(line.totalDiscount)],
      ["cost_price", p.cost_price, String(line.costPrice)],
      ["additional_expenses", p.additional_expenses, String(line.additionalExpenses)],
      ["gross_profit", p.gross_profit, String(line.grossProfit)],
      ["profitability", p.profitability, String(line.profitability)],
      ["source_sha256", p.source_sha256, rosters.saleAggregate.sourceSha256],
    ];
    for (const [field, actual, expected] of checks) {
      const equal =
        field === "quantity"
          ? saleQuantityStringsExactEqual(actual, expected)
          : field === "source_sha256"
            ? normSha(actual) === normSha(expected)
            : saleDecimalStringsEqual(actual, expected);
      if (!equal) {
        return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: `Sale aggregate ${field} mismatch.` };
      }
    }
  }

  const saleItemKeys: string[] = [];
  for (const line of partition.saleItems.matched) {
    saleItemKeys.push(`${rosters.saleItems.sourceSha256}|${line.sourceRowIndex}`);
    const row = await client.query<Record<string, string>>(
      `SELECT legal_guid::text, sale_month::text, product_type, guid_item::text, name_item,
              quantity::text, income::text, manual_discount::text, automatic_discount::text,
              total_discount::text, cost_price::text, additional_expenses::text, gross_profit::text,
              profitability::text, trim(source_sha256) AS source_sha256, source_row_index::text,
              catalog_matched::text
       FROM onec_v3_legal_sale_item_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.saleItems.sourceSha256, line.sourceRowIndex],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Sale item row missing." };
    }
    const p = row.rows[0]!;
    const checks: [string, string, string][] = [
      ["legal_guid", p.legal_guid, line.legalGuid],
      ["product_type", p.product_type, line.productType],
      ["guid_item", p.guid_item, line.guidItem],
      ["name_item", p.name_item, line.nameItem],
      ["income", p.income, String(line.income)],
      ["quantity", p.quantity, String(line.quantity)],
      ["manual_discount", p.manual_discount, String(line.manualDiscount)],
      ["automatic_discount", p.automatic_discount, String(line.automaticDiscount)],
      ["total_discount", p.total_discount, String(line.totalDiscount)],
      ["cost_price", p.cost_price, String(line.costPrice)],
      ["additional_expenses", p.additional_expenses, String(line.additionalExpenses)],
      ["gross_profit", p.gross_profit, String(line.grossProfit)],
      ["profitability", p.profitability, String(line.profitability)],
      ["source_sha256", p.source_sha256, rosters.saleItems.sourceSha256],
      ["sale_month", normMonth(p.sale_month), line.saleMonthStartIso],
      ["catalog_matched", p.catalog_matched, "true"],
    ];
    for (const [field, actual, expected] of checks) {
      const equal =
        field === "quantity"
          ? saleQuantityStringsExactEqual(actual, expected)
          : field === "source_sha256"
            ? normSha(actual) === normSha(expected)
            : field === "legal_guid" || field === "guid_item"
              ? actual.toLowerCase() === expected.toLowerCase()
              : field === "name_item" || field === "product_type" || field === "catalog_matched" || field === "sale_month"
                ? actual === expected
                : saleDecimalStringsEqual(actual, expected);
      if (!equal) {
        return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: `Sale item ${field} mismatch.` };
      }
    }
  }

  const retAggKeys: string[] = [];
  for (const line of partition.returnsAggregate.matched) {
    retAggKeys.push(`${rosters.returnsAggregate.sourceSha256}|${line.sourceRowIndex}`);
    const row = await client.query<Record<string, string>>(
      `SELECT legal_guid::text, sale_month::text, product_type, quantity::text, income::text,
              trim(source_sha256) AS source_sha256, source_row_index::text
       FROM onec_v3_legal_return_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.returnsAggregate.sourceSha256, line.sourceRowIndex],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Return aggregate row missing." };
    }
    const p = row.rows[0]!;
    if (
      p.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() ||
      p.product_type !== line.productType ||
      normMonth(p.sale_month) !== line.saleMonthStartIso ||
      !saleDecimalStringsEqual(p.income, String(line.income)) ||
      !saleQuantityStringsExactEqual(p.quantity, String(line.quantity))
    ) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Return aggregate values mismatch." };
    }
  }

  const retItemKeys: string[] = [];
  for (const line of partition.returnItems.matched) {
    retItemKeys.push(`${rosters.returnItems.sourceSha256}|${line.sourceRowIndex}`);
    const row = await client.query<Record<string, string>>(
      `SELECT legal_guid::text, sale_month::text, product_type, guid_item::text, name_item,
              quantity::text, income::text, trim(source_sha256) AS source_sha256, source_row_index::text,
              catalog_matched::text
       FROM onec_v3_legal_return_item_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.returnItems.sourceSha256, line.sourceRowIndex],
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Return item row missing." };
    }
    const p = row.rows[0]!;
    if (
      p.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() ||
      p.product_type !== line.productType ||
      p.guid_item.toLowerCase() !== line.guidItem.toLowerCase() ||
      p.name_item !== line.nameItem ||
      normMonth(p.sale_month) !== line.saleMonthStartIso ||
      p.catalog_matched !== "true" ||
      !saleDecimalStringsEqual(p.income, String(line.income)) ||
      !saleQuantityStringsExactEqual(p.quantity, String(line.quantity))
    ) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Return item values mismatch." };
    }
  }

  const saleAggPersisted = await client.query<{ key: string }>(
    `SELECT legal_guid::text || '|' || sale_month::text || '|' || product_type AS key
     FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  if (multisetMismatch(saleAggPersisted.rows.map((r) => r.key), saleAggKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Sale aggregate key multiset mismatch." };
  }
  const saleItemsPersisted = await client.query<{ key: string }>(
    `SELECT trim(source_sha256) || '|' || source_row_index::text AS key
     FROM onec_v3_legal_sale_item_lines
     WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  if (multisetMismatch(saleItemsPersisted.rows.map((r) => r.key), saleItemKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Sale items key multiset mismatch." };
  }
  const retAggPersisted = await client.query<{ key: string }>(
    `SELECT trim(source_sha256) || '|' || source_row_index::text AS key
     FROM onec_v3_legal_return_lines
     WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  if (multisetMismatch(retAggPersisted.rows.map((r) => r.key), retAggKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Return aggregate key multiset mismatch." };
  }
  const retItemsPersisted = await client.query<{ key: string }>(
    `SELECT trim(source_sha256) || '|' || source_row_index::text AS key
     FROM onec_v3_legal_return_item_lines
     WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  if (multisetMismatch(retItemsPersisted.rows.map((r) => r.key), retItemKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Return items key multiset mismatch." };
  }

  const metadata = await verifyExpectedImportMetadata(client, plan, partition, rosters, planHash);
  if (!metadata.ok) {
    return metadata;
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
     WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  const retAgg = await client.query<{ income: string; quantity: string }>(
    `SELECT COALESCE(SUM(income),0)::text AS income, COALESCE(SUM(quantity),0)::text AS quantity
     FROM onec_v3_legal_return_lines
     WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  const retItems = await client.query<{ income: string; quantity: string }>(
    `SELECT COALESCE(SUM(income),0)::text AS income, COALESCE(SUM(quantity),0)::text AS quantity
     FROM onec_v3_legal_return_item_lines
     WHERE sale_month = ANY($1::date[])`,
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
