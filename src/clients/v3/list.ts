import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";

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
};

function appendAssignmentFilters(input: V3ListQuery, alias: string, params: unknown[]): string {
  let sql = "";
  if (input.managerGuid) {
    params.push(input.managerGuid);
    sql += ` AND (${alias}.managers->>'guidManager')::uuid = $${params.length}::uuid`;
  }
  if (input.typeGuid) {
    params.push(input.typeGuid);
    sql += ` AND ${alias}.type_category->>'guid_type' = $${params.length}`;
  }
  if (input.categoryGuid) {
    params.push(input.categoryGuid);
    sql += ` AND ${alias}.type_category->>'guid_category' = $${params.length}`;
  }
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
        SELECT le.guid_client::text AS guid, le.name_client AS name, le.guid_holding::text AS holding_guid
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
             ro.closed
      FROM onec_v3_retail_outlets ro
      WHERE (${scope.clause})${orphanOnly}${closedFilter}${search}${filters}
      ORDER BY name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );
  return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
}
