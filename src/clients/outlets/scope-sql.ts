import { appendUserDenials, buildClientScopeSql } from "../../access/scope-sql";
import type { AccessContext } from "../../access/types";
import { ACTIVE_BASELINE_OC_SQL } from "../../onec-clients/baseline-active-scope";

export function outletsJsonArraySql(clientAlias: string): string {
  return `
    CASE
      WHEN jsonb_typeof(${clientAlias}.extended_snapshot->'currentRetailOutlets') = 'array'
        THEN ${clientAlias}.extended_snapshot->'currentRetailOutlets'
      ELSE '[]'::jsonb
    END
  `;
}

export function outletSnapshotSubquery(storeAlias: string, clientAlias: string): string {
  return `
    (
      SELECT outlet
      FROM jsonb_array_elements(${outletsJsonArraySql(clientAlias)}) outlet
      WHERE lower(coalesce(outlet->>'guidStore', '')) = lower(${storeAlias}.guid_store::text)
      LIMIT 1
    )
  `;
}

export function outletStoreAddressSql(storeAlias: string, clientAlias: string): string {
  return `(
    SELECT NULLIF(BTRIM(outlet->'address'->>'storeAddress'), '')
    FROM jsonb_array_elements(${outletsJsonArraySql(clientAlias)}) outlet
    WHERE lower(coalesce(outlet->>'guidStore', '')) = lower(${storeAlias}.guid_store::text)
    LIMIT 1
  )`;
}

function appendOcUserDenials(
  scope: { whereSql: string; params: unknown[] },
  userId: string,
): { whereSql: string; params: unknown[] } {
  if (scope.whereSql === "WHERE FALSE") {
    return scope;
  }

  const userParam = scope.params.length + 1;
  const denialClause = `NOT EXISTS (
    SELECT 1
    FROM access_denials ad
    WHERE ad.user_id = $${userParam}::uuid
      AND ad.revoked_at IS NULL
      AND (
        ad.scope_type = 'all_clients'
        OR ad.object_id = oc.guid_client
      )
  )`;

  if (!scope.whereSql) {
    return {
      whereSql: `WHERE ${denialClause}`,
      params: [...scope.params, userId],
    };
  }

  const scopeClause = scope.whereSql.trim().replace(/^WHERE\s+/i, "");
  return {
    whereSql: `WHERE (${scopeClause}) AND (${denialClause})`,
    params: [...scope.params, userId],
  };
}

function buildRegionalOutletScope(context: AccessContext): { whereSql: string; params: unknown[] } {
  if (!context.employeeId) {
    return { whereSql: "WHERE FALSE", params: [] };
  }

  const base = {
    whereSql: `
      WHERE EXISTS (
        SELECT 1
        FROM access_grants g
        WHERE g.user_id = $1::uuid
          AND g.grant_type = 'client'
          AND g.object_id = oc.guid_client
          AND g.revoked_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${outletsJsonArraySql("oc")}) outlet
        WHERE lower(coalesce(outlet->>'guidStore', '')) = lower(ro.guid_store::text)
          AND lower(coalesce(outlet->'managers'->'regionalManager'->>'guid', '')) = lower($2::text)
      )
      AND ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
    `,
    params: [context.userId, context.employeeId],
  };

  return appendOcUserDenials(base, context.userId);
}

export function buildOutletScope(context: AccessContext): { whereSql: string; params: unknown[] } {
  if (context.fullClientBase) {
    const scope = appendUserDenials({ whereSql: "", params: [] }, context.userId);
    if (!scope.whereSql) {
      return {
        whereSql: `WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}`,
        params: [],
      };
    }
    const clause = scope.whereSql.replace(/^WHERE\s+/, "").replaceAll("onec_clients.", "oc.");
    return {
      whereSql: `WHERE (${clause}) AND ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}`,
      params: scope.params,
    };
  }

  if (context.role === "regional_manager") {
    return buildRegionalOutletScope(context);
  }

  const clientScope = buildClientScopeSql(context);
  if (clientScope.whereSql === "WHERE FALSE") {
    return clientScope;
  }

  const scopeClause = clientScope.whereSql
    ? clientScope.whereSql.replace(/^WHERE\s+/, "").replaceAll("onec_clients.", "oc_scope.")
    : "TRUE";

  const base = {
    whereSql: `
      WHERE EXISTS (
        SELECT 1
        FROM onec_clients oc_scope
        WHERE oc_scope.guid_client = ro.guid_client
          AND (${scopeClause})
      )
      AND ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
    `,
    params: clientScope.params,
  };

  return appendOcUserDenials(base, context.userId);
}

function scopedOutletRowAccessibleSql(
  context: AccessContext,
  storeAlias: string,
  clientAlias: string,
  regionalEmployeeParam?: string,
): string {
  if (context.role === "regional_manager" && context.employeeId && regionalEmployeeParam) {
    return `
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${outletsJsonArraySql(clientAlias)}) outlet
        WHERE lower(coalesce(outlet->>'guidStore', '')) = lower(${storeAlias}.guid_store::text)
          AND lower(coalesce(outlet->'managers'->'regionalManager'->>'guid', '')) = lower(${regionalEmployeeParam})
      )
    `;
  }

  return "TRUE";
}

export function scopedOutletsCountSql(
  context: AccessContext,
  clientAlias = "onec_clients",
  regionalEmployeeParam?: string,
): string {
  const storeAlias = "oro_scope";
  const accessible = scopedOutletRowAccessibleSql(context, storeAlias, clientAlias, regionalEmployeeParam);
  return `
    (
      SELECT COUNT(*)::int
      FROM onec_retail_outlets ${storeAlias}
      WHERE ${storeAlias}.guid_client = ${clientAlias}.guid_client
        AND (${accessible})
    )
  `;
}

export function scopedHasOutletsClause(
  context: AccessContext,
  mode: "yes" | "no",
  clientAlias = "onec_clients",
  regionalEmployeeParam?: string,
): string {
  const countSql = scopedOutletsCountSql(context, clientAlias, regionalEmployeeParam);
  if (mode === "yes") {
    return `${countSql} > 0`;
  }
  return `${countSql} = 0`;
}
