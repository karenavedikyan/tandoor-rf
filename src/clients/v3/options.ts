import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import {
  v3EntityAssignmentScope,
  v3HoldingVisibilityScope,
  type V3ScopeSql,
} from "./access-scope";
import type { V3ListEntity } from "./list";
import { appendAssignmentFilters, type V3ListQuery } from "./list";
import { groupedTopTypeExpressions, readableGroupKey } from "./list-legal-grouped";
import {
  v3CategoryGuidSql,
  v3CategoryNameSql,
  v3JsonManagerField,
  v3TypeGuidSql,
  v3TypeNameSql,
} from "./json-paths";
import { LEGAL_CITY_SQL, RETAIL_CITY_SQL } from "./list-sql-expressions";

export type V3FilterOptions = {
  managers: Array<{ guid: string; name: string; count: number }>;
  types: Array<{ guid: string; name: string; count: number }>;
  categories: Array<{ guid: string; name: string; count: number }>;
  cities: Array<{ value: string; count: number }>;
  staff: Record<string, Array<{ guid: string; name: string; count: number }>>;
};

function scopeForEntity(context: AccessContext, entity: V3ListEntity, alias: string): V3ScopeSql {
  if (entity === "holdings") {
    return v3HoldingVisibilityScope(context, alias);
  }
  const kind = entity === "legal" || entity === "legal_grouped" ? "legal" : "retail";
  return v3EntityAssignmentScope(context, alias, kind);
}

async function loadDistinctFromTable(
  table: string,
  alias: string,
  scope: V3ScopeSql,
  orphanOnly: boolean,
  territory?: Partial<V3ListQuery>,
): Promise<{
  managers: V3FilterOptions["managers"];
  types: V3FilterOptions["types"];
  categories: V3FilterOptions["categories"];
  cities: V3FilterOptions["cities"];
  staff: V3FilterOptions["staff"];
}> {
  const orphanSql = orphanOnly ? ` AND ${alias}.guid_holding IS NULL` : "";
  const params = [...scope.params];
  const territorySql = alias === "h" ? "" : appendAssignmentFilters({ entity: alias === "le" ? "legal" : "retail", page: 1, pageSize: 1, q: "", ...territory }, alias, params);
  scope = { ...scope, params };
  const baseWhere = `(${scope.clause})${orphanSql}${territorySql}`;
  const managers = await query<{ guid: string; name: string; count: string }>(
    `
      SELECT
        LOWER(TRIM(${v3JsonManagerField(alias, "guidManager")})) AS guid,
        MAX(COALESCE(${v3JsonManagerField(alias, "nameManager")}, '')) AS name,
        COUNT(*)::text AS count
      FROM ${table} AS ${alias}
      WHERE ${baseWhere}
        AND NULLIF(TRIM(${v3JsonManagerField(alias, "guidManager")}), '') IS NOT NULL
      GROUP BY 1
      ORDER BY name ASC
    `,
    scope.params,
  );
  const types = await query<{ guid: string; name: string; count: string }>(
    `
      SELECT
        ${v3TypeGuidSql(alias)} AS guid,
        MAX(COALESCE(${v3TypeNameSql(alias)}, '')) AS name,
        COUNT(*)::text AS count
      FROM ${table} AS ${alias}
      WHERE ${baseWhere}
        AND NULLIF(TRIM(${v3TypeGuidSql(alias)}), '') IS NOT NULL
      GROUP BY 1
      ORDER BY name ASC
    `,
    scope.params,
  );
  const categories = await query<{ guid: string; name: string; count: string }>(
    `
      SELECT
        ${v3CategoryGuidSql(alias)} AS guid,
        MAX(COALESCE(${v3CategoryNameSql(alias)}, '')) AS name,
        COUNT(*)::text AS count
      FROM ${table} AS ${alias}
      WHERE ${baseWhere}
        AND NULLIF(TRIM(${v3CategoryGuidSql(alias)}), '') IS NOT NULL
      GROUP BY 1
      ORDER BY name ASC
    `,
    scope.params,
  );
  let cities: { rows: Array<{ value: string; count: string }> } = { rows: [] };
  if (alias === "le" || alias === "ro") {
    const cityExpression = alias === "le" ? LEGAL_CITY_SQL : RETAIL_CITY_SQL;
    cities = await query<{ value: string; count: string }>(
      `
        SELECT ${cityExpression} AS value, COUNT(*)::text AS count
        FROM ${table} AS ${alias}
        WHERE ${baseWhere}
          AND ${cityExpression} IS NOT NULL
        GROUP BY 1
        ORDER BY value ASC
        LIMIT 80
      `,
      scope.params,
    );
  }
  const staff: V3FilterOptions["staff"] = {};
  const staffFields = [
    ["managerGuid", "guidManager", "nameManager"],
    ["regionalGuid", "guidRegionalManager", "nameRegionalManager"],
    ["hardwareGuid", "guidHardwareManager", "nameHardwareManager"],
    ["ropGuid", "guidHeadOfSales", "nameHeadOfSales"],
  ] as const;
  for (const [id, guidKey, nameKey] of staffFields) {
    const rows = await query<{ guid: string; name: string; count: string }>(
      `SELECT LOWER(TRIM(${v3JsonManagerField(alias, guidKey)})) AS guid,
       MAX(COALESCE(${v3JsonManagerField(alias, nameKey)}, '')) AS name, COUNT(*)::text AS count
       FROM ${table} AS ${alias} WHERE ${baseWhere}
       AND NULLIF(TRIM(${v3JsonManagerField(alias, guidKey)}), '') IS NOT NULL GROUP BY 1 ORDER BY name`,
      params,
    );
    staff[id] = rows.rows.map(r => ({ guid:r.guid, name:r.name || r.guid, count:Number(r.count) }));
  }
  return {
    staff,
    managers: managers.rows.map((r) => ({
      guid: r.guid,
      name: r.name || r.guid.slice(0, 8),
      count: Number(r.count),
    })),
    types: types.rows.map((r) => ({
      guid: r.guid,
      name: r.name || r.guid.slice(0, 8),
      count: Number(r.count),
    })),
    categories: categories.rows.map((r) => ({
      guid: r.guid,
      name: r.name || r.guid.slice(0, 8),
      count: Number(r.count),
    })),
    cities: cities.rows.map((r) => ({
      value: r.value,
      count: Number(r.count),
    })),
  };
}

export async function loadV3FilterOptions(
  context: AccessContext,
  entity: V3ListEntity,
  territory?: Partial<V3ListQuery>,
): Promise<V3FilterOptions> {
  if (entity === "holdings") {
    const scope = scopeForEntity(context, entity, "h");
    return loadDistinctFromTable("onec_v3_holdings", "h", scope, false);
  }
  if (entity === "legal" || entity === "legal_grouped") {
    const scope = scopeForEntity(context, "legal", "le");
    const result = await loadDistinctFromTable("onec_v3_legal_entities", "le", scope, false, territory);
    if (entity === "legal_grouped") {
      const params = [...scope.params];
      const territorySql = appendAssignmentFilters({ entity, page: 1, pageSize: 1, q: "", ...territory }, "le", params);
      const topType = groupedTopTypeExpressions(context, "le", params);
      const groupKey = readableGroupKey(context, params);
      const rows = await query<{ guid: string; name: string; count: string }>(
        `WITH readable AS (
          SELECT ${groupKey} AS group_key, ${topType.guid} AS guid, ${topType.name} AS name
          FROM onec_v3_legal_entities le WHERE (${scope.clause})${territorySql}
        )
        SELECT guid, MAX(name) AS name, COUNT(DISTINCT group_key)::text AS count FROM readable
        WHERE NULLIF(TRIM(guid), '') IS NOT NULL GROUP BY guid ORDER BY name`,
        params,
      );
      result.types = rows.rows.map((row) => ({
        guid: row.guid,
        name: row.name || row.guid,
        count: Number(row.count),
      }));
    }
    return result;
  }
  const scope = scopeForEntity(context, entity, "ro");
  return loadDistinctFromTable("onec_v3_retail_outlets", "ro", scope, entity === "orphan_retail", territory);
}
