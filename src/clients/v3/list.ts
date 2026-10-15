import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";
import { v3CategoryGuidSql, v3JsonManagerField, v3TypeGuidSql } from "./json-paths";
import {
  LEGAL_ADDRESS_SQL,
  LEGAL_CITY_SQL,
  LEGAL_STATUS_SQL,
  RETAIL_CITY_SQL,
  RETAIL_STATUS_LABEL_SQL,
} from "./list-sql-expressions";
import { appendV3FieldRulesSql, type V3FilterRule } from "./list-field-rules";
import { v3CategoryNameSql, v3TypeNameSql } from "./json-paths";

export type V3ResponsibleKind = "manager" | "regional" | "hardware";

function responsibleGuidField(kind: V3ResponsibleKind): keyof import("./json-paths").V3ManagersJson {
  if (kind === "regional") return "guidRegionalManager";
  if (kind === "hardware") return "guidHardwareManager";
  return "guidManager";
}

export type V3ListEntity = "holdings" | "legal" | "legal_grouped" | "retail" | "orphan_retail";

export type V3ListQuery = {
  entity: V3ListEntity;
  page: number;
  pageSize: number;
  q: string;
  closed?: boolean;
  managerGuid?: string;
  typeGuid?: string;
  categoryGuid?: string;
  typeGuids?: string[];
  categoryGuids?: string[];
  missingManager?: boolean;
  responsibleGuid?: string;
  responsibleKind?: V3ResponsibleKind;
  ropBranchGuid?: string;
  city?: string;
  colManager?: string;
  colRegional?: string;
  colRop?: string;
  colCity?: string;
  colStatus?: string;
  fieldRules?: V3FilterRule[];
};

function appendTextContainsFilter(
  sql: string,
  params: unknown[],
  expression: string,
  raw: string | undefined,
): string {
  const value = raw?.trim();
  if (!value) {
    return sql;
  }
  params.push(`%${value.replace(/[%_\\]/g, "\\$&")}%`);
  return `${sql} AND ${expression} ILIKE $${params.length} ESCAPE '\\'`;
}

function appendCityFilter(input: V3ListQuery, entity: "legal" | "retail", params: unknown[]): string {
  const city = input.city?.trim();
  if (!city) {
    return "";
  }
  params.push(city);
  if (entity === "legal") {
    return ` AND ${LEGAL_CITY_SQL} = $${params.length}`;
  }
  return ` AND ${RETAIL_CITY_SQL} = $${params.length}`;
}

function appendLegalSearch(qPattern: string, params: unknown[]): string {
  params.push(qPattern);
  const p = `$${params.length}`;
  return ` AND (
    le.name_client ILIKE ${p} ESCAPE '\\' OR
    COALESCE(${LEGAL_ADDRESS_SQL}, '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameRegionalManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameHeadOfSales', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameHardwareManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.other_fields->>'Код', '') ILIKE ${p} ESCAPE '\\'
  )`;
}

function appendRetailSearch(qPattern: string, params: unknown[]): string {
  params.push(qPattern);
  const p = `$${params.length}`;
  return ` AND (
    COALESCE(ro.address->>'store_address', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(ro.managers->>'nameManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(ro.managers->>'nameRegionalManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(ro.managers->>'nameHeadOfSales', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(${RETAIL_CITY_SQL}, '') ILIKE ${p} ESCAPE '\\'
  )`;
}

export function appendV3ColumnFilters(input: V3ListQuery, entity: "legal" | "retail", params: unknown[]): string {
  let sql = appendCityFilter(input, entity, params);
  if (entity === "legal") {
    sql = appendTextContainsFilter(
      sql,
      params,
      `COALESCE(le.managers->>'nameManager', '')`,
      input.colManager,
    );
    sql = appendTextContainsFilter(
      sql,
      params,
      `COALESCE(le.managers->>'nameRegionalManager', '')`,
      input.colRegional,
    );
    sql = appendTextContainsFilter(
      sql,
      params,
      `COALESCE(le.managers->>'nameHeadOfSales', '')`,
      input.colRop,
    );
    sql = appendTextContainsFilter(sql, params, `COALESCE(${LEGAL_CITY_SQL}, '')`, input.colCity);
    sql = appendTextContainsFilter(sql, params, `COALESCE(${LEGAL_STATUS_SQL}, '')`, input.colStatus);
    return sql;
  }
  sql = appendTextContainsFilter(
    sql,
    params,
    `COALESCE(ro.managers->>'nameManager', '')`,
    input.colManager,
  );
  sql = appendTextContainsFilter(
    sql,
    params,
    `COALESCE(ro.managers->>'nameRegionalManager', '')`,
    input.colRegional,
  );
  sql = appendTextContainsFilter(
    sql,
    params,
    `COALESCE(ro.managers->>'nameHeadOfSales', '')`,
    input.colRop,
  );
  sql = appendTextContainsFilter(sql, params, `COALESCE(${RETAIL_CITY_SQL}, '')`, input.colCity);
  if (input.colStatus?.trim()) {
    params.push(`%${input.colStatus.trim().replace(/[%_\\]/g, "\\$&")}%`);
    sql += ` AND ${RETAIL_STATUS_LABEL_SQL} ILIKE $${params.length} ESCAPE '\\'`;
  }
  return sql;
}

function appendRopBranchFilter(input: V3ListQuery, alias: string, params: unknown[]): string {
  if (!input.ropBranchGuid) {
    return "";
  }
  params.push(input.ropBranchGuid);
  return ` AND NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidHeadOfSales")}, '')), '')::uuid = $${params.length}::uuid`;
}

/** Selected employee / ROP territory only (no type, category, or missing-manager narrowing). */
export function appendTerritoryAssignmentFilters(input: V3ListQuery, alias: string, params: unknown[]): string {
  let sql = "";
  const teamScoped =
    Boolean(input.ropBranchGuid) ||
    (Boolean(input.responsibleGuid) &&
      Boolean(input.responsibleKind) &&
      input.responsibleKind !== "manager");
  let guidFilter: string | undefined;
  let kind: V3ResponsibleKind | undefined;
  if (teamScoped && input.responsibleGuid && input.responsibleKind) {
    guidFilter = input.responsibleGuid;
    kind = input.responsibleKind;
  } else if (input.managerGuid) {
    guidFilter = input.managerGuid;
    kind = "manager";
  } else if (input.responsibleGuid && input.responsibleKind) {
    guidFilter = input.responsibleGuid;
    kind = input.responsibleKind;
  }
  if (guidFilter && kind) {
    params.push(guidFilter);
    sql += ` AND NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, responsibleGuidField(kind))}, '')), '')::uuid = $${params.length}::uuid`;
  }
  sql += appendRopBranchFilter(input, alias, params);
  return sql;
}

export function appendCatalogAssignmentFilters(input: V3ListQuery, alias: string, params: unknown[]): string {
  let sql = "";
  const typeGuids =
    input.typeGuids && input.typeGuids.length > 0
      ? input.typeGuids
      : input.typeGuid
        ? [input.typeGuid]
        : [];
  if (typeGuids.length === 1) {
    params.push(typeGuids[0]);
    sql += ` AND ${v3TypeGuidSql(alias)} = $${params.length}`;
  } else if (typeGuids.length > 1) {
    const placeholders: string[] = [];
    for (const guid of typeGuids) {
      params.push(guid);
      placeholders.push(`$${params.length}`);
    }
    sql += ` AND ${v3TypeGuidSql(alias)} IN (${placeholders.join(", ")})`;
  }
  const categoryGuids =
    input.categoryGuids && input.categoryGuids.length > 0
      ? input.categoryGuids
      : input.categoryGuid
        ? [input.categoryGuid]
        : [];
  if (categoryGuids.length === 1) {
    params.push(categoryGuids[0]);
    sql += ` AND ${v3CategoryGuidSql(alias)} = $${params.length}`;
  } else if (categoryGuids.length > 1) {
    const placeholders: string[] = [];
    for (const guid of categoryGuids) {
      params.push(guid);
      placeholders.push(`$${params.length}`);
    }
    sql += ` AND ${v3CategoryGuidSql(alias)} IN (${placeholders.join(", ")})`;
  }
  if (input.missingManager) {
    sql += ` AND NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidManager")}, '')), '') IS NULL`;
  }
  return sql;
}

export function appendAssignmentFilters(input: V3ListQuery, alias: string, params: unknown[]): string {
  return appendTerritoryAssignmentFilters(input, alias, params) + appendCatalogAssignmentFilters(input, alias, params);
}

export async function isExchangeV3Active(): Promise<boolean> {
  const result = await query<{ active: boolean }>(
    `SELECT (last_bundle_fingerprint IS NOT NULL) AS active FROM onec_v3_exchange_state WHERE id = 1`,
  );
  return result.rows[0]?.active === true;
}

export async function listV3Entities(
  context: AccessContext,
  input: V3ListQuery,
): Promise<{ total: number; items: Record<string, unknown>[] }> {
  const offset = (input.page - 1) * input.pageSize;
  const q = input.q.trim();
  const qPattern = q.length > 0 ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null;

  if (input.entity === "holdings") {
    const scope = v3HoldingVisibilityScope(context, "h");
    const params = [...scope.params];
    const search = qPattern ? ` AND h.name_holding ILIKE $${params.push(qPattern)} ESCAPE '\\'` : "";
    const filters = appendAssignmentFilters(input, "h", params);
    const countParams = [...params];
    params.push(input.pageSize, offset);
    const total = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_holdings h WHERE (${scope.clause})${search}${filters}`,
      countParams,
    );
    const rows = await query(
      `
        SELECT h.guid_holding::text AS guid, h.name_holding AS name
        FROM onec_v3_holdings h
        WHERE (${scope.clause})${search}${filters}
        ORDER BY h.name_holding ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
  }

  if (input.entity === "legal_grouped") {
    const { listV3LegalGrouped } = await import("./list-legal-grouped");
    return listV3LegalGrouped(context, input);
  }

  if (input.entity === "legal") {
    const scope = v3EntityAssignmentScope(context, "le");
    const params = [...scope.params];
    const search = qPattern ? appendLegalSearch(qPattern, params) : "";
    let filters =
      appendAssignmentFilters(input, "le", params) + appendV3ColumnFilters(input, "legal", params);
    const rulesApplied = appendV3FieldRulesSql(filters, params, input.entity, "le", input.fieldRules);
    filters = rulesApplied.sql;
    const countParams = [...params];
    params.push(input.pageSize, offset);
    const total = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_legal_entities le WHERE (${scope.clause})${search}${filters}`,
      countParams,
    );
    const rows = await query(
      `
        SELECT le.guid_client::text AS guid,
               le.name_client AS name,
               le.guid_holding::text AS holding_guid,
               le.name_holding AS holding_name,
               ${LEGAL_CITY_SQL} AS city,
               ${LEGAL_ADDRESS_SQL} AS address_line,
               le.managers->>'nameManager' AS manager_name,
               le.managers->>'nameRegionalManager' AS regional_name,
               le.managers->>'nameHardwareManager' AS hardware_name,
               le.managers->>'nameHeadOfSales' AS rop_name,
               ${LEGAL_STATUS_SQL} AS status_label,
               le.type_category->>'nameType' AS type_name,
               le.type_category->>'nameCategory' AS category_name
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${search}${filters}
        ORDER BY le.name_client ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
  }

  const scope = v3EntityAssignmentScope(context, "ro", "retail");
  const orphanOnly = input.entity === "orphan_retail" ? " AND ro.guid_holding IS NULL" : "";
  const closedFilter =
    input.closed === true ? " AND ro.closed = TRUE" : input.closed === false ? " AND ro.closed = FALSE" : "";
  const params = [...scope.params];
  const search = qPattern ? appendRetailSearch(qPattern, params) : "";
  let filters =
    appendAssignmentFilters(input, "ro", params) + appendV3ColumnFilters(input, "retail", params);
  const rulesApplied = appendV3FieldRulesSql(filters, params, input.entity, "ro", input.fieldRules);
  filters = rulesApplied.sql;
  const holdingJoin = " LEFT JOIN onec_v3_holdings h ON h.guid_holding = ro.guid_holding";
  const fromSql = `FROM onec_v3_retail_outlets ro${holdingJoin}`;
  const countParams = [...params];
  params.push(input.pageSize, offset);
  const total = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count ${fromSql} WHERE (${scope.clause})${orphanOnly}${closedFilter}${search}${filters}`,
    countParams,
  );
  const rows = await query(
    `
      SELECT ro.guid_store::text AS guid,
             COALESCE(NULLIF(TRIM(h.name_holding), ''), NULLIF(TRIM(ro.address->>'store_address'), ''), ro.guid_store::text) AS client_name,
             COALESCE(ro.address->>'store_address', ro.guid_store::text) AS name,
             ro.guid_holding::text AS holding_guid,
             h.name_holding AS holding_name,
             ro.closed,
             ${RETAIL_CITY_SQL} AS city,
             ro.managers->>'nameManager' AS manager_name,
             ro.managers->>'nameRegionalManager' AS regional_name,
             ro.managers->>'nameHardwareManager' AS hardware_name,
             ro.managers->>'nameHeadOfSales' AS rop_name,
             ro.address->>'store_address' AS store_address,
             NULLIF(TRIM(ro.lpr_information->>'name'), '') AS lpr_name,
             NULLIF(TRIM(ro.additional_information->>'status_tandoor_club'), '') AS club_status,
             NULLIF(TRIM(ro.additional_information->>'bonus_tandoor_club'), '') AS club_bonus,
             ${v3CategoryNameSql("ro")} AS category_name,
             ${v3TypeNameSql("ro")} AS type_name
      ${fromSql}
      WHERE (${scope.clause})${orphanOnly}${closedFilter}${search}${filters}
      ORDER BY ro.address->>'store_address' ASC NULLS LAST, name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );
  return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
}
