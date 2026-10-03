import type { ClientScopeSql } from "../access/types";

/** SQL fragment: only clients in the active wholesale baseline (excludes archived/quarantined). */
export const ACTIVE_BASELINE_CLIENT_SQL = `
  COALESCE(onec_clients.baseline_status, 'active') = 'active'
`;

export const ACTIVE_BASELINE_OC_SQL = `
  COALESCE(oc.baseline_status, 'active') = 'active'
`;

export function appendActiveBaselineFilter(scope: ClientScopeSql): ClientScopeSql {
  if (scope.whereSql === "WHERE FALSE") {
    return scope;
  }
  const clause = ACTIVE_BASELINE_CLIENT_SQL.trim();
  if (!scope.whereSql) {
    return { whereSql: `WHERE ${clause}`, params: scope.params };
  }
  const inner = scope.whereSql.replace(/^WHERE\s+/, "");
  return {
    whereSql: `WHERE (${inner}) AND (${clause})`,
    params: scope.params,
  };
}
