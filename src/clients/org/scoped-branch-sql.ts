import { combineScopeAndFilter } from "../../access/combine-filters";
import { buildClientScopeSql } from "../../access/scope-sql";
import type { AccessContext } from "../../access/types";
import { ACTIVE_BASELINE_OC_SQL } from "../../onec-clients/baseline-active-scope";
import { ropPortfolioClause } from "./assignment-sql";

export type OrgRopBranchClientScope = {
  /** SQL boolean expression (no leading WHERE). */
  clause: string;
  params: unknown[];
  denied: boolean;
};

function remapClientScopeAlias(scopeWhereSql: string, clientAlias: string): string {
  return scopeWhereSql.replaceAll("onec_clients.", `${clientAlias}.`);
}

/**
 * Clients visible to the caller within a fixed ROP assignment branch.
 * Combines buildClientScopeSql (grants, denials, role scope) with headOfSales portfolio.
 */
export function orgRopBranchClientScope(
  context: AccessContext,
  ropEmployeeGuid: string,
  clientAlias = "oc",
): OrgRopBranchClientScope {
  const scope = buildClientScopeSql(context);
  const scopedForAlias: typeof scope = {
    whereSql: remapClientScopeAlias(scope.whereSql, clientAlias),
    params: scope.params,
  };

  const filter = combineScopeAndFilter(scopedForAlias, {
    whereSql: `WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", `${clientAlias}.`)} AND ${ropPortfolioClause("$1", clientAlias)}`,
    params: [ropEmployeeGuid.toLowerCase()],
  });

  if (filter.whereSql === "WHERE FALSE") {
    return { clause: "FALSE", params: [], denied: true };
  }

  const clause = filter.whereSql ? filter.whereSql.replace(/^WHERE\s+/, "") : "TRUE";
  return { clause, params: filter.params, denied: false };
}
