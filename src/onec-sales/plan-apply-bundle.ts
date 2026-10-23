import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "./types";
import { isBundleParityOk, analyzeSalesBundle } from "./bundle-analyze";
import { activateSalesMonthSnapshots } from "./month-activation";
import { applyLegalSalesImport } from "./plan-apply";

export type SalesBundleApplyPlan = {
  planSha256: string;
  sourceHashes: {
    saleAggregate: string;
    saleItems: string;
    returnsAggregate: string;
    returnItems: string;
  };
  months: string[];
  matchedItemRows: number;
  quarantinedItemRows: number;
  matchedReturnRows: number;
  quarantinedReturnRows: number;
};

async function loadKnownLegalGuids(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ guid_client: string }>(
    `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities`,
  );
  return new Set(result.rows.map((row) => row.guid_client));
}

function distinctMonths(
  lines: { saleMonthStartIso: string; saleMonthYyyyMm: string }[],
): { iso: string[]; yyyyMm: string[] } {
  const iso = [...new Set(lines.map((l) => l.saleMonthStartIso))];
  const yyyyMm = [...new Set(lines.map((l) => l.saleMonthYyyyMm))].sort();
  return { iso, yyyyMm };
}

export async function applySaleItemsRoster(
  client: PoolClient,
  roster: LegalSaleItemsRoster,
  known: Set<string>,
): Promise<{ matched: number; quarantined: number }> {
  const months = distinctMonths(roster.lines).iso;
  await client.query(
    `DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[]) AND source_sha256 <> $2`,
    [months, roster.sourceSha256],
  );
  await client.query(`DELETE FROM onec_v3_legal_sale_item_lines WHERE source_sha256 = $1`, [
    roster.sourceSha256,
  ]);
  let matched = 0;
  let quarantined = 0;
  for (const line of roster.lines) {
    const catalogMatched = known.has(line.legalGuid.toLowerCase());
    if (catalogMatched) {
      matched += 1;
    } else {
      quarantined += 1;
    }
    await client.query(
      `
        INSERT INTO onec_v3_legal_sale_item_lines (
          source_sha256, source_row_index, legal_guid, sale_month, product_type,
          guid_item, name_item, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          catalog_matched, imported_at
        )
        VALUES (
          $1, $2, $3::uuid, $4::date, $5,
          $6::uuid, $7, $8::numeric, $9::numeric,
          $10::numeric, $11::numeric, $12::numeric,
          $13::numeric, $14::numeric, $15::numeric, $16::numeric,
          $17, NOW()
        )
      `,
      [
        roster.sourceSha256,
        line.sourceRowIndex,
        line.legalGuid,
        line.saleMonthStartIso,
        line.productType,
        line.guidItem,
        line.nameItem,
        line.quantity,
        line.income,
        line.manualDiscount,
        line.automaticDiscount,
        line.totalDiscount,
        line.costPrice,
        line.additionalExpenses,
        line.grossProfit,
        line.profitability,
        catalogMatched,
      ],
    );
  }
  await client.query(
    `
      INSERT INTO onec_v3_legal_sale_item_import_state (id, source_sha256, row_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        row_count = EXCLUDED.row_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, roster.lineCount],
  );
  await activateSalesMonthSnapshots(client, "sale_items", roster.sourceSha256, months);
  return { matched, quarantined };
}

async function applyReturnLines(
  client: PoolClient,
  table: "onec_v3_legal_return_lines" | "onec_v3_legal_return_item_lines",
  stateTable:
    | "onec_v3_legal_return_import_state"
    | "onec_v3_legal_return_item_import_state",
  roster: LegalReturnsRoster | LegalReturnItemsRoster,
  known: Set<string>,
  withItems: boolean,
): Promise<{ matched: number; quarantined: number }> {
  const months = distinctMonths(roster.lines).iso;
  await client.query(
    `DELETE FROM ${table} WHERE sale_month = ANY($1::date[]) AND source_sha256 <> $2`,
    [months, roster.sourceSha256],
  );
  await client.query(`DELETE FROM ${table} WHERE source_sha256 = $1`, [roster.sourceSha256]);
  let matched = 0;
  let quarantined = 0;
  for (const line of roster.lines) {
    const catalogMatched = known.has(line.legalGuid.toLowerCase());
    if (catalogMatched) {
      matched += 1;
    } else {
      quarantined += 1;
    }
    if (withItems && "guidItem" in line) {
      await client.query(
        `
          INSERT INTO onec_v3_legal_return_item_lines (
            source_sha256, source_row_index, legal_guid, sale_month, product_type,
            guid_item, name_item, quantity, income, catalog_matched, imported_at
          )
          VALUES ($1, $2, $3::uuid, $4::date, $5, $6::uuid, $7, $8::numeric, $9::numeric, $10, NOW())
        `,
        [
          roster.sourceSha256,
          line.sourceRowIndex,
          line.legalGuid,
          line.saleMonthStartIso,
          line.productType,
          line.guidItem,
          line.nameItem,
          line.quantity,
          line.income,
          catalogMatched,
        ],
      );
    } else {
      await client.query(
        `
          INSERT INTO onec_v3_legal_return_lines (
            source_sha256, source_row_index, legal_guid, sale_month, product_type,
            quantity, income, catalog_matched, imported_at
          )
          VALUES ($1, $2, $3::uuid, $4::date, $5, $6::numeric, $7::numeric, $8, NOW())
        `,
        [
          roster.sourceSha256,
          line.sourceRowIndex,
          line.legalGuid,
          line.saleMonthStartIso,
          line.productType,
          line.quantity,
          line.income,
          catalogMatched,
        ],
      );
    }
  }
  await client.query(
    `
      INSERT INTO ${stateTable} (id, source_sha256, row_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        row_count = EXCLUDED.row_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, roster.lineCount],
  );
  const dataset =
    table === "onec_v3_legal_return_item_lines" ? "return_items" : "return_aggregate";
  await activateSalesMonthSnapshots(client, dataset, roster.sourceSha256, months);
  return { matched, quarantined };
}

export async function applyReturnsRoster(
  client: PoolClient,
  roster: LegalReturnsRoster,
  known: Set<string>,
): Promise<{ matched: number; quarantined: number }> {
  return applyReturnLines(client, "onec_v3_legal_return_lines", "onec_v3_legal_return_import_state", roster, known, false);
}

export async function applyReturnItemsRoster(
  client: PoolClient,
  roster: LegalReturnItemsRoster,
  known: Set<string>,
): Promise<{ matched: number; quarantined: number }> {
  return applyReturnLines(
    client,
    "onec_v3_legal_return_item_lines",
    "onec_v3_legal_return_item_import_state",
    roster,
    known,
    true,
  );
}

export async function buildSalesBundleApplyPlan(input: {
  saleAggregate: LegalSalesRoster;
  saleItems: LegalSaleItemsRoster;
  returnsAggregate: LegalReturnsRoster;
  returnItems: LegalReturnItemsRoster;
}): Promise<SalesBundleApplyPlan> {
  const payload = JSON.stringify({
    saleAggregate: input.saleAggregate.sourceSha256,
    saleItems: input.saleItems.sourceSha256,
    returnsAggregate: input.returnsAggregate.sourceSha256,
    returnItems: input.returnItems.sourceSha256,
  });
  const months = [
    ...new Set([
      ...input.saleAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...input.saleItems.lines.map((l) => l.saleMonthYyyyMm),
      ...input.returnsAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...input.returnItems.lines.map((l) => l.saleMonthYyyyMm),
    ]),
  ].sort();
  return {
    planSha256: createHash("sha256").update(payload).digest("hex"),
    sourceHashes: {
      saleAggregate: input.saleAggregate.sourceSha256,
      saleItems: input.saleItems.sourceSha256,
      returnsAggregate: input.returnsAggregate.sourceSha256,
      returnItems: input.returnItems.sourceSha256,
    },
    months,
    matchedItemRows: 0,
    quarantinedItemRows: 0,
    matchedReturnRows: 0,
    quarantinedReturnRows: 0,
  };
}

export async function applySalesBundle(
  client: PoolClient,
  input: {
    saleAggregate: LegalSalesRoster;
    saleItems: LegalSaleItemsRoster;
    returnsAggregate: LegalReturnsRoster;
    returnItems: LegalReturnItemsRoster;
  },
  knownCatalogLegalGuids: Set<string>,
): Promise<SalesBundleApplyPlan> {
  const report = analyzeSalesBundle({
    salesAggregate: input.saleAggregate,
    salesItems: input.saleItems,
    returnsAggregate: input.returnsAggregate,
    returnsItems: input.returnItems,
    knownCatalogLegalGuids,
  });
  if (!isBundleParityOk(report)) {
    throw new Error("BUNDLE_PARITY_FAILED");
  }
  const locked = await tryAcquireImportLock(client);
  if (!locked) {
    throw new Error("IMPORT_LOCK_BUSY");
  }
  try {
    const known = knownCatalogLegalGuids;
    const plan = await buildSalesBundleApplyPlan(input);
    await applyLegalSalesImport(client, input.saleAggregate);
    const items = await applySaleItemsRoster(client, input.saleItems, known);
    const returns = await applyReturnsRoster(client, input.returnsAggregate, known);
    const returnItems = await applyReturnItemsRoster(client, input.returnItems, known);
    plan.matchedItemRows = items.matched;
    plan.quarantinedItemRows = items.quarantined;
    plan.matchedReturnRows = returns.matched + returnItems.matched;
    plan.quarantinedReturnRows = returns.quarantined + returnItems.quarantined;
    return plan;
  } finally {
    await releaseImportLock(client);
  }
}
