import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { loadSalesImportSnapshotState, monthHasSaleAggregate } from "../../onec-sales/import-snapshot";
import { v3EntityAssignmentScope } from "./access-scope";
import { appendTerritoryAssignmentFilters, type V3ListQuery } from "./list";
import { readableGroupKey } from "./list-legal-grouped";
import { parseClientSalesMonthStrict, resolveDefaultClientSalesMonth } from "./client-sales-summary";

export type SalesInsight = {
  group_key: string;
  income: string | null;
  manager: string | null;
  manager_name: string | null;
  peers: number;
  low: string | null;
  high: string | null;
  band: "large" | "middle" | "low" | "zero" | "adjustment" | "unavailable" | "unrated";
};
export type SalesRanking = { month: string; keys: string[]; cells: Map<string, SalesInsight> };

export class SalesRankingUnavailable extends Error {}

/** Read-only; cohort is built before search/range/paging and partitioned by manager.
 * No retail joins, hence no multiplication of legal revenue by outlets.
 */
export async function loadSalesRanking(context: AccessContext, input: V3ListQuery): Promise<SalesRanking | null> {
  if (input.entity === "retail" || input.entity === "orphan_retail") return null;
  const snapshot = await loadSalesImportSnapshotState();
  const month = input.salesMonth || (snapshot.schemaReady ? await resolveDefaultClientSalesMonth(context, input) : null);
  const parsed = month ? parseClientSalesMonthStrict(month) : { ok: false as const };
  if (!snapshot.schemaReady || !parsed.ok || !(await monthHasSaleAggregate(parsed.monthStartIso))) {
    if (input.salesSort || input.salesMin !== undefined || input.salesMax !== undefined) {
      throw new SalesRankingUnavailable("Продажи за выбранный месяц не загружены. Выберите месяц с данными.");
    }
    return null;
  }
  const scope = v3EntityAssignmentScope(context, "le", "legal");
  const params = [...scope.params];
  const territory = appendTerritoryAssignmentFilters(input, "le", params);
  const groupKey = input.entity === "legal" ? "'legal:' || le.guid_client::text" : readableGroupKey(context, params);
  params.push(parsed.monthStartIso);
  const monthIndex = params.length;
  let range = "";
  if (input.salesMin !== undefined) {
    params.push(input.salesMin);
    range += ` AND g.income >= $${params.length}::numeric`;
  }
  if (input.salesMax !== undefined) {
    params.push(input.salesMax);
    range += ` AND g.income <= $${params.length}::numeric`;
  }
  const direction = input.salesSort === "asc" ? "ASC" : "DESC";
  const rows = await query<SalesInsight>(`
    WITH base AS (
      SELECT le.guid_client, ${groupKey} AS group_key,
        NULLIF(lower(NULLIF(trim(le.managers->>'guidManager'), '')), '00000000-0000-0000-0000-000000000000') AS manager,
        NULLIF(trim(le.managers->>'nameManager'), '') AS manager_name
      FROM onec_v3_legal_entities le WHERE (${scope.clause})${territory}
    ), amounts AS (
      SELECT sl.legal_guid, SUM(sl.income) AS income
      FROM onec_v3_legal_sales_lines sl
      WHERE sl.sale_month = $${monthIndex}::date
        AND EXISTS (SELECT 1 FROM base b WHERE b.guid_client = sl.legal_guid)
      GROUP BY sl.legal_guid
    ), grouped AS (
      SELECT b.group_key,
        CASE WHEN BOOL_AND(a.legal_guid IS NOT NULL) THEN SUM(a.income) END AS income,
        CASE WHEN COUNT(DISTINCT b.manager) = 1 AND BOOL_AND(b.manager IS NOT NULL)
          THEN MIN(b.manager) END AS manager,
        MAX(b.manager_name) AS manager_name
      FROM base b LEFT JOIN amounts a ON a.legal_guid = b.guid_client GROUP BY b.group_key
    ), manager_groups AS (
      SELECT b.group_key, b.manager,
        CASE WHEN BOOL_AND(a.legal_guid IS NOT NULL) THEN SUM(a.income) END AS income
      FROM base b LEFT JOIN amounts a ON a.legal_guid = b.guid_client
      GROUP BY b.group_key, b.manager
    ), cohort_values AS (
      SELECT manager, COUNT(*)::int AS peers, array_agg(income ORDER BY income) AS amounts
      FROM manager_groups WHERE manager IS NOT NULL AND income > 0 GROUP BY manager
    ), cohorts AS (
      SELECT manager, peers,
        amounts[1+floor((peers-1)*0.25)::int] +
          (amounts[1+ceil((peers-1)*0.25)::int] - amounts[1+floor((peers-1)*0.25)::int]) *
          ((peers-1)*0.25-floor((peers-1)*0.25)) AS low,
        amounts[1+floor((peers-1)*0.75)::int] +
          (amounts[1+ceil((peers-1)*0.75)::int] - amounts[1+floor((peers-1)*0.75)::int]) *
          ((peers-1)*0.75-floor((peers-1)*0.75)) AS high
      FROM cohort_values
    )
    SELECT g.group_key, g.income::text, g.manager, g.manager_name,
      COALESCE(c.peers, 0) AS peers, c.low::text, c.high::text,
      CASE WHEN g.income IS NULL THEN 'unavailable'
        WHEN g.income = 0 THEN 'zero'
        WHEN g.income < 0 THEN 'adjustment'
        WHEN g.manager IS NULL OR COALESCE(c.peers,0) < 4 THEN 'unrated'
        WHEN c.low = c.high THEN 'middle'
        WHEN g.income >= c.high THEN 'large'
        WHEN g.income <= c.low THEN 'low'
        ELSE 'middle' END AS band
    FROM grouped g LEFT JOIN cohorts c ON c.manager = g.manager
    WHERE TRUE${range}
    ORDER BY g.income ${direction} NULLS LAST, g.group_key ASC
  `, params);
  return { month: parsed.yyyyMm, keys: rows.rows.map(r => r.group_key), cells: new Map(rows.rows.map(r => [r.group_key, r])) };
}
