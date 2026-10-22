import { query } from "../db/pool";

export type SalesImportSnapshotState = {
  schemaReady: boolean;
  saleAggregateSha: string | null;
  saleItemsSha: string | null;
  returnsAggregateSha: string | null;
  returnItemsSha: string | null;
};

export async function loadSalesImportSnapshotState(): Promise<SalesImportSnapshotState> {
  try {
    const result = await query<{
      agg_sha: string | null;
      items_sha: string | null;
      ret_sha: string | null;
      ret_items_sha: string | null;
    }>(
      `
        SELECT
          (SELECT source_sha256 FROM onec_v3_legal_sales_import_state WHERE id = 1) AS agg_sha,
          (SELECT source_sha256 FROM onec_v3_legal_sale_item_import_state WHERE id = 1) AS items_sha,
          (SELECT source_sha256 FROM onec_v3_legal_return_import_state WHERE id = 1) AS ret_sha,
          (SELECT source_sha256 FROM onec_v3_legal_return_item_import_state WHERE id = 1) AS ret_items_sha
      `,
    );
    const row = result.rows[0] ?? {};
    return {
      schemaReady: true,
      saleAggregateSha: row.agg_sha,
      saleItemsSha: row.items_sha,
      returnsAggregateSha: row.ret_sha,
      returnItemsSha: row.ret_items_sha,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      return {
        schemaReady: false,
        saleAggregateSha: null,
        saleItemsSha: null,
        returnsAggregateSha: null,
        returnItemsSha: null,
      };
    }
    throw error;
  }
}

export async function monthHasSaleItems(activeSha: string, monthIso: string): Promise<boolean> {
  const rows = await query<{ ok: number }>(
    `
      SELECT 1 AS ok
      FROM onec_v3_legal_sale_item_lines
      WHERE source_sha256 = $1 AND sale_month = $2::date
      LIMIT 1
    `,
    [activeSha, monthIso],
  );
  return rows.rows.length > 0;
}

export async function monthHasSaleAggregate(monthIso: string): Promise<boolean> {
  const rows = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM onec_v3_legal_sales_lines WHERE sale_month = $1::date LIMIT 1`,
    [monthIso],
  );
  return rows.rows.length > 0;
}

export async function monthHasReturnItems(activeSha: string, monthIso: string): Promise<boolean> {
  const rows = await query<{ ok: number }>(
    `
      SELECT 1 AS ok
      FROM onec_v3_legal_return_item_lines
      WHERE source_sha256 = $1 AND sale_month = $2::date
      LIMIT 1
    `,
    [activeSha, monthIso],
  );
  return rows.rows.length > 0;
}

export async function monthHasReturnAggregate(activeSha: string, monthIso: string): Promise<boolean> {
  const rows = await query<{ ok: number }>(
    `
      SELECT 1 AS ok
      FROM onec_v3_legal_return_lines
      WHERE source_sha256 = $1 AND sale_month = $2::date
      LIMIT 1
    `,
    [activeSha, monthIso],
  );
  return rows.rows.length > 0;
}
