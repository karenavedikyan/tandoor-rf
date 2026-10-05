import type { SqlFilter } from "../clients/query";
import type { ClientScopeSql } from "./types";

export function rebaseSqlPlaceholders(clause: string, offset: number): string {
  if (offset <= 0) {
    return clause;
  }
  return clause.replace(/\$(\d+)/g, (_match, index) => `$${Number(index) + offset}`);
}

export function mergeSqlFilters(base: SqlFilter, extraClauses: string[], extraParams: unknown[]): SqlFilter {
  if (extraClauses.length === 0) {
    return base;
  }
  const offset = base.params.length;
  const rebasedClauses = extraClauses.map((clause) => rebaseSqlPlaceholders(clause, offset));
  const normalizedBase = base.whereSql.trim();
  const combinedClauses = [
    normalizedBase ? normalizedBase.replace(/^WHERE\s+/i, "") : "",
    ...rebasedClauses,
  ].filter(Boolean);
  return {
    whereSql: combinedClauses.length > 0 ? `WHERE ${combinedClauses.join(" AND ")}` : "",
    params: [...base.params, ...extraParams],
  };
}

export function intersectClientScopes(
  primary: ClientScopeSql,
  secondary: ClientScopeSql,
): ClientScopeSql {
  if (primary.whereSql === "WHERE FALSE" || secondary.whereSql === "WHERE FALSE") {
    return { whereSql: "WHERE FALSE", params: [] };
  }

  const primaryClause = primary.whereSql ? primary.whereSql.replace(/^WHERE\s+/, "") : "TRUE";
  const secondaryClause = secondary.whereSql ? secondary.whereSql.replace(/^WHERE\s+/, "") : "TRUE";

  if (primaryClause === "TRUE" && secondaryClause === "TRUE") {
    return { whereSql: "", params: [] };
  }
  if (primaryClause === "TRUE") {
    return secondary;
  }
  if (secondaryClause === "TRUE") {
    return primary;
  }

  const offset = primary.params.length;
  const rebasedSecondary = secondaryClause.replace(
    /\$(\d+)/g,
    (_match, index) => `$${Number(index) + offset}`,
  );

  return {
    whereSql: `WHERE (${primaryClause}) AND (${rebasedSecondary})`,
    params: [...primary.params, ...secondary.params],
  };
}

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
