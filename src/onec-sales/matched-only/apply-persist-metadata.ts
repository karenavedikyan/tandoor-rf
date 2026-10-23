import type { PoolClient } from "pg";
import type { MatchedOnlyBundleInput } from "./guards";
import type { BundlePartition } from "./partition";
import type { MatchedOnlyBundlePlanV1 } from "./types";
import type { MatchedOnlyDataset } from "./types";

const DATASET_TO_ACTIVATION: Record<string, string> = {
  sale_aggregate: "sale_aggregate",
  sale_items: "sale_items",
  return_aggregate: "return_aggregate",
  return_items: "return_items",
};

export async function verifyExpectedImportMetadata(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  partition: BundlePartition,
  rosters: MatchedOnlyBundleInput,
  planHash: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const months = plan.scope.saleMonthsIso;
  const activationPairs: { dataset: string; month: string; sha: string }[] = [];
  const pushMonths = (dataset: string, sha: string, lines: { saleMonthStartIso: string }[]) => {
    for (const month of new Set(lines.map((l) => l.saleMonthStartIso))) {
      activationPairs.push({ dataset, month, sha });
    }
  };
  pushMonths("sale_aggregate", rosters.saleAggregate.sourceSha256, rosters.saleAggregate.lines);
  pushMonths("sale_items", rosters.saleItems.sourceSha256, rosters.saleItems.lines);
  pushMonths("return_aggregate", rosters.returnsAggregate.sourceSha256, rosters.returnsAggregate.lines);
  pushMonths("return_items", rosters.returnItems.sourceSha256, rosters.returnItems.lines);

  for (const pair of activationPairs) {
    const row = await client.query<{ source_sha256: string }>(
      `SELECT source_sha256 FROM onec_v3_legal_sales_month_activation
       WHERE dataset = $1 AND sale_month = $2::date`,
      [pair.dataset, pair.month],
    );
    const sha = row.rows[0]?.source_sha256?.trim();
    if (sha !== pair.sha) {
      return { ok: false, code: "PERSISTED_ACTIVATION_MISMATCH", message: "Month activation SHA mismatch." };
    }
  }

  const stateExpectations = [
    { table: "onec_v3_legal_sales_import_state", count: partition.saleAggregate.matched.length },
    { table: "onec_v3_legal_sale_item_import_state", count: partition.saleItems.matched.length },
    { table: "onec_v3_legal_return_import_state", count: partition.returnsAggregate.matched.length },
    { table: "onec_v3_legal_return_item_import_state", count: partition.returnItems.matched.length },
  ];
  for (const state of stateExpectations) {
    const row = await client.query<{ row_count: number }>(
      `SELECT row_count FROM ${state.table} WHERE id = 1`,
    );
    if ((row.rows[0]?.row_count ?? -1) !== state.count) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${state.table} row_count mismatch.` };
    }
  }

  const statsCases = [
    { dataset: "sale_aggregate" as MatchedOnlyDataset, roster: rosters.saleAggregate, partition: partition.saleAggregate },
    { dataset: "sale_items" as MatchedOnlyDataset, roster: rosters.saleItems, partition: partition.saleItems },
    { dataset: "return_aggregate" as MatchedOnlyDataset, roster: rosters.returnsAggregate, partition: partition.returnsAggregate },
    { dataset: "return_items" as MatchedOnlyDataset, roster: rosters.returnItems, partition: partition.returnItems },
  ];
  for (const item of statsCases) {
    const sourceSha = item.roster.sourceSha256;
    const monthsInRoster = [...new Set(item.roster.lines.map((l) => l.saleMonthStartIso))];
    for (const month of monthsInRoster) {
      const full = item.roster.lines.filter((l) => l.saleMonthStartIso === month).length;
      const matched = item.partition.matched.filter((l) => l.saleMonthStartIso === month).length;
      const excluded = full - matched;
      const row = await client.query<{ full_row_count: number; matched_row_count: number; excluded_row_count: number }>(
        `SELECT full_row_count, matched_row_count, excluded_row_count
         FROM onec_v3_legal_sales_import_month_stats
         WHERE dataset = $1 AND sale_month = $2::date AND source_sha256 = $3`,
        [item.dataset, month, sourceSha],
      );
      const stats = row.rows[0];
      if (!stats || stats.full_row_count !== full || stats.matched_row_count !== matched || stats.excluded_row_count !== excluded) {
        return { ok: false, code: "PERSISTED_MONTH_STATS_MISMATCH", message: "Month stats mismatch." };
      }
    }
  }

  const quarantine = await client.query<{ dataset: string; source_row_index: number; legal_guid: string }>(
    `SELECT dataset, source_row_index, legal_guid::text
     FROM onec_v3_legal_sales_import_quarantine_rows
     WHERE plan_hash = $1
     ORDER BY dataset, source_row_index, legal_guid`,
    [planHash],
  );
  const expectedQuarantine: string[] = [];
  const pushExcluded = (dataset: MatchedOnlyDataset, lines: { legalGuid: string; sourceRowIndex: number }[]) => {
    for (const line of lines) {
      expectedQuarantine.push(`${dataset}|${line.sourceRowIndex}|${line.legalGuid.toLowerCase()}`);
    }
  };
  pushExcluded("sale_aggregate", partition.saleAggregate.excluded);
  pushExcluded("sale_items", partition.saleItems.excluded);
  pushExcluded("return_aggregate", partition.returnsAggregate.excluded);
  pushExcluded("return_items", partition.returnItems.excluded);
  expectedQuarantine.sort();
  const actualQuarantine = quarantine.rows
    .map((r) => `${r.dataset}|${r.source_row_index}|${r.legal_guid.toLowerCase()}`)
    .sort();
  if (actualQuarantine.join("\n") !== expectedQuarantine.join("\n")) {
    return { ok: false, code: "PERSISTED_QUARANTINE_MISMATCH", message: "Quarantine rows mismatch." };
  }

  return { ok: true };
}
