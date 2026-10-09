import { appendSqlClauses, mergeSqlFilters, rebaseSqlPlaceholders } from "../access/combine-filters";
import { buildClientScopeSql } from "../access/scope-sql";
import type { AccessContext } from "../access/types";
import {
  HOLDING_COMPOSITION_SITE_LABELS,
  type HoldingCompositionSiteType,
} from "../onec-clients/holding-v2-composition";
import { buildOutletScope } from "./outlets/scope-sql";
import type { ClientsListQuery, SqlFilter } from "./query";

export const HOLDING_V2_COMPOSITION_FILTER_WITHHELD = "withheld" as const;

export const HOLDING_V2_COMPOSITION_FILTER_TOKENS = [
  "mono",
  "mono_network",
  "group",
  "group_network",
  "no_active_outlets",
  "unknown",
  HOLDING_V2_COMPOSITION_FILTER_WITHHELD,
] as const;

export type HoldingV2CompositionFilterToken = (typeof HOLDING_V2_COMPOSITION_FILTER_TOKENS)[number];

const WITHHELD_LABEL = "Скрыто по области доступа";

export function holdingV2CompositionFilterLabel(token: HoldingV2CompositionFilterToken): string {
  if (token === HOLDING_V2_COMPOSITION_FILTER_WITHHELD) {
    return WITHHELD_LABEL;
  }
  return HOLDING_COMPOSITION_SITE_LABELS[token as HoldingCompositionSiteType];
}

export function parseHoldingV2CompositionFilterToken(
  raw: string | undefined,
): HoldingV2CompositionFilterToken | undefined | null {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if ((HOLDING_V2_COMPOSITION_FILTER_TOKENS as readonly string[]).includes(raw)) {
    return raw as HoldingV2CompositionFilterToken;
  }
  return null;
}

function clientScopeClause(context: AccessContext, clientAlias: string): { clause: string; params: unknown[] } {
  const scope = buildClientScopeSql(context);
  if (scope.whereSql === "WHERE FALSE") {
    return { clause: "FALSE", params: [] };
  }
  return {
    clause: scope.whereSql.replace(/^WHERE\s+/i, "").replaceAll("onec_clients.", `${clientAlias}.`),
    params: scope.params,
  };
}

function outletScopeClause(context: AccessContext): { clause: string; params: unknown[] } {
  const outletScope = buildOutletScope(context);
  if (outletScope.whereSql === "WHERE FALSE") {
    return { clause: "FALSE", params: [] };
  }
  return {
    clause: outletScope.whereSql.replace(/^WHERE\s+/i, ""),
    params: outletScope.params,
  };
}

/** Scalar SQL subquery: visible composition token for one client row. */
export function holdingV2CompositionTokenSubquery(context: AccessContext, clientGuidExpr: string): {
  sql: string;
  params: unknown[];
} {
  const legalScope = clientScopeClause(context, "oc_l");
  const outletScope = outletScopeClause(context);

  const params = [...legalScope.params];
  let outletClauseForRoot = outletScope.clause;
  const sharedOutletParams =
    outletScope.params.length > 0 &&
    outletScope.params.length === legalScope.params.length &&
    outletScope.params.every((value, index) => value === legalScope.params[index]);
  if (outletScope.params.length > 0 && !sharedOutletParams) {
    outletClauseForRoot = rebaseSqlPlaceholders(outletScope.clause, legalScope.params.length);
    params.push(...outletScope.params);
  }

  const rootExpr = `(
    SELECT ll_root.guid_holding_root
    FROM onec_holding_v2_legal_links ll_root
    WHERE ll_root.guid_client = ${clientGuidExpr}
      AND ll_root.link_active = TRUE
    LIMIT 1
  )`;

  const legalTotal = `(SELECT COUNT(*)::bigint FROM onec_holding_v2_legal_links ll_all
    WHERE ll_all.guid_holding_root = ${rootExpr} AND ll_all.link_active = TRUE)`;

  const legalVisible = `(SELECT COUNT(*)::bigint FROM onec_holding_v2_legal_links ll_v
    INNER JOIN onec_clients oc_l ON oc_l.guid_client = ll_v.guid_client
    WHERE ll_v.guid_holding_root = ${rootExpr} AND ll_v.link_active = TRUE
      AND (${legalScope.clause}))`;

  const outletTotal = `(SELECT COUNT(*)::bigint FROM onec_holding_v2_outlet_links ol_all
    WHERE ol_all.guid_holding_root = ${rootExpr} AND ol_all.link_active = TRUE)`;

  const outletVisible = `(SELECT COUNT(*)::bigint FROM onec_holding_v2_outlet_links ol_v
    INNER JOIN onec_retail_outlets ro ON ro.guid_store = ol_v.guid_store
    INNER JOIN onec_clients oc ON oc.guid_client = ro.guid_client
    WHERE ol_v.guid_holding_root = ${rootExpr} AND ol_v.link_active = TRUE
      AND (${outletClauseForRoot}))`;

  const legalCount = `(SELECT COUNT(*)::int FROM onec_holding_v2_legal_links ll_c
    WHERE ll_c.guid_holding_root = ${rootExpr} AND ll_c.link_active = TRUE)`;

  const activeOutlets = `(SELECT COUNT(*)::int FROM onec_holding_v2_outlet_links ol_a
    WHERE ol_a.guid_holding_root = ${rootExpr} AND ol_a.link_active = TRUE
      AND ol_a.closure_known = TRUE AND ol_a.is_closed = FALSE)`;

  const unknownClosure = `(SELECT COUNT(*)::int FROM onec_holding_v2_outlet_links ol_u
    WHERE ol_u.guid_holding_root = ${rootExpr} AND ol_u.link_active = TRUE
      AND ol_u.closure_known = FALSE)`;

  const hasHead = `EXISTS (
    SELECT 1 FROM onec_holding_v2_legal_links ll_h
    WHERE ll_h.guid_holding_root = ${rootExpr}
      AND ll_h.guid_client = ${rootExpr}
      AND ll_h.link_active = TRUE
      AND ll_h.is_holding_head = TRUE
  )`;

  const sql = `
    SELECT CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM onec_holding_v2_apply_state st
        WHERE st.id = 1 AND st.last_normalized_state_sha256 IS NOT NULL
      ) THEN NULL
      WHEN ${rootExpr} IS NULL THEN 'unknown'
      WHEN ${legalTotal} > ${legalVisible}
        OR (${outletTotal} > 0 AND ${outletTotal} > ${outletVisible})
        THEN '${HOLDING_V2_COMPOSITION_FILTER_WITHHELD}'
      WHEN NOT ${hasHead} OR ${legalCount} <= 0 OR ${unknownClosure} > 0 THEN 'unknown'
      WHEN ${activeOutlets} <= 0 THEN 'no_active_outlets'
      WHEN ${legalCount} = 1 AND ${activeOutlets} = 1 THEN 'mono'
      WHEN ${legalCount} = 1 AND ${activeOutlets} > 1 THEN 'mono_network'
      WHEN ${legalCount} > 1 AND ${activeOutlets} = 1 THEN 'group'
      WHEN ${legalCount} > 1 AND ${activeOutlets} > 1 THEN 'group_network'
      ELSE 'unknown'
    END
  `;

  return { sql, params };
}

export function applyClientHoldingV2ListFilters(
  userFilter: SqlFilter,
  query: ClientsListQuery,
  context: AccessContext,
): SqlFilter {
  let filter = userFilter;

  if (query.holdingV2NameType) {
    filter = mergeSqlFilters(
      filter,
      [
        `EXISTS (
          SELECT 1
          FROM onec_holding_v2_client_type_category tc
          WHERE tc.guid_client = onec_clients.guid_client
            AND (tc.field_presence->>'nameType') = 'true'
            AND tc.name_type = $1
        )`,
      ],
      [query.holdingV2NameType],
    );
  }

  if (query.holdingV2NameCategory) {
    filter = mergeSqlFilters(
      filter,
      [
        `EXISTS (
          SELECT 1
          FROM onec_holding_v2_client_type_category tc
          WHERE tc.guid_client = onec_clients.guid_client
            AND (tc.field_presence->>'nameCategory') = 'true'
            AND tc.name_category = $1
        )`,
      ],
      [query.holdingV2NameCategory],
    );
  }

  if (query.holdingV2Composition) {
    const tokenSubquery = holdingV2CompositionTokenSubquery(context, "onec_clients.guid_client");
    const rebased = rebaseSqlPlaceholders(tokenSubquery.sql, filter.params.length);
    const tokenParamIndex = filter.params.length + tokenSubquery.params.length + 1;
    filter = appendSqlClauses(filter, [`(${rebased}) = $${tokenParamIndex}`]);
    filter = {
      whereSql: filter.whereSql,
      params: [...filter.params, ...tokenSubquery.params, query.holdingV2Composition],
    };
  }

  return filter;
}
