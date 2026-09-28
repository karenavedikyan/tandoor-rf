import type { SqlFilter } from "../clients/query";
import type { ClientScopeSql } from "./types";

export function combineScopeAndFilter(
  scope: ClientScopeSql,
  filter: SqlFilter,
): SqlFilter {
  if (scope.whereSql === "WHERE FALSE") {
    return { whereSql: "WHERE FALSE", params: [] };
  }

  const scopeClause = scope.whereSql
    ? scope.whereSql.replace(/^WHERE\s+/, "")
    : "TRUE";
  const filterClause = filter.whereSql
    ? filter.whereSql.replace(/^WHERE\s+/, "")
    : "TRUE";

  if (scopeClause === "TRUE" && filterClause === "TRUE") {
    return { whereSql: "", params: [] };
  }
  if (scopeClause === "TRUE") {
    return filter;
  }
  if (filterClause === "TRUE") {
    return { whereSql: scope.whereSql, params: scope.params };
  }

  const offset = scope.params.length;
  const rebasedFilter = filterClause.replace(
    /\$(\d+)/g,
    (_match, index) => `$${Number(index) + offset}`,
  );

  return {
    whereSql: `WHERE (${scopeClause}) AND (${rebasedFilter})`,
    params: [...scope.params, ...filter.params],
  };
}
