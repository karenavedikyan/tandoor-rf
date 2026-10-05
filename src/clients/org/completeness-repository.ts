import { combineScopeAndFilter } from "../../access/combine-filters";
import { buildClientScopeSql } from "../../access/scope-sql";
import type { AccessContext } from "../../access/types";
import { query } from "../../db/pool";
import { ACTIVE_BASELINE_OC_SQL } from "../../onec-clients/baseline-active-scope";
import { formatMskDateTime } from "../dto";
import type { SqlFilter } from "../query";
import { mergeFilterClauses } from "../query";
import {
  clientHeadOfSalesGuidSql,
  clientHeadOfSalesNameSql,
  outletHeadOfSalesGuidSql,
  outletManagerGuidSql,
  outletRegionalGuidSql,
  RETAIL_OUTLETS_JSON,
} from "./assignment-sql";
import { ORG_DIRECTOR_EMPLOYEE_GUID } from "./constants";
import {
  COMPLETENESS_REASON_LABELS,
  type CompletenessQueueItem,
  type CompletenessReason,
} from "./completeness-reasons";

export type CompletenessQueueQuery = {
  q: string;
  reasons: CompletenessReason[];
  reasonMode: "any" | "all";
  entityKind?: "client" | "outlet";
  ropEmployeeGuid?: string;
  managerId?: string;
  reviewState?: string;
  page: number;
  pageSize: number;
};

export type CompletenessQueueResponse = {
  items: CompletenessQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    clients: number;
    outlets: number;
    records: number;
  };
};

function assertCompletenessAccess(context: AccessContext): void {
  if (context.role === "admin" || context.fullClientBase) {
    return;
  }
  throw new CompletenessAccessError("Очередь незаполненных назначений недоступна для вашей роли.", "FORBIDDEN");
}

export class CompletenessAccessError extends Error {
  code: "FORBIDDEN";

  constructor(message: string, code: "FORBIDDEN") {
    super(message);
    this.code = code;
  }
}

function clientReasonsSql(clientAlias = "oc"): string {
  const headGuid = clientHeadOfSalesGuidSql(clientAlias);
  const headState = `${clientAlias}.extended_snapshot->'headOfSales'->>'state'`;
  const mgrState = `${clientAlias}.manager_roster_state`;
  return `
    ARRAY_REMOVE(ARRAY[
      CASE
        WHEN ${headGuid} IS NULL
          OR ${headState} IN ('unassigned', 'not_provided', 'invalid')
        THEN 'missing_rop'
      END,
      CASE
        WHEN ${clientAlias}.guid_manager IS NULL
          OR NULLIF(BTRIM(lower(${clientAlias}.guid_manager::text)), '') IS NULL
          OR NULLIF(BTRIM(lower(${clientAlias}.guid_manager::text)), '00000000-0000-0000-0000-000000000000') IS NULL
        THEN 'missing_manager'
      END,
      CASE
        WHEN ${mgrState} = 'outside_wholesale_roster'
          OR ${headState} = 'outside_wholesale_roster'
        THEN 'responsible_outside_roster'
      END,
      CASE
        WHEN ${headState} = 'invalid'
          OR ${clientAlias}.extended_snapshot->'headOfSales'->>'state' = 'invalid'
        THEN 'invalid_or_conflicting_assignment'
      END,
      CASE
        WHEN ${headGuid} = $director_guid$
          OR lower(COALESCE(${clientAlias}.guid_head_sales::text, '')) = $director_guid$
        THEN 'org_role_conflict'
      END,
      CASE
        WHEN ${headState} = 'not_provided'
          OR (${clientAlias}.extended_snapshot IS NULL AND ${clientAlias}.guid_head_sales IS NULL)
        THEN 'field_not_provided'
      END,
      CASE
        WHEN ${clientAlias}.extended_freshness_state IN ('preserved_from_previous', 'not_provided_in_snapshot')
        THEN 'data_stale'
      END,
      CASE
        WHEN ${mgrState} = 'roster_not_loaded'
        THEN 'roster_unavailable'
      END
    ], NULL)::text[]
  `.replaceAll("$director_guid$", `'${ORG_DIRECTOR_EMPLOYEE_GUID}'`);
}

function outletReasonsSql(): string {
  return `
    ARRAY_REMOVE(ARRAY[
      CASE
        WHEN ${outletHeadOfSalesGuidSql("outlet.elem")} IS NULL
          OR outlet.elem->'managers'->'headOfSales'->>'state' IN ('unassigned', 'not_provided', 'invalid')
        THEN 'missing_rop'
      END,
      CASE
        WHEN ${outletManagerGuidSql("outlet.elem")} IS NULL
          OR outlet.elem->'managers'->'manager'->>'state' IN ('unassigned', 'not_provided', 'invalid')
        THEN 'missing_manager'
      END,
      CASE
        WHEN ${outletRegionalGuidSql("outlet.elem")} IS NULL
          AND outlet.elem->'managers'->'regionalManager'->>'state' IN ('unassigned', 'not_provided')
        THEN 'missing_regional'
      END,
      CASE
        WHEN outlet.elem->'managers'->'manager'->>'state' = 'outside_wholesale_roster'
          OR outlet.elem->'managers'->'headOfSales'->>'state' = 'outside_wholesale_roster'
        THEN 'responsible_outside_roster'
      END,
      CASE
        WHEN outlet.elem->'managers'->'manager'->>'state' = 'invalid'
          OR outlet.elem->'managers'->'headOfSales'->>'state' = 'invalid'
        THEN 'invalid_or_conflicting_assignment'
      END,
      CASE
        WHEN ${outletHeadOfSalesGuidSql("outlet.elem")} = '${ORG_DIRECTOR_EMPLOYEE_GUID}'
        THEN 'org_role_conflict'
      END,
      CASE
        WHEN outlet.elem->'managers'->'headOfSales'->>'state' = 'not_provided'
        THEN 'field_not_provided'
      END,
      CASE
        WHEN outlet.elem->'provenance'->>'freshness' IN ('preserved_from_previous', 'not_provided_in_snapshot')
        THEN 'data_stale'
      END
    ], NULL)::text[]
  `;
}

function buildCompletenessScopeFilter(context: AccessContext): SqlFilter {
  const scope = buildClientScopeSql(context);
  return combineScopeAndFilter(scope, { whereSql: "", params: [] });
}

function buildReasonFilter(query: CompletenessQueueQuery, paramOffset: number): { sql: string; params: unknown[] } {
  if (query.reasons.length === 0) {
    return { sql: "cardinality(reasons) > 0", params: [] };
  }
  const params = [query.reasons];
  if (query.reasonMode === "all") {
    return {
      sql: `reasons @> $${paramOffset}::text[]`,
      params,
    };
  }
  return {
    sql: `reasons && $${paramOffset}::text[]`,
    params,
  };
}

export async function listCompletenessQueue(
  context: AccessContext,
  input: CompletenessQueueQuery,
): Promise<CompletenessQueueResponse> {
  assertCompletenessAccess(context);
  const scopeFilter = buildCompletenessScopeFilter(context);
  const scopeWhere = scopeFilter.whereSql ? scopeFilter.whereSql.replace(/^WHERE\s+/, "") : "TRUE";
  const baseParams = [...scopeFilter.params];

  const searchClauses: string[] = [];
  const searchParams: unknown[] = [];
  if (input.q.trim().length > 0) {
    searchParams.push(`%${input.q.trim()}%`);
    const p = `$${baseParams.length + searchParams.length}`;
    searchClauses.push(
      `(name ILIKE ${p} OR address ILIKE ${p} OR parent_client_name ILIKE ${p} OR guid_client::text ILIKE ${p} OR COALESCE(guid_store::text, '') ILIKE ${p})`,
    );
  }

  let branchClause = "";
  const branchParams: unknown[] = [];
  if (input.ropEmployeeGuid) {
    branchParams.push(input.ropEmployeeGuid.toLowerCase());
    const p = `$${baseParams.length + searchParams.length + branchParams.length}`;
    branchClause = `rop_guid = lower(${p}::text)`;
  }
  if (input.managerId) {
    branchParams.push(input.managerId.toLowerCase());
    const p = `$${baseParams.length + searchParams.length + branchParams.length}`;
    branchClause = branchClause
      ? `${branchClause} AND manager_guid = lower(${p}::text)`
      : `manager_guid = lower(${p}::text)`;
  }

  const entityClause =
    input.entityKind === "client"
      ? "entity_kind = 'client'"
      : input.entityKind === "outlet"
        ? "entity_kind = 'outlet'"
        : "";

  const innerSql = `
    WITH scoped_clients AS (
      SELECT oc.*
      FROM onec_clients oc
      WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
        AND (${scopeWhere.replaceAll("onec_clients.", "oc.")})
    ),
    client_items AS (
      SELECT
        'client'::text AS entity_kind,
        oc.guid_client,
        NULL::uuid AS guid_store,
        oc.name_client AS name,
        oc.address,
        NULL::text AS parent_client_name,
        ${clientHeadOfSalesGuidSql("oc")} AS rop_guid,
        ${clientHeadOfSalesNameSql("oc")} AS rop_name,
        lower(oc.guid_manager::text) AS manager_guid,
        oc.name_manager AS manager_name,
        NULLIF(BTRIM(lower(oc.extended_snapshot->'regionalManager'->>'guid')), '') AS regional_guid,
        NULLIF(BTRIM(oc.extended_snapshot->'regionalManager'->>'name'), '') AS regional_name,
        oc.last_imported_at,
        crr.review_state,
        ${clientReasonsSql("oc")} AS reasons
      FROM scoped_clients oc
      LEFT JOIN client_review_records crr ON crr.guid_client = oc.guid_client
    ),
    outlet_items AS (
      SELECT
        'outlet'::text AS entity_kind,
        oc.guid_client,
        ro.guid_store,
        COALESCE(
          NULLIF(BTRIM(outlet.elem->'address'->>'storeAddress'), ''),
          NULLIF(BTRIM(outlet.elem->>'holdingName'), ''),
          ro.guid_store::text
        ) AS name,
        COALESCE(NULLIF(BTRIM(outlet.elem->'address'->>'storeAddress'), ''), '') AS address,
        oc.name_client AS parent_client_name,
        ${outletHeadOfSalesGuidSql("outlet.elem")} AS rop_guid,
        NULLIF(BTRIM(outlet.elem->'managers'->'headOfSales'->>'name'), '') AS rop_name,
        ${outletManagerGuidSql("outlet.elem")} AS manager_guid,
        NULLIF(BTRIM(outlet.elem->'managers'->'manager'->>'name'), '') AS manager_name,
        ${outletRegionalGuidSql("outlet.elem")} AS regional_guid,
        NULLIF(BTRIM(outlet.elem->'managers'->'regionalManager'->>'name'), '') AS regional_name,
        oc.last_imported_at,
        crr.review_state,
        ${outletReasonsSql()} AS reasons
      FROM scoped_clients oc
      JOIN onec_retail_outlets ro ON ro.guid_client = oc.guid_client
      CROSS JOIN LATERAL jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc")}) outlet(elem)
      LEFT JOIN client_review_records crr ON crr.guid_client = oc.guid_client
      WHERE lower(COALESCE(outlet.elem->>'guidStore', '')) = lower(ro.guid_store::text)
    ),
    merged AS (
      SELECT * FROM client_items
      UNION ALL
      SELECT * FROM outlet_items
    )
    SELECT * FROM merged
  `;

  const reasonFilter = buildReasonFilter(input, baseParams.length + searchParams.length + branchParams.length + 1);
  const whereParts = [reasonFilter.sql, ...searchClauses, branchClause, entityClause].filter(Boolean);
  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const allParams = [...baseParams, ...searchParams, ...branchParams, ...reasonFilter.params];
  const offset = (input.page - 1) * input.pageSize;

  const countResult = await query<{ count: string; client_count: string; outlet_count: string }>(
    `
      SELECT
        COUNT(*)::text AS count,
        COUNT(*) FILTER (WHERE entity_kind = 'client')::text AS client_count,
        COUNT(*) FILTER (WHERE entity_kind = 'outlet')::text AS outlet_count
      FROM (${innerSql}) queue
      ${whereSql}
    `,
    allParams,
  );

  const total = Number(countResult.rows[0]?.count ?? "0");
  const listResult = await query<{
    entity_kind: "client" | "outlet";
    guid_client: string;
    guid_store: string | null;
    name: string;
    address: string;
    parent_client_name: string | null;
    rop_guid: string | null;
    rop_name: string | null;
    manager_guid: string | null;
    manager_name: string | null;
    regional_guid: string | null;
    regional_name: string | null;
    last_imported_at: Date | null;
    review_state: string | null;
    reasons: string[];
  }>(
    `
      SELECT *
      FROM (${innerSql}) queue
      ${whereSql}
      ORDER BY entity_kind ASC, name ASC NULLS LAST, guid_client ASC, guid_store ASC NULLS LAST
      LIMIT $${allParams.length + 1} OFFSET $${allParams.length + 2}
    `,
    [...allParams, input.pageSize, offset],
  );

  const linkedResult = await query<{ employee_id: string }>(
    `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
  );
  const linked = new Set(linkedResult.rows.map((row) => row.employee_id.toLowerCase()));

  const items: CompletenessQueueItem[] = listResult.rows.map((row) => {
    const reasons = row.reasons.filter((r): r is CompletenessReason =>
      (Object.keys(COMPLETENESS_REASON_LABELS) as CompletenessReason[]).includes(r as CompletenessReason),
    );
    const assigneeGuid = row.manager_guid ?? row.regional_guid ?? row.rop_guid;
    return {
      entityKind: row.entity_kind,
      guidClient: row.guid_client,
      guidStore: row.guid_store,
      name: row.name,
      address: row.address,
      parentClientName: row.parent_client_name,
      knownAssignees: {
        rop: { guid: row.rop_guid, name: row.rop_name },
        manager: { guid: row.manager_guid, name: row.manager_name },
        regional: { guid: row.regional_guid, name: row.regional_name },
      },
      reasons,
      reasonLabels: reasons.map((r) => COMPLETENESS_REASON_LABELS[r]),
      lastImportedAt: row.last_imported_at?.toISOString() ?? null,
      lastImportedAtLabel: row.last_imported_at ? formatMskDateTime(row.last_imported_at) : null,
      reviewState: row.review_state,
      reviewStateLabel: row.review_state,
      hasLinkedAccount: assigneeGuid ? linked.has(assigneeGuid.toLowerCase()) : null,
    };
  });

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
    summary: {
      clients: Number(countResult.rows[0]?.client_count ?? "0"),
      outlets: Number(countResult.rows[0]?.outlet_count ?? "0"),
      records: total,
    },
  };
}

export function buildCompletenessReasonsFilter(
  reasons: CompletenessReason[],
  mode: "any" | "all",
  entityAlias = "onec_clients",
): SqlFilter {
  if (reasons.length === 0) {
    return { whereSql: "", params: [] };
  }
  const reasonChecks = reasons.map((reason) => {
    switch (reason) {
      case "missing_rop":
        return `${clientHeadOfSalesGuidSql(entityAlias)} IS NULL`;
      case "missing_manager":
        return `NULLIF(BTRIM(lower(${entityAlias}.guid_manager::text)), '00000000-0000-0000-0000-000000000000') IS NULL`;
      case "responsible_outside_roster":
        return `${entityAlias}.manager_roster_state = 'outside_wholesale_roster'`;
      default:
        return "FALSE";
    }
  });
  const joined = mode === "all" ? reasonChecks.map((c) => `(${c})`).join(" AND ") : reasonChecks.map((c) => `(${c})`).join(" OR ");
  return {
    whereSql: `WHERE (${joined})`,
    params: [],
  };
}

export { mergeFilterClauses };
