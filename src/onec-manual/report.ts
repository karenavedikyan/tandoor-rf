import type { Request, Response } from "express";
import { query } from "../db/pool";
import { FILES } from "./model";
import { GUID } from "../internal-catalog/model";

/** Mounted behind database/auth/admin middleware; never supplies access to object APIs. */
export async function manualReport(req: Request, res: Response) {
  res.set("Cache-Control", "no-store");
  const batch = String(req.query.batch ?? ""), file = String(req.query.file ?? ""), page = Number(req.query.page ?? 1);
  if ((batch && !GUID.test(batch)) || (file && !(file in FILES)) || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Проверьте параметры отчёта." } }); return;
  }
  const active = (await query(`SELECT b.* FROM onec_manual_batches b
    ${batch ? "WHERE b.id=$1::uuid" : "JOIN onec_manual_state s ON s.batch_id=b.id WHERE s.id=1"}`, batch ? [batch] : [])).rows[0];
  if (!active) { res.json({ batch: null, issues: [], records: [], total: 0, page }); return; }
  const params = [active.id, ...(file ? [file] : [])];
  const where = `batch_id=$1::uuid${file ? " AND file_key=$2" : ""}`;
  const total = Number((await query(`SELECT COUNT(*) FROM onec_manual_records WHERE ${where}`, params)).rows[0].count);
  const records = await query(`SELECT file_key,row_index,entity_kind,entity_guid,record FROM onec_manual_records
    WHERE ${where} ORDER BY file_key,row_index LIMIT 100 OFFSET $${params.length + 1}`, [...params, (page - 1) * 100]);
  const issues = await query(`SELECT i.file_key,i.row_indices,i.entity_kind,i.entity_guid,i.field_name,i.code,i.message
    FROM onec_manual_issues i WHERE i.batch_id=$1 AND EXISTS(
      SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r(file_key text,row_index integer)
      WHERE r.file_key=i.file_key AND i.row_indices @> to_jsonb(r.row_index))
    ORDER BY i.file_key,i.issue_key`, [active.id, JSON.stringify(records.rows)]);
  res.json({ batch: active, records: records.rows, issues: issues.rows, total, page, pageSize: 100 });
}
