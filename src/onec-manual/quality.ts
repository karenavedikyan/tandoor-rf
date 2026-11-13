import { query } from "../db/pool";
import type { Kind } from "./model";
import type { AccessContext } from "../access/types";
import { v3EntityAssignmentScope } from "../clients/v3/access-scope";

export type QualityTarget = { kind: Kind; guid: string };
export async function visibleHoldingMemberQuality(context: AccessContext, holdingGuids: string[]) {
  if (!holdingGuids.length) return [];
  const scope = v3EntityAssignmentScope(context, "le");
  const clause = scope.clause.replace(/\$(\d+)/g, (_m, index) => `$${Number(index) + 1}`);
  return (await query<{ guid: string; checked_at: Date; batch_id: string }>(`
    SELECT DISTINCT ON (le.guid_holding) le.guid_holding::text AS guid,b.imported_at AS checked_at,b.id::text AS batch_id
    FROM onec_v3_legal_entities le JOIN onec_manual_object_versions v ON v.entity_kind='legal' AND v.entity_guid=le.guid_client
    JOIN onec_manual_issues i ON i.batch_id=v.batch_id AND i.entity_kind=v.entity_kind AND i.entity_guid=v.entity_guid AND i.file_key=v.file_key
    JOIN onec_manual_batches b ON b.id=i.batch_id
    WHERE le.guid_holding=ANY($1::uuid[]) AND (${clause})
    ORDER BY le.guid_holding,b.imported_at DESC`, [holdingGuids, ...scope.params])).rows;
}
export function qualityExistsSql(kind: Kind, guidSql: string): string {
  return `EXISTS(SELECT 1 FROM onec_manual_object_versions _qv
    JOIN onec_manual_issues _qi ON _qi.batch_id=_qv.batch_id AND _qi.entity_kind=_qv.entity_kind AND _qi.entity_guid=_qv.entity_guid AND _qi.file_key=_qv.file_key
    WHERE _qv.entity_kind='${kind}' AND _qv.entity_guid=(${guidSql})::uuid)`;
}
/** Caller must first establish visibility. Source variants use a strict own-field allowlist. */
export async function qualityForVisibleTargets(targets: QualityTarget[]) {
  const map = new Map<string, { batchId: string; checkedAt: string; issues: Array<{ code: string; field: string; message: string }>;
    variants?: Array<{ file: string; row: number; values: Record<string, unknown> }> }>();
  if (!targets.length) return map;
  try {
    const rows = await query<{ entity_kind: Kind; entity_guid: string; batch_id: string; imported_at: Date;
      code: string; field_name: string; message: string }>(`
      SELECT i.entity_kind,i.entity_guid::text,i.batch_id::text,b.imported_at,i.code,i.field_name,i.message
      FROM jsonb_to_recordset($1::jsonb) AS t(kind text,guid uuid)
      JOIN onec_manual_object_versions v ON v.entity_kind=t.kind AND v.entity_guid=t.guid
      JOIN onec_manual_issues i ON i.entity_kind=v.entity_kind AND i.entity_guid=v.entity_guid AND i.batch_id=v.batch_id AND i.file_key=v.file_key
      JOIN onec_manual_batches b ON b.id=i.batch_id
      ORDER BY i.issue_key`, [JSON.stringify(targets)]);
    for (const row of rows.rows) {
      const key = row.entity_kind + ":" + row.entity_guid;
      const value = map.get(key) ?? { batchId: row.batch_id, checkedAt: row.imported_at.toISOString(), issues: [] };
      // A client may have thousands of item-line warnings: one safe explanation per kind/field.
      if (!value.issues.some(issue => issue.code === row.code && issue.field === row.field_name))
        value.issues.push({ code: row.code, field: row.field_name, message: row.message });
      map.set(key, value);
    }
    // Source fields explicitly match already-visible entity detail fields. Never include
    // assignments, compositions or foreign object identifiers/names in this endpoint.
    const safeFields: Partial<Record<Kind, string[]>> = {
      legal: ["guid_client", "name_client", "inn", "kpp", "address", "telephone"],
      holding: ["guid_holding", "name_holding", "retail_chain", "holding_group"],
      retail: ["guid_store", "warehouse", "closed", "address"],
      product: ["guid", "name", "guid_group", "name_group"],
    };
    const conflicts = targets.filter(t => map.get(t.kind + ":" + t.guid)?.issues.some(i =>
      ["DUPLICATE_GUID", "INN_CONFLICT", "INN_MISMATCH", "DUPLICATE_SALES_KEY"].includes(i.code)));
    if (conflicts.length) {
      const variants = await query<{ entity_kind: Kind; entity_guid: string; file_key: string; row_index: number; record: Record<string, unknown> }>(`
        SELECT picked.* FROM jsonb_to_recordset($1::jsonb) AS t(kind text,guid uuid)
        CROSS JOIN LATERAL(SELECT r.entity_kind,r.entity_guid::text,r.file_key,r.row_index,r.record
          FROM onec_manual_object_versions v JOIN onec_manual_records r
          ON r.batch_id=v.batch_id AND r.file_key=v.file_key AND r.entity_kind=v.entity_kind AND r.entity_guid=v.entity_guid
          WHERE v.entity_kind=t.kind AND v.entity_guid=t.guid ORDER BY r.file_key,r.row_index LIMIT 20) picked`,
      [JSON.stringify(conflicts)]);
      for (const row of variants.rows) {
        const value = map.get(row.entity_kind + ":" + row.entity_guid);
        if (!value) continue;
        const fields = safeFields[row.entity_kind] ?? [];
        const values: Record<string, unknown> = {};
        for (const field of fields) if (Object.hasOwn(row.record, field)) values[field] = row.record[field];
        // Operation client_info INN/KPP are own identifiers, not foreign link/manager data.
        if (["sales", "saleItems", "returns", "returnItems"].includes(row.file_key)) {
          const info = row.record.client_info as Record<string, unknown> | undefined;
          for (const field of ["inn", "kpp"]) if (info && Object.hasOwn(info, field)) values[field] = info[field];
        }
        if (Object.keys(values).length) (value.variants ??= []).push({ file: row.file_key, row: row.row_index + 1, values });
      }
    }
  } catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
    // Backward-compatible reads before migration; never silently hides DB errors after schema exists.
  }
  return map;
}
