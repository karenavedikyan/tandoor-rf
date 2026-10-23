import { query } from "../db/pool";
import type { SalesMonthDataset } from "./month-activation";

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

export async function getActiveSourceShaForMonth(
  dataset: SalesMonthDataset,
  saleMonthIso: string,
): Promise<string | null> {
  try {
    const rows = await query<{ source_sha256: string }>(
      `
        SELECT source_sha256
        FROM onec_v3_legal_sales_month_activation
        WHERE dataset = $1 AND sale_month = $2::date
        LIMIT 1
      `,
      [dataset, saleMonthIso],
    );
    return rows.rows[0]?.source_sha256 ?? null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      return null;
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

const ITEM_LINES_TABLE: Record<"sale_items" | "return_items", string> = {
  sale_items: "onec_v3_legal_sale_item_lines",
  return_items: "onec_v3_legal_return_item_lines",
};

/** Active sha for a month: activation row, else newest imported snapshot for that month, else global import_state. */
export async function resolveMonthDatasetSha(
  dataset: SalesMonthDataset,
  saleMonthIso: string,
  snapshotSha: string | null,
): Promise<string | null> {
  const activated = await getActiveSourceShaForMonth(dataset, saleMonthIso);
  if (activated) {
    return activated;
  }
  if (dataset === "sale_items" || dataset === "return_items") {
    const table = ITEM_LINES_TABLE[dataset];
    try {
      const rows = await query<{ source_sha256: string }>(
        `
          SELECT source_sha256
          FROM ${table}
          WHERE sale_month = $1::date
          ORDER BY imported_at DESC
          LIMIT 1
        `,
        [saleMonthIso],
      );
      if (rows.rows[0]?.source_sha256) {
        return rows.rows[0].source_sha256;
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42P01") {
        throw error;
      }
    }
  }
  if (dataset === "return_aggregate") {
    try {
      const rows = await query<{ source_sha256: string }>(
        `
          SELECT source_sha256
          FROM onec_v3_legal_return_lines
          WHERE sale_month = $1::date
          ORDER BY imported_at DESC
          LIMIT 1
        `,
        [saleMonthIso],
      );
      if (rows.rows[0]?.source_sha256) {
        return rows.rows[0].source_sha256;
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42P01") {
        throw error;
      }
    }
  }
  return snapshotSha;
}

const LINE_TABLE_DATASET: Record<
  | "onec_v3_legal_sale_item_lines"
  | "onec_v3_legal_return_lines"
  | "onec_v3_legal_return_item_lines",
  "sale_items" | "return_aggregate" | "return_items"
> = {
  onec_v3_legal_sale_item_lines: "sale_items",
  onec_v3_legal_return_lines: "return_aggregate",
  onec_v3_legal_return_item_lines: "return_items",
};

async function countExcludedFromMonthStats(
  dataset: "sale_items" | "return_aggregate" | "return_items",
  activeSha: string,
  monthIso: string,
): Promise<number | null> {
  try {
    const rows = await query<{ excluded_row_count: number }>(
      `
        SELECT excluded_row_count
        FROM onec_v3_legal_sales_import_month_stats
        WHERE dataset = $1 AND source_sha256 = $2 AND sale_month = $3::date
        LIMIT 1
      `,
      [dataset, activeSha, monthIso],
    );
    if (rows.rows.length === 0) {
      return null;
    }
    return Number(rows.rows[0]?.excluded_row_count ?? 0);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      return null;
    }
    throw error;
  }
}

async function countExcludedFromQuarantineManifest(
  dataset: "sale_items" | "return_aggregate" | "return_items",
  activeSha: string | null,
  monthIso: string,
): Promise<number | null> {
  try {
    const rows = await query<{ count: string }>(
      activeSha
        ? `
        SELECT COUNT(*)::text AS count
        FROM onec_v3_legal_sales_import_quarantine_rows
        WHERE dataset = $1 AND source_sha256 = $2 AND sale_month = $3::date
      `
        : `
        SELECT COUNT(*)::text AS count
        FROM onec_v3_legal_sales_import_quarantine_rows
        WHERE dataset = $1 AND sale_month = $2::date
      `,
      activeSha ? [dataset, activeSha, monthIso] : [dataset, monthIso],
    );
    return Number(rows.rows[0]?.count ?? 0);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      return null;
    }
    throw error;
  }
}

export async function countQuarantinedRows(
  table:
    | "onec_v3_legal_sale_item_lines"
    | "onec_v3_legal_return_lines"
    | "onec_v3_legal_return_item_lines",
  activeSha: string | null,
  monthIso: string,
): Promise<number> {
  const dataset = LINE_TABLE_DATASET[table];
  if (activeSha) {
    const fromStats = await countExcludedFromMonthStats(dataset, activeSha, monthIso);
    if (fromStats !== null) {
      return fromStats;
    }
  }
  const fromManifest = await countExcludedFromQuarantineManifest(dataset, activeSha, monthIso);
  if (fromManifest !== null && (fromManifest > 0 || activeSha)) {
    return fromManifest;
  }
  const rows = await query<{ count: string }>(
    activeSha
      ? `
      SELECT COUNT(*)::text AS count
      FROM ${table}
      WHERE source_sha256 = $1 AND sale_month = $2::date AND catalog_matched = FALSE
    `
      : `
      SELECT COUNT(*)::text AS count
      FROM ${table}
      WHERE sale_month = $1::date AND catalog_matched = FALSE
    `,
    activeSha ? [activeSha, monthIso] : [monthIso],
  );
  return Number(rows.rows[0]?.count ?? 0);
}
