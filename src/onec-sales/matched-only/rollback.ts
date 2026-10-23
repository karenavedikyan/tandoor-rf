import type { PoolClient } from "pg";
import type { MatchedOnlyScopedBackupV1 } from "./types";
import { captureScopedAfterStateDigest } from "./state-digest";

export async function restoreScopedBackup(
  client: PoolClient,
  backup: MatchedOnlyScopedBackupV1,
): Promise<void> {
  const months = backup.saleMonthsIso;
  await client.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`, [
    months,
  ]);
  await client.query(
    `DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  await client.query(`DELETE FROM onec_v3_legal_return_lines WHERE sale_month = ANY($1::date[])`, [
    months,
  ]);
  await client.query(
    `DELETE FROM onec_v3_legal_return_item_lines WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  await client.query(
    `DELETE FROM onec_v3_legal_sales_month_activation WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  await client.query(
    `DELETE FROM onec_v3_legal_sales_import_month_stats WHERE sale_month = ANY($1::date[])`,
    [months],
  );
  await client.query(
    `DELETE FROM onec_v3_legal_sales_import_quarantine_rows WHERE sale_month = ANY($1::date[])`,
    [months],
  );

  for (const row of backup.tables.saleAggregateLines as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        )
        VALUES (
          $1::uuid, $2::date, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric,
          $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13, $14::timestamptz
        )
      `,
      [
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.quantity,
        row.income,
        row.manual_discount,
        row.automatic_discount,
        row.total_discount,
        row.cost_price,
        row.additional_expenses,
        row.gross_profit,
        row.profitability,
        row.source_sha256,
        row.imported_at,
      ],
    );
  }

  for (const row of backup.tables.saleItemLines as Record<string, unknown>[]) {
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
          $1, $2, $3::uuid, $4::date, $5, $6::uuid, $7, $8::numeric, $9::numeric,
          $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
          $17, $18::timestamptz
        )
      `,
      [
        row.source_sha256,
        row.source_row_index,
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.guid_item,
        row.name_item,
        row.quantity,
        row.income,
        row.manual_discount,
        row.automatic_discount,
        row.total_discount,
        row.cost_price,
        row.additional_expenses,
        row.gross_profit,
        row.profitability,
        row.catalog_matched,
        row.imported_at,
      ],
    );
  }

  for (const row of backup.tables.returnLines as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_return_lines (
          source_sha256, source_row_index, legal_guid, sale_month, product_type,
          quantity, income, catalog_matched, imported_at
        )
        VALUES ($1, $2, $3::uuid, $4::date, $5, $6::numeric, $7::numeric, $8, $9::timestamptz)
      `,
      [
        row.source_sha256,
        row.source_row_index,
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.quantity,
        row.income,
        row.catalog_matched,
        row.imported_at,
      ],
    );
  }

  for (const row of backup.tables.returnItemLines as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_return_item_lines (
          source_sha256, source_row_index, legal_guid, sale_month, product_type,
          guid_item, name_item, quantity, income, catalog_matched, imported_at
        )
        VALUES ($1, $2, $3::uuid, $4::date, $5, $6::uuid, $7, $8::numeric, $9::numeric, $10, $11::timestamptz)
      `,
      [
        row.source_sha256,
        row.source_row_index,
        row.legal_guid,
        row.sale_month,
        row.product_type,
        row.guid_item,
        row.name_item,
        row.quantity,
        row.income,
        row.catalog_matched,
        row.imported_at,
      ],
    );
  }

  for (const row of backup.tables.importStates as {
    dataset: string;
    source_sha256: string;
    row_count: string;
    imported_at: string;
  }[]) {
    const table =
      row.dataset === "sale_aggregate"
        ? "onec_v3_legal_sales_import_state"
        : row.dataset === "sale_items"
          ? "onec_v3_legal_sale_item_import_state"
          : row.dataset === "return_aggregate"
            ? "onec_v3_legal_return_import_state"
            : "onec_v3_legal_return_item_import_state";
    await client.query(
      `
        INSERT INTO ${table} (id, source_sha256, row_count, imported_at)
        VALUES (1, $1, $2::int, $3::timestamptz)
        ON CONFLICT (id) DO UPDATE SET
          source_sha256 = EXCLUDED.source_sha256,
          row_count = EXCLUDED.row_count,
          imported_at = EXCLUDED.imported_at
      `,
      [row.source_sha256, row.row_count, row.imported_at],
    );
  }

  for (const row of backup.tables.monthActivations as {
    dataset: string;
    sale_month: string;
    source_sha256: string;
    activated_at: string;
  }[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_month_activation (dataset, sale_month, source_sha256, activated_at)
        VALUES ($1, $2::date, $3, $4::timestamptz)
        ON CONFLICT (dataset, sale_month) DO UPDATE SET
          source_sha256 = EXCLUDED.source_sha256,
          activated_at = EXCLUDED.activated_at
      `,
      [row.dataset, row.sale_month, row.source_sha256, row.activated_at],
    );
  }

  for (const row of backup.tables.monthStats as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_import_month_stats (
          dataset, sale_month, source_sha256, full_row_count, matched_row_count, excluded_row_count, last_plan_hash, updated_at
        )
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::timestamptz)
        ON CONFLICT (dataset, sale_month, source_sha256) DO UPDATE SET
          full_row_count = EXCLUDED.full_row_count,
          matched_row_count = EXCLUDED.matched_row_count,
          excluded_row_count = EXCLUDED.excluded_row_count,
          last_plan_hash = EXCLUDED.last_plan_hash,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.dataset,
        row.sale_month,
        row.source_sha256,
        row.full_row_count,
        row.matched_row_count,
        row.excluded_row_count,
        row.last_plan_hash,
        row.updated_at,
      ],
    );
  }

  await client.query(`DELETE FROM onec_v3_legal_sales_import_quarantine_rows WHERE plan_hash = $1`, [
    backup.planHash,
  ]);
  for (const row of backup.tables.quarantineRows as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_import_quarantine_rows (
          plan_hash, dataset, source_sha256, source_row_index, legal_guid, sale_month, quarantine_reason, source_path
        )
        VALUES ($1, $2, $3, $4, $5::uuid, $6::date, $7, $8)
      `,
      [
        row.plan_hash,
        row.dataset,
        row.source_sha256,
        row.source_row_index,
        row.legal_guid,
        row.sale_month,
        row.quarantine_reason,
        row.source_path,
      ],
    );
  }

  for (const row of backup.tables.applyRuns as Record<string, unknown>[]) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_bundle_apply_runs (
          plan_hash, status, target_db_fingerprint, catalog_fingerprint,
          backup_sha256, before_state_sha256, after_state_sha256, receipt_json, applied_at, rolled_back_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz, $10::timestamptz)
        ON CONFLICT (plan_hash) DO UPDATE SET
          status = EXCLUDED.status,
          after_state_sha256 = EXCLUDED.after_state_sha256,
          rolled_back_at = EXCLUDED.rolled_back_at
      `,
      [
        row.plan_hash,
        row.status,
        row.target_db_fingerprint,
        row.catalog_fingerprint,
        row.backup_sha256,
        row.before_state_sha256,
        row.after_state_sha256,
        JSON.stringify(row.receipt_json ?? {}),
        row.applied_at,
        row.rolled_back_at,
      ],
    );
  }
}

export async function assertAfterStateMatchesReceipt(
  client: PoolClient,
  backup: MatchedOnlyScopedBackupV1,
  expectedAfterStateSha256: string,
): Promise<void> {
  const current = await captureScopedAfterStateDigest(client, backup.saleMonthsIso);
  if (current !== expectedAfterStateSha256) {
    throw new Error("ROLLBACK_DRIFT_AFTER_STATE");
  }
}
