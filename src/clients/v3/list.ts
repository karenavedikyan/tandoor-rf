import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";

export type V3ListEntity = "holdings" | "legal" | "retail" | "orphan_retail";

export type V3ListQuery = {
  entity: V3ListEntity;
  page: number;
  pageSize: number;
  q: string;
};

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
    const search = qPattern ? ` AND h.name_holding ILIKE $${scope.params.length + 1} ESCAPE '\\'` : "";
    const params = [...scope.params];
    if (qPattern) params.push(qPattern);
    params.push(input.pageSize, offset);
    const total = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_holdings h WHERE (${scope.clause})${search}`,
      qPattern ? [...scope.params, qPattern] : scope.params,
    );
    const rows = await query(
      `
        SELECT h.guid_holding::text AS guid, h.name_holding AS name
        FROM onec_v3_holdings h
        WHERE (${scope.clause})${search}
        ORDER BY h.name_holding ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
  }

  if (input.entity === "legal") {
    const scope = v3EntityAssignmentScope(context, "le");
    const search = qPattern ? ` AND le.name_client ILIKE $${scope.params.length + 1} ESCAPE '\\'` : "";
    const params = [...scope.params];
    if (qPattern) params.push(qPattern);
    params.push(input.pageSize, offset);
    const total = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_legal_entities le WHERE (${scope.clause})${search}`,
      qPattern ? [...scope.params, qPattern] : scope.params,
    );
    const rows = await query(
      `
        SELECT le.guid_client::text AS guid, le.name_client AS name, le.guid_holding::text AS holding_guid
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${search}
        ORDER BY le.name_client ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
  }

  const scope = v3EntityAssignmentScope(context, "ro", "retail");
  const orphanOnly = input.entity === "orphan_retail" ? " AND ro.guid_holding IS NULL" : "";
  const search = qPattern
    ? ` AND COALESCE(ro.address->>'store_address', '') ILIKE $${scope.params.length + 1} ESCAPE '\\'`
    : "";
  const params = [...scope.params];
  if (qPattern) params.push(qPattern);
  params.push(input.pageSize, offset);
  const total = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_v3_retail_outlets ro WHERE (${scope.clause})${orphanOnly}${search}`,
    qPattern ? [...scope.params, qPattern] : scope.params,
  );
  const rows = await query(
    `
      SELECT ro.guid_store::text AS guid,
             COALESCE(ro.address->>'store_address', ro.guid_store::text) AS name,
             ro.guid_holding::text AS holding_guid,
             ro.closed
      FROM onec_v3_retail_outlets ro
      WHERE (${scope.clause})${orphanOnly}${search}
      ORDER BY name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );
  return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
}
