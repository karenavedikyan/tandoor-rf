import type { PoolClient } from "pg";
import { sha256CanonicalJson } from "../matched-only/canonical-json";
import { SEPTEMBER_2026_SALE_MONTH_ISO } from "./scope-pins";

export type September047048Snapshot = {
  v: 1;
  saleMonthIso: string;
  saleAggregateLines: unknown[];
  saleItemLines: unknown[];
  returnLines: unknown[];
  returnItemLines: unknown[];
  importStates: unknown[];
  monthActivations: unknown[];
};

export async function captureSeptember047048BeforeState(client: PoolClient): Promise<{
  digest: string;
  snapshot: September047048Snapshot;
}> {
  const months = [SEPTEMBER_2026_SALE_MONTH_ISO];
  const [saleAggregateLines, saleItemLines, returnLines, returnItemLines, importStates, monthActivations] =
    await Promise.all([
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
    ]);
  const snapshot: September047048Snapshot = {
    v: 1,
    saleMonthIso: SEPTEMBER_2026_SALE_MONTH_ISO,
    saleAggregateLines: saleAggregateLines.rows,
    saleItemLines: saleItemLines.rows,
    returnLines: returnLines.rows,
    returnItemLines: returnItemLines.rows,
    importStates: importStates.rows,
    monthActivations: monthActivations.rows,
  };
  return { digest: sha256CanonicalJson(snapshot), snapshot };
}
