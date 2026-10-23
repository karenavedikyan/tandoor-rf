import type { PoolClient } from "pg";
import type { MatchedOnlyBundleInput } from "./guards";
import type { BundlePartition } from "./partition";
import type { MatchedOnlyBundlePlanV1 } from "./types";

function sumMatchedIncome(lines: { income: number | string }[]): number {
  return lines.reduce((acc, line) => acc + Number(line.income), 0);
}

export async function verifyMatchedOnlyPersistedOutcome(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  partition: BundlePartition,
  rosters: MatchedOnlyBundleInput,
  inserted: {
    saleAggregate: number;
    saleItems: number;
    returnsAggregate: number;
    returnItems: number;
  },
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const months = plan.scope.saleMonthsIso;
  const saleAgg = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sales_lines
     WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  const saleItems = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines
     WHERE sale_month = ANY($1::date[]) AND catalog_matched = true`,
    [months],
  );
  const retAgg = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_return_lines
     WHERE sale_month = ANY($1::date[]) AND catalog_matched = true`,
    [months],
  );
  const retItems = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM onec_v3_legal_return_item_lines
     WHERE sale_month = ANY($1::date[]) AND catalog_matched = true`,
    [months],
  );

  const actual = {
    saleAggregate: Number(saleAgg.rows[0]?.n ?? "0"),
    saleItems: Number(saleItems.rows[0]?.n ?? "0"),
    returnsAggregate: Number(retAgg.rows[0]?.n ?? "0"),
    returnItems: Number(retItems.rows[0]?.n ?? "0"),
  };

  const expected = {
    saleAggregate: partition.saleAggregate.counts.matched,
    saleItems: partition.saleItems.counts.matched,
    returnsAggregate: partition.returnsAggregate.counts.matched,
    returnItems: partition.returnItems.counts.matched,
  };

  if (
    actual.saleAggregate !== expected.saleAggregate ||
    actual.saleItems !== expected.saleItems ||
    actual.returnsAggregate !== expected.returnsAggregate ||
    actual.returnItems !== expected.returnItems
  ) {
    return {
      ok: false,
      code: "PERSISTED_ROW_COUNT_MISMATCH",
      message: "Persisted matched row counts do not match approved operation.",
    };
  }

  if (
    inserted.saleAggregate !== expected.saleAggregate ||
    inserted.saleItems !== expected.saleItems ||
    inserted.returnsAggregate !== expected.returnsAggregate ||
    inserted.returnItems !== expected.returnItems
  ) {
    return {
      ok: false,
      code: "DML_RETURNING_COUNT_MISMATCH",
      message: "Insert returning counts do not match expected persisted keys.",
    };
  }

  const incomeRow = await client.query<{ income: string }>(
    `SELECT COALESCE(SUM(income), 0)::text AS income
     FROM onec_v3_legal_return_item_lines
     WHERE sale_month = ANY($1::date[]) AND catalog_matched = true`,
    [months],
  );
  const persistedIncome = Number(incomeRow.rows[0]?.income ?? "0");
  const expectedIncome = sumMatchedIncome(partition.returnItems.matched);
  if (persistedIncome !== expectedIncome) {
    return {
      ok: false,
      code: "PERSISTED_MONETARY_TOTAL_MISMATCH",
      message: "Persisted return-item income does not match source-derived totals.",
    };
  }

  return { ok: true };
}
