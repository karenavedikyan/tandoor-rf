import type { PoolClient } from "pg";
import { activateSalesMonthSnapshots } from "../month-activation";
import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "../types";
import type { BundlePartition } from "./partition";
import type { MatchedOnlyBundlePlanV1, MatchedOnlyDataset } from "./types";

function distinctMonthsIso(lines: { saleMonthStartIso: string }[]): string[] {
  return [...new Set(lines.map((l) => l.saleMonthStartIso))].sort();
}

async function deleteQuarantineForPlan(client: PoolClient, planHash: string): Promise<void> {
  await client.query(`DELETE FROM onec_v3_legal_sales_import_quarantine_rows WHERE plan_hash = $1`, [
    planHash,
  ]);
}

async function insertQuarantineRows(
  client: PoolClient,
  planHash: string,
  dataset: MatchedOnlyDataset,
  sourceSha256: string,
  lines: { legalGuid: string; saleMonthStartIso: string; sourceRowIndex: number }[],
): Promise<void> {
  for (const line of lines) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_import_quarantine_rows (
          plan_hash, dataset, source_sha256, source_row_index, legal_guid, sale_month
        )
        VALUES ($1, $2, $3, $4, $5::uuid, $6::date)
      `,
      [planHash, dataset, sourceSha256, line.sourceRowIndex, line.legalGuid, line.saleMonthStartIso],
    );
  }
}

async function upsertMonthStats(
  client: PoolClient,
  planHash: string,
  dataset: MatchedOnlyDataset,
  sourceSha256: string,
  saleMonthIso: string,
  full: number,
  matched: number,
  excluded: number,
): Promise<void> {
  await client.query(
    `
      INSERT INTO onec_v3_legal_sales_import_month_stats (
        dataset, sale_month, source_sha256, full_row_count, matched_row_count, excluded_row_count, last_plan_hash, updated_at
      )
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (dataset, sale_month, source_sha256) DO UPDATE SET
        full_row_count = EXCLUDED.full_row_count,
        matched_row_count = EXCLUDED.matched_row_count,
        excluded_row_count = EXCLUDED.excluded_row_count,
        last_plan_hash = EXCLUDED.last_plan_hash,
        updated_at = NOW()
    `,
    [dataset, saleMonthIso, sourceSha256, full, matched, excluded, planHash],
  );
}

function countByMonth<T extends { saleMonthStartIso: string }>(
  lines: T[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.saleMonthStartIso, (map.get(line.saleMonthStartIso) ?? 0) + 1);
  }
  return map;
}

async function recordMonthStatsForRoster(
  client: PoolClient,
  planHash: string,
  dataset: MatchedOnlyDataset,
  sourceSha256: string,
  fullLines: { saleMonthStartIso: string }[],
  matchedLines: { saleMonthStartIso: string }[],
): Promise<void> {
  const fullByMonth = countByMonth(fullLines);
  const matchedByMonth = countByMonth(matchedLines);
  for (const [month, full] of fullByMonth) {
    const matched = matchedByMonth.get(month) ?? 0;
    await upsertMonthStats(client, planHash, dataset, sourceSha256, month, full, matched, full - matched);
  }
}

export type MatchedOnlyApplySidecarOptions = { sidecar049?: boolean };

export async function applyMatchedOnlySaleAggregate(
  client: PoolClient,
  roster: LegalSalesRoster,
  partition: BundlePartition["saleAggregate"],
  planHash: string,
  options: MatchedOnlyApplySidecarOptions = {},
): Promise<number> {
  const sidecar049 = options.sidecar049 !== false;
  const months = distinctMonthsIso(roster.lines);
  if (months.length > 0) {
    await client.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`, [
      months,
    ]);
  }
  let inserted = 0;
  for (const line of partition.matched) {
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
    inserted += 1;
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
    [roster.sourceSha256, partition.matched.length],
  );
  if (sidecar049) {
    await insertQuarantineRows(
      client,
      planHash,
      "sale_aggregate",
      roster.sourceSha256,
      partition.excluded,
    );
    await recordMonthStatsForRoster(
      client,
      planHash,
      "sale_aggregate",
      roster.sourceSha256,
      roster.lines,
      partition.matched,
    );
  }
  return inserted;
}

export async function applyMatchedOnlySaleItems(
  client: PoolClient,
  roster: LegalSaleItemsRoster,
  partition: BundlePartition["saleItems"],
  planHash: string,
  options: MatchedOnlyApplySidecarOptions = {},
): Promise<number> {
  const sidecar049 = options.sidecar049 !== false;
  const months = distinctMonthsIso(roster.lines);
  await client.query(
    `DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[]) AND source_sha256 <> $2`,
    [months, roster.sourceSha256],
  );
  await client.query(
    `DELETE FROM onec_v3_legal_sale_item_lines WHERE source_sha256 = $1 AND sale_month = ANY($2::date[])`,
    [roster.sourceSha256, months],
  );
  let inserted = 0;
  for (const line of partition.matched) {
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
          TRUE, NOW()
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
      ],
    );
    inserted += 1;
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
    [roster.sourceSha256, partition.matched.length],
  );
  await activateSalesMonthSnapshots(client, "sale_items", roster.sourceSha256, months);
  if (sidecar049) {
    await insertQuarantineRows(client, planHash, "sale_items", roster.sourceSha256, partition.excluded);
    await recordMonthStatsForRoster(
      client,
      planHash,
      "sale_items",
      roster.sourceSha256,
      roster.lines,
      partition.matched,
    );
  }
  return inserted;
}

async function applyMatchedReturnTable(
  client: PoolClient,
  table: "onec_v3_legal_return_lines" | "onec_v3_legal_return_item_lines",
  stateTable: "onec_v3_legal_return_import_state" | "onec_v3_legal_return_item_import_state",
  dataset: "return_aggregate" | "return_items",
  roster: LegalReturnsRoster | LegalReturnItemsRoster,
  partition: BundlePartition["returnsAggregate"] | BundlePartition["returnItems"],
  planHash: string,
  withItems: boolean,
  options: MatchedOnlyApplySidecarOptions = {},
): Promise<number> {
  const sidecar049 = options.sidecar049 !== false;
  const months = distinctMonthsIso(roster.lines);
  await client.query(
    `DELETE FROM ${table} WHERE sale_month = ANY($1::date[]) AND source_sha256 <> $2`,
    [months, roster.sourceSha256],
  );
  await client.query(
    `DELETE FROM ${table} WHERE source_sha256 = $1 AND sale_month = ANY($2::date[])`,
    [roster.sourceSha256, months],
  );
  let inserted = 0;
  for (const line of partition.matched) {
    if (withItems && "guidItem" in line) {
      await client.query(
        `
          INSERT INTO onec_v3_legal_return_item_lines (
            source_sha256, source_row_index, legal_guid, sale_month, product_type,
            guid_item, name_item, quantity, income, catalog_matched, imported_at
          )
          VALUES ($1, $2, $3::uuid, $4::date, $5, $6::uuid, $7, $8::numeric, $9::numeric, TRUE, NOW())
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
        ],
      );
    } else {
      await client.query(
        `
          INSERT INTO onec_v3_legal_return_lines (
            source_sha256, source_row_index, legal_guid, sale_month, product_type,
            quantity, income, catalog_matched, imported_at
          )
          VALUES ($1, $2, $3::uuid, $4::date, $5, $6::numeric, $7::numeric, TRUE, NOW())
        `,
        [
          roster.sourceSha256,
          line.sourceRowIndex,
          line.legalGuid,
          line.saleMonthStartIso,
          line.productType,
          line.quantity,
          line.income,
        ],
      );
    }
    inserted += 1;
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
    [roster.sourceSha256, partition.matched.length],
  );
  await activateSalesMonthSnapshots(client, dataset, roster.sourceSha256, months);
  if (sidecar049) {
    await insertQuarantineRows(client, planHash, dataset, roster.sourceSha256, partition.excluded);
    await recordMonthStatsForRoster(
      client,
      planHash,
      dataset,
      roster.sourceSha256,
      roster.lines,
      partition.matched,
    );
  }
  return inserted;
}

export async function applyMatchedOnlyReturnsAggregate(
  client: PoolClient,
  roster: LegalReturnsRoster,
  partition: BundlePartition["returnsAggregate"],
  planHash: string,
  options: MatchedOnlyApplySidecarOptions = {},
): Promise<number> {
  return applyMatchedReturnTable(
    client,
    "onec_v3_legal_return_lines",
    "onec_v3_legal_return_import_state",
    "return_aggregate",
    roster,
    partition,
    planHash,
    false,
    options,
  );
}

export async function applyMatchedOnlyReturnItems(
  client: PoolClient,
  roster: LegalReturnItemsRoster,
  partition: BundlePartition["returnItems"],
  planHash: string,
  options: MatchedOnlyApplySidecarOptions = {},
): Promise<number> {
  return applyMatchedReturnTable(
    client,
    "onec_v3_legal_return_item_lines",
    "onec_v3_legal_return_item_import_state",
    "return_items",
    roster,
    partition,
    planHash,
    true,
    options,
  );
}

export async function upsertApplyRun(
  client: PoolClient,
  input: {
    planHash: string;
    status: "planned" | "applied" | "rolled_back" | "commit_uncertain";
    plan: MatchedOnlyBundlePlanV1;
    backupSha256: string | null;
    afterStateSha256: string | null;
    receipt: unknown;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO onec_v3_legal_sales_bundle_apply_runs (
        plan_hash, status, target_db_fingerprint, catalog_fingerprint,
        backup_sha256, before_state_sha256, after_state_sha256, receipt_json, applied_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, CASE WHEN $2 = 'applied' THEN NOW() ELSE NULL END)
      ON CONFLICT (plan_hash) DO UPDATE SET
        status = EXCLUDED.status,
        backup_sha256 = EXCLUDED.backup_sha256,
        after_state_sha256 = EXCLUDED.after_state_sha256,
        receipt_json = EXCLUDED.receipt_json,
        applied_at = CASE WHEN EXCLUDED.status = 'applied' THEN COALESCE(onec_v3_legal_sales_bundle_apply_runs.applied_at, NOW()) ELSE onec_v3_legal_sales_bundle_apply_runs.applied_at END
    `,
    [
      input.planHash,
      input.status,
      input.plan.identity.targetDbFingerprint,
      input.plan.catalog.fingerprint,
      input.backupSha256,
      input.plan.beforeStateSha256,
      input.afterStateSha256,
      JSON.stringify(input.receipt),
    ],
  );
}

export async function loadApplyRun(
  client: PoolClient,
  planHash: string,
): Promise<{
  status: string;
  after_state_sha256: string | null;
  before_state_sha256: string;
  backup_sha256: string | null;
  receipt_json: unknown;
} | null> {
  const rows = await client.query<{
    status: string;
    after_state_sha256: string | null;
    before_state_sha256: string;
    backup_sha256: string | null;
    receipt_json: unknown;
  }>(
    `SELECT status, after_state_sha256, before_state_sha256, backup_sha256, receipt_json
     FROM onec_v3_legal_sales_bundle_apply_runs WHERE plan_hash = $1`,
    [planHash],
  );
  return rows.rows[0] ?? null;
}
