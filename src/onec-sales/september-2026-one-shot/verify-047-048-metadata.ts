import type { PoolClient } from "pg";
import type { MatchedOnlyBundleInput } from "../matched-only/guards";
import type { BundlePartition } from "../matched-only/partition";

export async function verifySeptember047048Metadata(
  client: PoolClient,
  partition: BundlePartition,
  rosters: MatchedOnlyBundleInput,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const states = [
    { table: "onec_v3_legal_sales_import_state", sha: rosters.saleAggregate.sourceSha256, count: partition.saleAggregate.matched.length },
    { table: "onec_v3_legal_sale_item_import_state", sha: rosters.saleItems.sourceSha256, count: partition.saleItems.matched.length },
    { table: "onec_v3_legal_return_import_state", sha: rosters.returnsAggregate.sourceSha256, count: partition.returnsAggregate.matched.length },
    { table: "onec_v3_legal_return_item_import_state", sha: rosters.returnItems.sourceSha256, count: partition.returnItems.matched.length },
  ];
  for (const s of states) {
    const row = await client.query<{ row_count: number; source_sha256: string }>(
      `SELECT row_count, trim(source_sha256) AS source_sha256 FROM ${s.table} WHERE id = 1`,
    );
    if ((row.rows[0]?.row_count ?? -1) !== s.count) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${s.table} row_count mismatch.` };
    }
    if (row.rows[0]?.source_sha256 !== s.sha) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${s.table} source_sha256 mismatch.` };
    }
  }
  const activationPairs = [
    { dataset: "sale_aggregate", sha: rosters.saleAggregate.sourceSha256 },
    { dataset: "sale_items", sha: rosters.saleItems.sourceSha256 },
    { dataset: "return_aggregate", sha: rosters.returnsAggregate.sourceSha256 },
    { dataset: "return_items", sha: rosters.returnItems.sourceSha256 },
  ];
  for (const pair of activationPairs) {
    const row = await client.query<{ source_sha256: string }>(
      `SELECT source_sha256 FROM onec_v3_legal_sales_month_activation WHERE dataset = $1 AND sale_month = $2::date`,
      [pair.dataset, rosters.saleAggregate.lines[0]?.saleMonthStartIso ?? "2026-09-01"],
    );
    if (row.rows[0]?.source_sha256?.trim() !== pair.sha) {
      return { ok: false, code: "PERSISTED_ACTIVATION_MISMATCH", message: "Activation SHA mismatch." };
    }
  }
  return { ok: true };
}
