import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import {
  v3EntityAssignmentScope,
  v3HoldingVisibilityScope,
  type V3ScopeSql,
} from "./access-scope";
import type { V3ListEntity } from "./list";

export type V3FilterOptions = {
  managers: Array<{ guid: string; name: string; count: number }>;
  types: Array<{ guid: string; name: string; count: number }>;
  categories: Array<{ guid: string; name: string; count: number }>;
};

function scopeForEntity(context: AccessContext, entity: V3ListEntity, alias: string): V3ScopeSql {
  if (entity === "holdings") {
    return v3HoldingVisibilityScope(context, alias);
  }
  const kind = entity === "legal" ? "legal" : "retail";
  return v3EntityAssignmentScope(context, alias, kind);
}

async function loadDistinctFromTable(
  table: string,
  alias: string,
  scope: V3ScopeSql,
  orphanOnly: boolean,
): Promise<{ managers: V3FilterOptions["managers"]; types: V3FilterOptions["types"]; categories: V3FilterOptions["categories"] }> {
  const orphanSql = orphanOnly ? ` AND ${alias}.guid_holding IS NULL` : "";
  const baseWhere = `(${scope.clause})${orphanSql}`;
  const managers = await query<{ guid: string; name: string; count: string }>(
    `
      SELECT
        LOWER(TRIM(${alias}.managers->>'guidManager')) AS guid,
        MAX(COALESCE(${alias}.managers->>'nameManager', '')) AS name,
        COUNT(*)::text AS count
      FROM ${table} AS ${alias}
      WHERE ${baseWhere}
        AND NULLIF(TRIM(${alias}.managers->>'guidManager'), '') IS NOT NULL
      GROUP BY 1
      ORDER BY name ASC
    `,
    scope.params,
  );
  const types = await query<{ guid: string; name: string; count: string }>(
    `
      SELECT
        ${alias}.type_category->>'guid_type' AS guid,
        MAX(COALESCE(${alias}.type_category->>'name_type', '')) AS name,
        COUNT(*)::text AS count
      FROM ${table} AS ${alias}
      WHERE ${baseWhere}
        AND NULLIF(TRIM(${alias}.type_category->>'guid_type'), '') IS NOT NULL
      GROUP BY 1
      ORDER BY name ASC
    `,
    scope.params,
  );
  const categories = await query<{ guid: string; name: string; count: string }>(
    `
      SELECT
        ${alias}.type_category->>'guid_category' AS guid,
        MAX(COALESCE(${alias}.type_category->>'name_category', '')) AS name,
        COUNT(*)::text AS count
      FROM ${table} AS ${alias}
      WHERE ${baseWhere}
        AND NULLIF(TRIM(${alias}.type_category->>'guid_category'), '') IS NOT NULL
      GROUP BY 1
      ORDER BY name ASC
    `,
    scope.params,
  );
  return {
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
  };
}

export async function loadV3FilterOptions(
  context: AccessContext,
  entity: V3ListEntity,
): Promise<V3FilterOptions> {
  if (entity === "holdings") {
    const scope = scopeForEntity(context, entity, "h");
    return loadDistinctFromTable("onec_v3_holdings", "h", scope, false);
  }
  if (entity === "legal") {
    const scope = scopeForEntity(context, entity, "le");
    return loadDistinctFromTable("onec_v3_legal_entities", "le", scope, false);
  }
  const scope = scopeForEntity(context, entity, "ro");
  return loadDistinctFromTable("onec_v3_retail_outlets", "ro", scope, entity === "orphan_retail");
}
