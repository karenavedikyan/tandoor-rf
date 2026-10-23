import type { PoolClient } from "pg";
import { sha256CanonicalJson } from "./canonical-json";
import type { MatchedOnlyBundlePlanV1, MatchedOnlyScopedBackupV1 } from "./types";

export function businessDigestFromScopedTables(input: {
  saleMonthsIso: string[];
  tables: MatchedOnlyScopedBackupV1["tables"];
}): string {
  const months = [...input.saleMonthsIso].sort();
  const payload = {
    v: 1,
    saleMonthsIso: months,
    saleAggregateLines: input.tables.saleAggregateLines,
    saleItemLines: input.tables.saleItemLines,
    returnLines: input.tables.returnLines,
    returnItemLines: input.tables.returnItemLines,
    importStates: input.tables.importStates,
    monthActivations: input.tables.monthActivations,
    monthStats: input.tables.monthStats,
    quarantineRows: input.tables.quarantineRows,
  };
  return sha256CanonicalJson(payload);
}

export async function captureScopedBeforeState(
  client: PoolClient,
  saleMonthsIso: string[],
): Promise<{
  digest: string;
  businessDigest: string;
  payload: Record<string, unknown>;
}> {
  const months = [...saleMonthsIso].sort();
  const [
    saleAggregateLines,
    saleItemLines,
    returnLines,
    returnItemLines,
    importStates,
    monthActivations,
    monthStats,
    quarantineRows,
  ] = await Promise.all([
    client.query(
      `SELECT * FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[]) ORDER BY legal_guid, sale_month, product_type`,
      [months],
    ),
    client.query(
      `SELECT * FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[]) ORDER BY source_sha256, source_row_index`,
      [months],
    ),
    client.query(
      `SELECT * FROM onec_v3_legal_return_lines WHERE sale_month = ANY($1::date[]) ORDER BY source_sha256, source_row_index`,
      [months],
    ),
    client.query(
      `SELECT * FROM onec_v3_legal_return_item_lines WHERE sale_month = ANY($1::date[]) ORDER BY source_sha256, source_row_index`,
      [months],
    ),
    client.query(
      `
        SELECT 'sale_aggregate' AS dataset, source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_sales_import_state WHERE id = 1
        UNION ALL
        SELECT 'sale_items', source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_sale_item_import_state WHERE id = 1
        UNION ALL
        SELECT 'return_aggregate', source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_return_import_state WHERE id = 1
        UNION ALL
        SELECT 'return_items', source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_return_item_import_state WHERE id = 1
      `,
    ),
    client.query(
      `SELECT dataset, sale_month::text, source_sha256, activated_at::text
       FROM onec_v3_legal_sales_month_activation
       WHERE sale_month = ANY($1::date[])
       ORDER BY dataset, sale_month`,
      [months],
    ),
    safeQuery(
      client,
      `SELECT dataset, sale_month::text, source_sha256, full_row_count, matched_row_count, excluded_row_count, last_plan_hash, updated_at::text
       FROM onec_v3_legal_sales_import_month_stats
       WHERE sale_month = ANY($1::date[])
       ORDER BY dataset, sale_month, source_sha256`,
      [months],
    ),
    safeQuery(
      client,
      `SELECT plan_hash, dataset, source_sha256, source_row_index, lower(legal_guid::text) AS legal_guid, sale_month::text, quarantine_reason, source_path
       FROM onec_v3_legal_sales_import_quarantine_rows
       WHERE sale_month = ANY($1::date[])
       ORDER BY dataset, source_sha256, source_row_index`,
      [months],
    ),
  ]);

  const payload = {
    v: 1,
    saleMonthsIso: months,
    saleAggregateLines: saleAggregateLines.rows,
    saleItemLines: saleItemLines.rows,
    returnLines: returnLines.rows,
    returnItemLines: returnItemLines.rows,
    importStates: importStates.rows,
    monthActivations: monthActivations.rows,
    monthStats: monthStats.rows,
    quarantineRows: quarantineRows.rows,
  };
  const businessPayload = payload;
  return {
    digest: sha256CanonicalJson(businessPayload),
    payload,
    businessDigest: sha256CanonicalJson(businessPayload),
  };
}

async function safeQuery(
  client: PoolClient,
  sql: string,
  params: unknown[],
): Promise<{ rows: unknown[] }> {
  try {
    return await client.query(sql, params);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      return { rows: [] };
    }
    throw error;
  }
}

export function operationsDigest(plan: Pick<MatchedOnlyBundlePlanV1, "sourceHashes" | "scope">): string {
  return sha256CanonicalJson({
    v: 1,
    sourceHashes: plan.sourceHashes,
    saleMonthsIso: plan.scope.saleMonthsIso,
  });
}

export async function captureScopedAfterStateDigest(
  client: PoolClient,
  saleMonthsIso: string[],
): Promise<string> {
  const captured = await captureScopedBeforeState(client, saleMonthsIso);
  return captured.businessDigest;
}
