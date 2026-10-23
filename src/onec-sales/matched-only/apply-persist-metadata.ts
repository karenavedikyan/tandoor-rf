import type { PoolClient } from "pg";
import type { MatchedOnlyBundleInput } from "./guards";
import type { BundlePartition } from "./partition";
import type { MatchedOnlyBundlePlanV1 } from "./types";
import type { MatchedOnlyDataset } from "./types";

const DEFAULT_QUARANTINE_REASON = "unknown_catalog_guid";
const DEFAULT_SOURCE_PATH = "/LC/sale/";

export async function verifyExpectedImportMetadata(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  partition: BundlePartition,
  rosters: MatchedOnlyBundleInput,
  planHash: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
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
    { table: "onec_v3_legal_sales_import_state", sha: rosters.saleAggregate.sourceSha256, count: partition.saleAggregate.matched.length },
    { table: "onec_v3_legal_sale_item_import_state", sha: rosters.saleItems.sourceSha256, count: partition.saleItems.matched.length },
    { table: "onec_v3_legal_return_import_state", sha: rosters.returnsAggregate.sourceSha256, count: partition.returnsAggregate.matched.length },
    { table: "onec_v3_legal_return_item_import_state", sha: rosters.returnItems.sourceSha256, count: partition.returnItems.matched.length },
  ];
  for (const state of stateExpectations) {
    const row = await client.query<{ row_count: number; source_sha256: string }>(
      `SELECT row_count, trim(source_sha256) AS source_sha256 FROM ${state.table} WHERE id = 1`,
    );
    if ((row.rows[0]?.row_count ?? -1) !== state.count) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${state.table} row_count mismatch.` };
    }
    if (row.rows[0]?.source_sha256 !== state.sha) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${state.table} source_sha256 mismatch.` };
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
      const row = await client.query<{ full_row_count: number; matched_row_count: number; excluded_row_count: number; last_plan_hash: string }>(
        `SELECT full_row_count, matched_row_count, excluded_row_count, trim(last_plan_hash) AS last_plan_hash
         FROM onec_v3_legal_sales_import_month_stats
         WHERE dataset = $1 AND sale_month = $2::date AND source_sha256 = $3`,
        [item.dataset, month, sourceSha],
      );
      const stats = row.rows[0];
      if (
        !stats ||
        stats.full_row_count !== full ||
        stats.matched_row_count !== matched ||
        stats.excluded_row_count !== excluded ||
        stats.last_plan_hash !== planHash
      ) {
        return { ok: false, code: "PERSISTED_MONTH_STATS_MISMATCH", message: "Month stats mismatch." };
      }
    }
  }

  const expectedQuarantine: string[] = [];
  const pushExcluded = (
    dataset: MatchedOnlyDataset,
    sourceSha: string,
    lines: { legalGuid: string; saleMonthStartIso: string; sourceRowIndex: number }[],
  ) => {
    for (const line of lines) {
      expectedQuarantine.push(
        `${dataset}|${sourceSha}|${line.sourceRowIndex}|${line.legalGuid.toLowerCase()}|${line.saleMonthStartIso}|${DEFAULT_QUARANTINE_REASON}|${DEFAULT_SOURCE_PATH}`,
      );
    }
  };
  pushExcluded("sale_aggregate", rosters.saleAggregate.sourceSha256, partition.saleAggregate.excluded);
  pushExcluded("sale_items", rosters.saleItems.sourceSha256, partition.saleItems.excluded);
  pushExcluded("return_aggregate", rosters.returnsAggregate.sourceSha256, partition.returnsAggregate.excluded);
  pushExcluded("return_items", rosters.returnItems.sourceSha256, partition.returnItems.excluded);
  expectedQuarantine.sort();

  const quarantine = await client.query<{
    dataset: string;
    source_sha256: string;
    source_row_index: number;
    legal_guid: string;
    sale_month: string;
    quarantine_reason: string;
    source_path: string;
  }>(
    `SELECT dataset, trim(source_sha256) AS source_sha256, source_row_index, legal_guid::text,
            sale_month::text, quarantine_reason, source_path
     FROM onec_v3_legal_sales_import_quarantine_rows
     WHERE plan_hash = $1`,
    [planHash],
  );
  const actualQuarantine = quarantine.rows
    .map(
      (r) =>
        `${r.dataset}|${r.source_sha256}|${r.source_row_index}|${r.legal_guid.toLowerCase()}|${r.sale_month.slice(0, 10)}|${r.quarantine_reason}|${r.source_path}`,
    )
    .sort();
  if (actualQuarantine.join("\n") !== expectedQuarantine.join("\n")) {
    return { ok: false, code: "PERSISTED_QUARANTINE_MISMATCH", message: "Quarantine rows mismatch." };
  }

  return { ok: true };
}
