import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";

export type V3UnassignedSummary = {
  limitationNote: string;
  missingManager: {
    holdings: number;
    legal: number;
    retail: number;
    total: number;
  };
};

import { v3JsonManagerField } from "./json-paths";

function missingManagerClause(alias: string): string {
  return `NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidManager")}, '')), '') IS NULL`;
}

export async function buildV3UnassignedSummary(context: AccessContext): Promise<V3UnassignedSummary> {
  const hScope = v3HoldingVisibilityScope(context, "h");
  const leScope = v3EntityAssignmentScope(context, "le", "legal");
  const roScope = v3EntityAssignmentScope(context, "ro", "retail");

  const [holdings, legal, retail] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_holdings h WHERE (${hScope.clause}) AND ${missingManagerClause("h")}`,
      hScope.params,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_legal_entities le WHERE (${leScope.clause}) AND ${missingManagerClause("le")}`,
      leScope.params,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_retail_outlets ro WHERE (${roScope.clause}) AND ${missingManagerClause("ro")}`,
      roScope.params,
    ),
  ]);

  const h = Number(holdings.rows[0]?.count ?? 0);
  const l = Number(legal.rows[0]?.count ?? 0);
  const r = Number(retail.rows[0]?.count ?? 0);

  return {
    limitationNote: "Сводка по объектам exchange v3 в вашей области видимости без менеджера в выгрузке 1С.",
    missingManager: {
      holdings: h,
      legal: l,
      retail: r,
      total: h + l + r,
    },
  };
}
