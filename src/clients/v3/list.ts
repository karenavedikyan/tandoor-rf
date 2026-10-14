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
  missingManager?: boolean;
  responsibleGuid?: string;
  responsibleKind?: V3ResponsibleKind;
  ropBranchGuid?: string;
};

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
  if (input.typeGuid) {
    params.push(input.typeGuid);
    sql += ` AND ${v3TypeGuidSql(alias)} = $${params.length}`;
  }
  if (input.categoryGuid) {
    params.push(input.categoryGuid);
    sql += ` AND ${v3CategoryGuidSql(alias)} = $${params.length}`;
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
    const filters = appendAssignmentFilters(input, "le", params);
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
               le.managers->>'nameManager' AS manager_name,
               le.managers->>'nameRegionalManager' AS regional_name,
               le.managers->>'nameHeadOfSales' AS rop_name
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
  const filters = appendAssignmentFilters(input, "ro", params);
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
             ro.managers->>'nameManager' AS manager_name,
             ro.managers->>'nameRegionalManager' AS regional_name,
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
