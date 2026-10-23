import type { PoolClient } from "pg";
import { sha256CanonicalJson } from "../matched-only/canonical-json";
import { SEPTEMBER_2026_SALE_MONTH_ISO } from "./scope-pins";
import { capturePgJsonRowset } from "./scoped-pg-json-snapshot";

export type September047048Snapshot = {
  v: 2;
  saleMonthIso: string;
  /** Each field is raw PostgreSQL JSON text (`json_agg(row_to_json(...))`), not parsed in JS. */
  saleAggregateLinesJson: string;
  saleItemLinesJson: string;
  returnLinesJson: string;
  returnItemLinesJson: string;
  importStatesJson: string;
  monthActivationsJson: string;
};

export async function captureSeptember047048BeforeState(client: PoolClient): Promise<{
  digest: string;
  snapshot: September047048Snapshot;
}> {
  const months = [SEPTEMBER_2026_SALE_MONTH_ISO];
  const [
    saleAggregateLinesJson,
    saleItemLinesJson,
    returnLinesJson,
    returnItemLinesJson,
    importStatesJson,
    monthActivationsJson,
  ] = await Promise.all([
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.legal_guid, t.sale_month, t.product_type)::text
           FROM onec_v3_legal_sales_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months],
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.source_sha256, t.source_row_index)::text
           FROM onec_v3_legal_sale_item_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months],
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.source_sha256, t.source_row_index)::text
           FROM onec_v3_legal_return_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months],
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.source_sha256, t.source_row_index)::text
           FROM onec_v3_legal_return_item_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months],
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(x) ORDER BY x.dataset)::text
           FROM (
             SELECT 'sale_aggregate'::text AS dataset, s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_sales_import_state s WHERE s.id = 1
             UNION ALL
             SELECT 'sale_items', s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_sale_item_import_state s WHERE s.id = 1
             UNION ALL
             SELECT 'return_aggregate', s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_return_import_state s WHERE s.id = 1
             UNION ALL
             SELECT 'return_items', s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_return_item_import_state s WHERE s.id = 1
           ) x),
          '[]'
        ) AS snapshot_json
      `,
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.dataset, t.sale_month)::text
           FROM onec_v3_legal_sales_month_activation t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months],
    ),
  ]);
  const snapshot: September047048Snapshot = {
    v: 2,
    saleMonthIso: SEPTEMBER_2026_SALE_MONTH_ISO,
    saleAggregateLinesJson,
    saleItemLinesJson,
    returnLinesJson,
    returnItemLinesJson,
    importStatesJson,
    monthActivationsJson,
  };
  return { digest: sha256CanonicalJson(snapshot), snapshot };
}
