import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";
import { v3CategoryGuidSql, v3JsonManagerField, v3TypeGuidSql } from "./json-paths";

export type V3ResponsibleKind = "manager" | "regional" | "hardware";

function responsibleGuidField(kind: V3ResponsibleKind): keyof import("./json-paths").V3ManagersJson {
  if (kind === "regional") return "guidRegionalManager";
  if (kind === "hardware") return "guidHardwareManager";
  return "guidManager";
}

export type V3ListEntity = "holdings" | "legal" | "retail" | "orphan_retail";

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
    return ` AND NULLIF(TRIM(le.address), '') = $${params.length}`;
  }
  return ` AND COALESCE(NULLIF(TRIM(ro.address->>'city'), ''), NULLIF(TRIM(ro.address->>'store_address'), '')) = $${params.length}`;
}

function appendV3ColumnFilters(input: V3ListQuery, entity: "legal" | "retail", params: unknown[]): string {
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
    sql = appendTextContainsFilter(sql, params, `COALESCE(NULLIF(TRIM(le.address), ''), '')`, input.colCity);
    sql = appendTextContainsFilter(
      sql,
      params,
      `COALESCE(le.type_category->>'nameType', le.type_category->>'nameCategory', '')`,
      input.colStatus,
    );
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
  sql = appendTextContainsFilter(
    sql,
    params,
    `COALESCE(NULLIF(TRIM(ro.address->>'city'), ''), NULLIF(TRIM(ro.address->>'store_address'), ''), '')`,
    input.colCity,
  );
  if (input.colStatus?.trim()) {
    const statusNeedle = input.colStatus.trim().toLowerCase();
    if (statusNeedle.includes("закр")) {
      sql += " AND ro.closed = TRUE";
    } else if (statusNeedle.includes("откр")) {
      sql += " AND ro.closed = FALSE";
    }
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

function appendAssignmentFilters(input: V3ListQuery, alias: string, params: unknown[]): string {
  let sql = "";
  const guidFilter = input.responsibleGuid ?? input.managerGuid;
  const kind = input.responsibleKind ?? (input.managerGuid ? "manager" : undefined);
  if (guidFilter && kind) {
    params.push(guidFilter);
    sql += ` AND NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, responsibleGuidField(kind))}, '')), '')::uuid = $${params.length}::uuid`;
  }
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
  sql += appendRopBranchFilter(input, alias, params);
  return sql;
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

  if (input.entity === "legal") {
    const scope = v3EntityAssignmentScope(context, "le");
    const params = [...scope.params];
    const search = qPattern ? ` AND le.name_client ILIKE $${params.push(qPattern)} ESCAPE '\\'` : "";
    const filters =
      appendAssignmentFilters(input, "le", params) + appendV3ColumnFilters(input, "legal", params);
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
               NULLIF(TRIM(le.address), '') AS city,
               le.managers->>'nameManager' AS manager_name,
               le.managers->>'nameRegionalManager' AS regional_name,
               le.managers->>'nameHardwareManager' AS hardware_name,
               le.managers->>'nameHeadOfSales' AS rop_name,
               COALESCE(le.type_category->>'nameType', le.type_category->>'nameCategory', '') AS status_label
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
  const search = qPattern
    ? ` AND COALESCE(ro.address->>'store_address', '') ILIKE $${params.push(qPattern)} ESCAPE '\\'`
    : "";
  const filters =
    appendAssignmentFilters(input, "ro", params) + appendV3ColumnFilters(input, "retail", params);
  const countParams = [...params];
  params.push(input.pageSize, offset);
  const total = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_v3_retail_outlets ro WHERE (${scope.clause})${orphanOnly}${closedFilter}${search}${filters}`,
    countParams,
  );
  const rows = await query(
    `
      SELECT ro.guid_store::text AS guid,
             COALESCE(ro.address->>'store_address', ro.guid_store::text) AS name,
             ro.guid_holding::text AS holding_guid,
             ro.closed,
             COALESCE(NULLIF(TRIM(ro.address->>'city'), ''), NULLIF(TRIM(ro.address->>'store_address'), '')) AS city,
             ro.managers->>'nameManager' AS manager_name,
             ro.managers->>'nameRegionalManager' AS regional_name,
             ro.managers->>'nameHardwareManager' AS hardware_name,
             ro.managers->>'nameHeadOfSales' AS rop_name,
             ro.address->>'store_address' AS store_address
      FROM onec_v3_retail_outlets ro
      WHERE (${scope.clause})${orphanOnly}${closedFilter}${search}${filters}
      ORDER BY name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );
  return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
}
