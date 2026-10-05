import { mergeSqlFilters } from "../../access/combine-filters";
import { appendUserDenials, buildClientScopeSql } from "../../access/scope-sql";
import type { AccessContext } from "../../access/types";
import { query } from "../../db/pool";
import { ACTIVE_BASELINE_OC_SQL } from "../../onec-clients/baseline-active-scope";
import type { RetailOutletsListResponse } from "../dto";
import type { ClientsListQuery } from "../query";
import { buildClientsFilter } from "../query";
import { shortUuidLabel } from "../uuid-param";

type CountRow = { count: string };

type OutletRow = {
  guid_store: string;
  guid_client: string;
  client_name: string;
  is_closed: boolean;
  store_address: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
};

const OUTLETS_JSON_ARRAY = `
  CASE
    WHEN jsonb_typeof(oc.extended_snapshot->'currentRetailOutlets') = 'array'
      THEN oc.extended_snapshot->'currentRetailOutlets'
    ELSE '[]'::jsonb
  END
`;

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
        FROM jsonb_array_elements(${OUTLETS_JSON_ARRAY}) outlet
        WHERE lower(coalesce(outlet->>'guidStore', '')) = lower(ro.guid_store::text)
          AND lower(coalesce(outlet->'managers'->'regionalManager'->>'guid', '')) = lower($2::text)
      )
      AND ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
    `,
    params: [context.userId, context.employeeId],
  };

  return appendOcUserDenials(base, context.userId);
}

function buildOutletScope(context: AccessContext): { whereSql: string; params: unknown[] } {
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
  const innerSql = clientScope.whereSql.replace(/^WHERE onec_clients\.guid_client IN \(/, "").replace(/\)$/, "");
  return {
    whereSql: `
      WHERE ro.guid_client IN (${innerSql})
        AND ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
    `,
    params: clientScope.params,
  };
}

function outletAddressFromSnapshot(storeAddress: string | null, fallback: string): string {
  const trimmed = (storeAddress ?? "").trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return fallback.trim();
}

export async function listRetailOutlets(
  context: AccessContext,
  input: ClientsListQuery,
): Promise<RetailOutletsListResponse> {
  if (input.view !== "all") {
    return {
      items: [],
      total: 0,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: 0,
      isEmptyDatabase: false,
    };
  }

  const outletScope = buildOutletScope(context);
  const userFilter = buildClientsFilter({ ...input, view: "all" });
  const filterClause = userFilter.whereSql
    ? userFilter.whereSql.replace(/^WHERE\s+/, "").replaceAll("onec_clients.", "oc.")
    : "";

  const combinedWhere = mergeSqlFilters(
    outletScope,
    filterClause ? [filterClause] : [],
    userFilter.params,
  );

  const fromSql = `
    FROM onec_retail_outlets ro
    JOIN onec_clients oc ON oc.guid_client = ro.guid_client
  `;

  const totalResult = await query<CountRow>(
    `SELECT COUNT(*)::text AS count ${fromSql} ${combinedWhere.whereSql}`,
    combinedWhere.params,
  );
  const total = Number(totalResult.rows[0]?.count ?? "0");
  const totalPages = total === 0 ? 0 : Math.ceil(total / input.pageSize);
  const offset = (input.page - 1) * input.pageSize;
  const listParams = [...combinedWhere.params, input.pageSize, offset];
  const limitParam = `$${combinedWhere.params.length + 1}`;
  const offsetParam = `$${combinedWhere.params.length + 2}`;

  const rows = await query<OutletRow>(
    `
      SELECT
        ro.guid_store::text,
        ro.guid_client::text,
        oc.name_client AS client_name,
        ro.is_closed,
        (
          SELECT outlet->'address'->>'storeAddress'
          FROM jsonb_array_elements(${OUTLETS_JSON_ARRAY}) outlet
          WHERE lower(coalesce(outlet->>'guidStore', '')) = lower(ro.guid_store::text)
          LIMIT 1
        ) AS store_address,
        oc.name_holding,
        oc.guid_manager::text,
        oc.name_manager
      ${fromSql}
      ${combinedWhere.whereSql}
      ORDER BY oc.name_client ASC, ro.guid_store ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    listParams,
  );

  return {
    items: rows.rows.map((row) => ({
      guidStore: row.guid_store,
      guidClient: row.guid_client,
      clientName: row.client_name,
      outletLabel: outletAddressFromSnapshot(row.store_address, row.guid_store),
      address: outletAddressFromSnapshot(row.store_address, ""),
      isClosed: row.is_closed,
      closureStatusLabel: row.is_closed ? "Закрыта" : "Открыта",
      holdingName: row.name_holding,
      manager: {
        id: row.guid_manager,
        name: row.name_manager,
        shortId: shortUuidLabel(row.guid_manager),
      },
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages,
    isEmptyDatabase: false,
  };
}
