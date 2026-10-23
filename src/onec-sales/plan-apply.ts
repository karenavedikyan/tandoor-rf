import type { PoolClient } from "pg";
import { saleDecimalStringsEqual } from "./decimal";
import { activateSalesMonthSnapshots } from "./month-activation";
import type { LegalSalesRoster, ParsedLegalSaleLine } from "./types";

export type LegalSalesImportPlan = {
  sourceSha256: string;
  totalLines: number;
  knownLegalLines: number;
  unknownLegalGuids: string[];
  insertCount: number;
  updateCount: number;
  unchangedCount: number;
  distinctLegalGuids: number;
  distinctMonths: string[];
};

async function loadKnownLegalGuids(client: PoolClient, guids: string[]): Promise<Set<string>> {
  if (guids.length === 0) {
    return new Set();
  }
  const result = await client.query<{ guid_client: string }>(
    `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities WHERE lower(guid_client::text) = ANY($1::text[])`,
    [guids.map((g) => g.toLowerCase())],
  );
  return new Set(result.rows.map((row) => row.guid_client));
}

async function loadExistingLine(
  client: PoolClient,
  line: ParsedLegalSaleLine,
): Promise<ParsedLegalSaleLine | null> {
  const row = await client.query<{
    quantity: string;
    income: string;
    manual_discount: string;
    automatic_discount: string;
    total_discount: string;
    cost_price: string;
    additional_expenses: string;
    gross_profit: string;
    profitability: string;
  }>(
    `
      SELECT
        quantity::text,
        income::text,
        manual_discount::text,
        automatic_discount::text,
        total_discount::text,
        cost_price::text,
        additional_expenses::text,
        gross_profit::text,
        profitability::text
      FROM onec_v3_legal_sales_lines
      WHERE legal_guid = $1::uuid
        AND sale_month = $2::date
        AND product_type = $3
      LIMIT 1
    `,
    [line.legalGuid, line.saleMonthStartIso, line.productType],
  );
  const existing = row.rows[0];
  if (!existing) {
    return null;
  }
  return {
    sourceRowIndex: line.sourceRowIndex,
    legalGuid: line.legalGuid,
    saleMonthYyyyMm: line.saleMonthYyyyMm,
    saleMonthStartIso: line.saleMonthStartIso,
    productType: line.productType,
    quantity: existing.quantity,
    income: existing.income,
    manualDiscount: existing.manual_discount,
    automaticDiscount: existing.automatic_discount,
    totalDiscount: existing.total_discount,
    costPrice: existing.cost_price,
    additionalExpenses: existing.additional_expenses,
    grossProfit: existing.gross_profit,
    profitability: existing.profitability,
  };
}

function linesEqualStored(a: ParsedLegalSaleLine, b: ParsedLegalSaleLine): boolean {
  return (
    saleDecimalStringsEqual(a.quantity, b.quantity) &&
    saleDecimalStringsEqual(a.income, b.income) &&
    saleDecimalStringsEqual(a.manualDiscount, b.manualDiscount) &&
    saleDecimalStringsEqual(a.automaticDiscount, b.automaticDiscount) &&
    saleDecimalStringsEqual(a.totalDiscount, b.totalDiscount) &&
    saleDecimalStringsEqual(a.costPrice, b.costPrice) &&
    saleDecimalStringsEqual(a.additionalExpenses, b.additionalExpenses) &&
    saleDecimalStringsEqual(a.grossProfit, b.grossProfit) &&
    saleDecimalStringsEqual(a.profitability, b.profitability)
  );
}

/**
 * Upsert lines present in the file. Does not delete rows for months absent from the file.
 * Unknown legal GUIDs are skipped (reported in plan) — no fictional clients.
 */
export async function planLegalSalesImport(
  client: PoolClient,
  roster: LegalSalesRoster,
): Promise<LegalSalesImportPlan> {
  const distinctGuids = [...new Set(roster.lines.map((line) => line.legalGuid.toLowerCase()))];
  const known = await loadKnownLegalGuids(client, distinctGuids);
  const unknownLegalGuids = distinctGuids.filter((guid) => !known.has(guid));

  let insertCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let knownLegalLines = 0;

  for (const line of roster.lines) {
    if (!known.has(line.legalGuid.toLowerCase())) {
      continue;
    }
    knownLegalLines += 1;
    const existing = await loadExistingLine(client, line);
    if (!existing) {
      insertCount += 1;
      continue;
    }
    if (linesEqualStored(existing, line)) {
      unchangedCount += 1;
    } else {
      updateCount += 1;
    }
  }

  const months = [...new Set(roster.lines.map((line) => line.saleMonthYyyyMm))].sort();

  return {
    sourceSha256: roster.sourceSha256,
    totalLines: roster.lineCount,
    knownLegalLines,
    unknownLegalGuids: unknownLegalGuids.sort(),
    insertCount,
    updateCount,
    unchangedCount,
    distinctLegalGuids: distinctGuids.length,
    distinctMonths: months,
  };
}

export async function applyLegalSalesImport(
  client: PoolClient,
  roster: LegalSalesRoster,
): Promise<LegalSalesImportPlan> {
  const plan = await planLegalSalesImport(client, roster);
  const known = new Set(
    (
      await client.query<{ guid_client: string }>(
        `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities WHERE lower(guid_client::text) = ANY($1::text[])`,
        [[...new Set(roster.lines.map((l) => l.legalGuid.toLowerCase()))]],
      )
    ).rows.map((row) => row.guid_client),
  );

  const months = [...new Set(roster.lines.map((line) => line.saleMonthStartIso))];
  if (months.length > 0) {
    await client.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`, [
      months,
    ]);
  }

  for (const line of roster.lines) {
    if (!known.has(line.legalGuid.toLowerCase())) {
      continue;
    }
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type,
          quantity, income, manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        )
        VALUES (
          $1::uuid, $2::date, $3,
          $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric,
          $9::numeric, $10::numeric, $11::numeric, $12::numeric,
          $13, NOW()
        )
        ON CONFLICT (legal_guid, sale_month, product_type) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          income = EXCLUDED.income,
          manual_discount = EXCLUDED.manual_discount,
          automatic_discount = EXCLUDED.automatic_discount,
          total_discount = EXCLUDED.total_discount,
          cost_price = EXCLUDED.cost_price,
          additional_expenses = EXCLUDED.additional_expenses,
          gross_profit = EXCLUDED.gross_profit,
          profitability = EXCLUDED.profitability,
          source_sha256 = EXCLUDED.source_sha256,
          imported_at = NOW()
      `,
      [
        line.legalGuid,
        line.saleMonthStartIso,
        line.productType,
        line.quantity,
        line.income,
        line.manualDiscount,
        line.automaticDiscount,
        line.totalDiscount,
        line.costPrice,
        line.additionalExpenses,
        line.grossProfit,
        line.profitability,
        roster.sourceSha256,
      ],
    );
  }

  await activateSalesMonthSnapshots(client, "sale_aggregate", roster.sourceSha256, months);

  await client.query(
    `
      INSERT INTO onec_v3_legal_sales_import_state (id, source_sha256, row_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        row_count = EXCLUDED.row_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, plan.knownLegalLines],
  );

  return plan;
}
