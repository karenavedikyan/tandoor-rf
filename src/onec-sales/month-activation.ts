import type { PoolClient } from "pg";

export type SalesMonthDataset =
  | "sale_aggregate"
  | "sale_items"
  | "return_aggregate"
  | "return_items";

export async function activateSalesMonthSnapshots(
  client: PoolClient,
  dataset: SalesMonthDataset,
  sourceSha256: string,
  saleMonthIsos: string[],
): Promise<void> {
  for (const monthIso of saleMonthIsos) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_month_activation (dataset, sale_month, source_sha256, activated_at)
        VALUES ($1, $2::date, $3, NOW())
        ON CONFLICT (dataset, sale_month) DO UPDATE SET
          source_sha256 = EXCLUDED.source_sha256,
          activated_at = EXCLUDED.activated_at
      `,
      [dataset, monthIso, sourceSha256],
    );
  }
}

export async function loadActiveMonthSha(
  client: PoolClient,
  dataset: SalesMonthDataset,
  saleMonthIso: string,
): Promise<string | null> {
  const row = await client.query<{ source_sha256: string }>(
    `
      SELECT source_sha256
      FROM onec_v3_legal_sales_month_activation
      WHERE dataset = $1 AND sale_month = $2::date
      LIMIT 1
    `,
    [dataset, saleMonthIso],
  );
  return row.rows[0]?.source_sha256 ?? null;
}
