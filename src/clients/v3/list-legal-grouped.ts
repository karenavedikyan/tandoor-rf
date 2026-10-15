import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";
import { v3CategoryGuidSql, v3CategoryNameSql, v3JsonManagerField } from "./json-paths";
import {
  LEGAL_ADDRESS_SQL,
  LEGAL_CITY_SQL,
  LEGAL_CONTRACT_NUMBER_SQL,
  LEGAL_CREDIT_LIMIT_SQL,
  LEGAL_DEFER_DAYS_SQL,
  LEGAL_MARKUP_PERCENTAGE_SQL,
  legalPaymentTypeSql,
  LEGAL_STATUS_SQL,
} from "./list-sql-expressions";
import {
  appendCatalogAssignmentFilters,
  appendTerritoryAssignmentFilters,
  appendV3ColumnFilters,
  type V3ListQuery,
} from "./list";
import { appendV3FieldRulesSql, type V3FilterRule } from "./list-field-rules";

const ZERO_HOLDING = "00000000-0000-0000-0000-000000000000";

export function v3LegalGroupKeyExpr(leAlias: string, holdingVisibilityClause = "TRUE"): string {
  return `(CASE
    WHEN COALESCE(${leAlias}.membership_conflict, false) = true THEN 'legal:' || ${leAlias}.guid_client::text
    WHEN ${leAlias}.guid_holding IS NULL OR ${leAlias}.guid_holding = '${ZERO_HOLDING}'::uuid THEN 'legal:' || ${leAlias}.guid_client::text
    WHEN NOT EXISTS (
      SELECT 1 FROM onec_v3_holdings _v3gh WHERE _v3gh.guid_holding = ${leAlias}.guid_holding AND (${holdingVisibilityClause})
    ) THEN 'legal:' || ${leAlias}.guid_client::text
    ELSE 'holding:' || ${leAlias}.guid_holding::text
  END)`;
}

export function readableGroupKey(context: AccessContext, params: unknown[]): string {
  const holdingScope = v3HoldingVisibilityScope(context, "_v3gh");
  const clause = renumberScopeClause(holdingScope.clause, params.length + 1);
  params.push(...holdingScope.params);
  return v3LegalGroupKeyExpr("le", clause);
}

function renumberScopeClause(clause: string, startIndex: number): string {
  return clause.replace(/\$(\d+)/g, (_m, index) => `$${Number(index) + startIndex - 1}`);
}

function appendGroupedSearch(
  qPattern: string,
  params: unknown[],
  holdingScopeClause: string,
  holdingScopeParams: unknown[],
): string {
  params.push(qPattern);
  const p = `$${params.length}`;
  const holdingStart = params.length + 1;
  params.push(...holdingScopeParams);
  const holdingClause = renumberScopeClause(holdingScopeClause, holdingStart);
  return ` AND (
    le.name_client ILIKE ${p} ESCAPE '\\' OR
    COALESCE(${LEGAL_ADDRESS_SQL}, '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameRegionalManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameHeadOfSales', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameHardwareManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.other_fields->>'Код', '') ILIKE ${p} ESCAPE '\\' OR
    EXISTS (
      SELECT 1 FROM onec_v3_holdings h_s
      WHERE h_s.guid_holding = le.guid_holding
        AND (${holdingClause})
        AND h_s.name_holding ILIKE ${p} ESCAPE '\\'
    )
  )`;
}

function distinctOrMissing(expression: string): string {
  return `STRING_AGG(DISTINCT NULLIF(TRIM(${expression}), ''), ', ' ORDER BY NULLIF(TRIM(${expression}), ''))`;
}

/** Visible grouped-list name for one legal row (matches SELECT name / sort, scoped holding visibility). */
export function legalGroupedRowDisplayNameSql(leAlias: string, holdingVisibilityClause: string): string {
  const holdingClauseForGroupKey = holdingVisibilityClause.replace(/_v3gdn\./g, "_v3gh.");
  const groupKey = v3LegalGroupKeyExpr(leAlias, holdingClauseForGroupKey);
  return `(CASE
    WHEN ${groupKey} LIKE 'holding:%' AND EXISTS (
      SELECT 1 FROM onec_v3_holdings _v3gdn
      WHERE _v3gdn.guid_holding = ${leAlias}.guid_holding AND (${holdingVisibilityClause})
    ) THEN NULLIF(TRIM((
      SELECT _v3gdn.name_holding FROM onec_v3_holdings _v3gdn
      WHERE _v3gdn.guid_holding = ${leAlias}.guid_holding AND (${holdingVisibilityClause})
      LIMIT 1
    )), '')
    ELSE NULLIF(TRIM(${leAlias}.name_client), '')
  END)`;
}

function appendGroupDisplayNameRules(
  sql: string,
  params: unknown[],
  rules: V3FilterRule[],
  holdingScope: ReturnType<typeof v3HoldingVisibilityScope>,
): string {
  if (!rules.length) {
    return sql;
  }
  const scopeStart = params.length + 1;
  params.push(...holdingScope.params);
  const holdingClause = renumberScopeClause(holdingScope.clause, scopeStart).replace(/\bh_s\./g, "_v3gdn.");
  const displayExpr = legalGroupedRowDisplayNameSql("le", holdingClause);
  let next = sql;
  for (const rule of rules) {
    const op = rule.op;
    const val = rule.value;
    if (op === "empty") {
      next += ` AND NULLIF(TRIM(COALESCE(${displayExpr}, '')), '') IS NULL`;
      continue;
    }
    if (op === "filled") {
      next += ` AND NULLIF(TRIM(COALESCE(${displayExpr}, '')), '') IS NOT NULL`;
      continue;
    }
    if (op === "contains") {
      params.push(`%${val.replace(/[%_\\]/g, "\\$&")}%`);
      next += ` AND COALESCE(${displayExpr}, '') ILIKE $${params.length} ESCAPE '\\'`;
      continue;
    }
    if (op === "eq") {
      params.push(val);
      next += ` AND COALESCE(${displayExpr}, '') = $${params.length}`;
    }
  }
  return next;
}

/** The grouped category is the readable holding's category, not a child category. */
export function groupedCategoryExpressions(context: AccessContext, alias: string, params: unknown[]) {
  const scope = v3HoldingVisibilityScope(context, "_v3cat");
  const clause = renumberScopeClause(scope.clause, params.length + 1);
  params.push(...scope.params);
  const expression = (field: "guid" | "name") => `(CASE
    WHEN ${v3LegalGroupKeyExpr(alias, clause.replace(/\b_v3cat\./g, "_v3gh."))} LIKE 'holding:%' THEN (
      SELECT ${field === "guid" ? v3CategoryGuidSql("_v3cat") : v3CategoryNameSql("_v3cat")}
      FROM onec_v3_holdings _v3cat
      WHERE _v3cat.guid_holding = ${alias}.guid_holding AND (${clause})
    )
    ELSE ${field === "guid" ? v3CategoryGuidSql(alias) : v3CategoryNameSql(alias)}
  END)`;
  return { guid: expression("guid"), name: expression("name") };
}

function appendEligibilityFilters(
  input: V3ListQuery,
  params: unknown[],
  holdingScope: ReturnType<typeof v3HoldingVisibilityScope>,
  context: AccessContext,
): { filterSql: string; memberLegalNameSql: string } {
  let sql = appendCatalogAssignmentFilters({ ...input, categoryGuid: undefined, categoryGuids: undefined }, "le", params);
  sql += appendV3ColumnFilters(input, "legal", params);
  const categoryRules = (input.fieldRules || []).filter(rule => rule.field === "categoryGuid");
  const legalNameRules = (input.fieldRules || []).filter((rule) => rule.field === "legalName");
  const groupDisplayNameRules = (input.fieldRules || []).filter((rule) => rule.field === "groupDisplayName");
  const rulesWithoutCategory = (input.fieldRules || []).filter((rule) => rule.field !== "categoryGuid");
  const rulesWithoutCategoryAndLegalName = rulesWithoutCategory.filter(
    (rule) => rule.field !== "legalName" && rule.field !== "groupDisplayName",
  );
  sql = appendV3FieldRulesSql(sql, params, "legal_grouped", "le", rulesWithoutCategoryAndLegalName).sql;
  sql = appendGroupDisplayNameRules(sql, params, groupDisplayNameRules, holdingScope);
  let legalNameOnLe = "";
  if (legalNameRules.length) {
    const legalNameApplied = appendV3FieldRulesSql("TRUE", params, "legal_grouped", "le", legalNameRules);
    legalNameOnLe = legalNameApplied.sql === "TRUE" ? "" : legalNameApplied.sql.slice(4);
    sql += legalNameOnLe;
  }
  const memberLegalNameSql = legalNameOnLe.replace(/\ble\./g, "s.");
  const categoryGuids = input.categoryGuids?.length ? input.categoryGuids : input.categoryGuid ? [input.categoryGuid] : [];
  if (categoryRules.length || categoryGuids.length) {
    const category = groupedCategoryExpressions(context, "le", params).guid;
    if (categoryGuids.length) {
      params.push(categoryGuids);
      sql += ` AND ${category} = ANY($${params.length}::text[])`;
    }
    for (const rule of categoryRules) {
      if (rule.op === "empty" || rule.op === "filled") {
        sql += ` AND NULLIF(TRIM(${category}), '') IS ${rule.op === "filled" ? "NOT " : ""}NULL`;
      } else {
        params.push(rule.value);
        sql += ` AND ${category} = $${params.length}`;
      }
    }
  }
  const q = input.q.trim();
  const qPattern = q.length > 0 ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null;
  if (qPattern) {
    sql += appendGroupedSearch(qPattern, params, holdingScope.clause, holdingScope.params);
  }
  return { filterSql: sql, memberLegalNameSql };
}

export async function countV3LegalGroups(
  context: AccessContext,
  territory: Pick<V3ListQuery, "ropBranchGuid" | "responsibleGuid" | "responsibleKind" | "managerGuid">,
): Promise<number> {
  const scope = v3EntityAssignmentScope(context, "le");
  const params = [...scope.params];
  const territorySql = appendTerritoryAssignmentFilters(
    { entity: "legal_grouped", page: 1, pageSize: 1, q: "", ...territory },
    "le",
    params,
  );
  const groupKey = readableGroupKey(context, params);
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count FROM (
        SELECT DISTINCT ${groupKey} AS group_key
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${territorySql}
      ) grouped
    `,
    params,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function listV3LegalGrouped(
  context: AccessContext,
  input: V3ListQuery,
): Promise<{ total: number; items: Record<string, unknown>[] }> {
  const offset = (input.page - 1) * input.pageSize;

  const scope = v3EntityAssignmentScope(context, "le");
  const holdingScope = v3HoldingVisibilityScope(context, "h_s");

  const countParams = [...scope.params];
  const territorySql = appendTerritoryAssignmentFilters(input, "le", countParams);
  const { filterSql: matchSql } = appendEligibilityFilters(input, countParams, holdingScope, context);

  const groupKey = readableGroupKey(context, countParams);
  const countResult = await query<{ count: string }>(
    `
      WITH scoped AS (
        SELECT le.guid_client, ${groupKey} AS group_key
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${territorySql}
      ),
      eligible AS (
        SELECT DISTINCT s.group_key
        FROM onec_v3_legal_entities le
        INNER JOIN scoped s ON s.guid_client = le.guid_client
        WHERE TRUE${matchSql}
      )
      SELECT COUNT(*)::text AS count FROM eligible
    `,
    countParams,
  );
  const total = Number(countResult.rows[0]?.count ?? 0);
  if (total === 0) {
    return { total: 0, items: [] };
  }

  const selectParams = [...scope.params];
  const selectTerritory = appendTerritoryAssignmentFilters(input, "le", selectParams);
  const selectFilters = appendEligibilityFilters(input, selectParams, holdingScope, context);
  const selectMatch = selectFilters.filterSql;
  const selectMemberLegalNameSql = selectFilters.memberLegalNameSql;
  const selectGroupKey = readableGroupKey(context, selectParams);

  const holdingScopeJoin = v3HoldingVisibilityScope(context, "h");
  selectParams.push(...holdingScopeJoin.params);
  const holdingVisibleClause = renumberScopeClause(
    holdingScopeJoin.clause,
    selectParams.length - holdingScopeJoin.params.length + 1,
  );
  selectParams.push(input.pageSize, offset);

  const rows = await query(
    `
      WITH scoped AS (
        SELECT le.*, ${selectGroupKey} AS group_key
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${selectTerritory}
      ),
      eligible AS (
        SELECT DISTINCT s.group_key
        FROM onec_v3_legal_entities le
        INNER JOIN scoped s ON s.guid_client = le.guid_client
        WHERE TRUE${selectMatch}
      ),
      page_groups AS (
        SELECT eg.group_key
        FROM eligible eg
        ORDER BY
          lower(CASE
            WHEN eg.group_key LIKE 'holding:%' THEN (
              SELECT COALESCE(
                NULLIF(TRIM(MAX(h_pg.name_holding)), ''),
                NULLIF(TRIM(MAX(s.name_client)), ''),
                eg.group_key
              )
              FROM scoped s
              LEFT JOIN onec_v3_holdings h_pg
                ON h_pg.guid_holding = CASE WHEN eg.group_key LIKE 'holding:%' THEN substring(eg.group_key from 9)::uuid END
                AND (${holdingVisibleClause.replace(/\bh\./g, "h_pg.")})
              WHERE s.group_key = eg.group_key
            )
            ELSE (SELECT MAX(s.name_client) FROM scoped s WHERE s.group_key = eg.group_key)
          END),
          eg.group_key ASC
        LIMIT $${selectParams.length - 1} OFFSET $${selectParams.length}
      ),
      members AS (
        SELECT s.*
        FROM scoped s
        INNER JOIN page_groups pg ON pg.group_key = s.group_key
        WHERE TRUE${selectMemberLegalNameSql}
      )
      SELECT
        pg.group_key,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN substring(pg.group_key from 9)
          ELSE (ARRAY_AGG(m.guid_client::text ORDER BY m.name_client ASC, m.guid_client ASC))[1]
        END AS guid,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN 'holding'
          ELSE 'legal'
        END AS detail_entity,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN MAX(h.name_holding)
          ELSE ${distinctOrMissing("m.name_client")}
        END AS name,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN NULLIF(TRIM(MAX(${v3CategoryNameSql("h")})), '')
          WHEN pg.group_key LIKE 'holding:%' THEN NULL
          ELSE ${distinctOrMissing(v3CategoryNameSql("m"))}
        END AS category_name,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN COALESCE(
              NULLIF(TRIM(MAX(${v3JsonManagerField("h", "nameManager")})), ''),
              ${distinctOrMissing(`m.managers->>'nameManager'`)}
            )
          ELSE ${distinctOrMissing(`m.managers->>'nameManager'`)}
        END AS manager_name,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN COALESCE(
              NULLIF(TRIM(MAX(${v3JsonManagerField("h", "nameHeadOfSales")})), ''),
              ${distinctOrMissing(`m.managers->>'nameHeadOfSales'`)}
            )
          ELSE ${distinctOrMissing(`m.managers->>'nameHeadOfSales'`)}
        END AS rop_name,
        ${distinctOrMissing(LEGAL_ADDRESS_SQL.replace(/\ble\./g, "m."))} AS address_line,
        ${distinctOrMissing(LEGAL_CITY_SQL.replace(/\ble\./g, "m."))} AS city,
        ${distinctOrMissing(LEGAL_STATUS_SQL.replace(/\ble\./g, "m."))} AS status_label,
        ${distinctOrMissing("m.managers->>'nameRegionalManager'")} AS regional_name,
        ${distinctOrMissing("m.managers->>'nameHardwareManager'")} AS hardware_name,
        COALESCE(
          jsonb_agg(
            jsonb_build_object('guid', m.guid_client::text, 'name', m.name_client)
            ORDER BY m.name_client ASC, m.guid_client ASC
          ),
          '[]'::jsonb
        ) AS legal_entities,
        MAX(m.guid_holding::text) AS holding_guid,
        ${distinctOrMissing("m.type_category->>'nameType'")} AS type_name,
        ${distinctOrMissing(LEGAL_CONTRACT_NUMBER_SQL.replace(/\ble\./g, "m."))} AS contract_number,
        ${distinctOrMissing(LEGAL_DEFER_DAYS_SQL.replace(/\ble\./g, "m."))} AS defer_days,
        ${distinctOrMissing(LEGAL_CREDIT_LIMIT_SQL.replace(/\ble\./g, "m."))} AS credit_limit,
        ${distinctOrMissing("m.discount_amount::text")} AS discount_amount,
        ${distinctOrMissing(LEGAL_MARKUP_PERCENTAGE_SQL.replace(/\ble\./g, "m."))} AS markup_percentage
      FROM page_groups pg
      INNER JOIN members m ON m.group_key = pg.group_key
      LEFT JOIN onec_v3_holdings h
        ON pg.group_key LIKE 'holding:%'
        AND h.guid_holding = CASE WHEN pg.group_key LIKE 'holding:%' THEN substring(pg.group_key from 9)::uuid END
        AND (${holdingVisibleClause})
      GROUP BY pg.group_key
      ORDER BY
        lower(CASE
          WHEN pg.group_key LIKE 'holding:%' THEN COALESCE(
            NULLIF(TRIM(MAX(h.name_holding)), ''),
            NULLIF(TRIM(MAX(m.name_client)), ''),
            pg.group_key
          )
          ELSE MAX(m.name_client)
        END),
        pg.group_key ASC
    `,
    selectParams,
  );

  async function attachGroupedPaymentTypes(
    items: Array<{ legal_entities: Array<{ guid: string }>; payment_type?: string | null }>,
  ): Promise<void> {
    const guids = items.flatMap((item) =>
      item.legal_entities
        .map((entry) => entry.guid ?? (entry as { guid_client?: string }).guid_client)
        .filter(Boolean),
    );
    if (!guids.length) {
      return;
    }
    const payRows = await query<{ guid: string; payment_type: string | null }>(
      `
        SELECT le.guid_client::text AS guid, ${legalPaymentTypeSql("le")} AS payment_type
        FROM onec_v3_legal_entities le
        WHERE le.guid_client = ANY($1::uuid[])
      `,
      [guids],
    );
    const byGuid = new Map(
      payRows.rows.map((entry) => [entry.guid.toLowerCase(), entry.payment_type]),
    );
    for (const item of items) {
      const values = item.legal_entities
        .map((entry) => {
          const key = String(entry.guid ?? (entry as { guid_client?: string }).guid_client ?? "").toLowerCase();
          return byGuid.get(key);
        })
        .filter((value): value is string => typeof value === "string" && value.trim() !== "");
      item.payment_type = values.length ? [...new Set(values)].join("; ") : null;
    }
  }

  const items = rows.rows.map((row) => {
    const legalEntities = Array.isArray(row.legal_entities)
      ? row.legal_entities
      : typeof row.legal_entities === "string"
        ? JSON.parse(row.legal_entities)
        : [];
    return {
      group_key: row.group_key,
      guid: row.guid,
      detail_entity: row.detail_entity,
      name: row.name,
      category_name: row.category_name,
      manager_name: row.manager_name,
      rop_name: row.rop_name,
      legal_entities: legalEntities,
      holding_guid: row.holding_guid,
      type_name: row.type_name,
      address_line: row.address_line,
      city: row.city,
      status_label: row.status_label,
      regional_name: row.regional_name,
      hardware_name: row.hardware_name,
      legal_name: legalEntities.map((e: { name: string }) => e.name).join(", "),
      contract_number: row.contract_number,
      defer_days: row.defer_days,
      credit_limit: row.credit_limit,
      discount_amount: row.discount_amount,
      markup_percentage: row.markup_percentage,
    };
  });

  await attachGroupedPaymentTypes(items);

  return { total, items };
}
