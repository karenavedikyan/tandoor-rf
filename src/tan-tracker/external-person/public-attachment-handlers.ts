import type { Request, Response } from "express";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { resolveExternalPersonAuth } from "./resolve-auth";
import { loadExternalPersonOrders } from "./external-person-orders";

export async function publicExternalAttachmentHandler(req: Request, res: Response): Promise<void> {
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const person = await resolveExternalPersonAuth(pool, {
    est: String(req.query.est ?? ""),
    cap: String(req.query.cap ?? ""),
  });
  if (!person) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна."));
    return;
  }
  const transferId = String(req.query.transferId ?? "").trim();
  const attId = String(req.params.attId ?? "").trim();
  const orders = await loadExternalPersonOrders(pool, person.partyId);
  const order = orders.find((o) => o.id === transferId);
  const att = order?.attachments?.find((a) => a.id === attId);
  if (!order || !att) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нет доступа к вложению."));
    return;
  }
  const row = (
    await pool.query<{ storage_key: string; original_name: string; mime_type: string }>(
      `SELECT storage_key, original_name, mime_type FROM tt_transfer_attachments
       WHERE id = $1::uuid AND transfer_id = $2 AND uploaded_by_user_id IS NULL LIMIT 1`,
      [attId, transferId],
    )
  ).rows[0];
  if (!row) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Вложение не найдено."));
    return;
  }
  const { loadAttachmentServePayload } = await import("../attachment-preview");
  const { resolveAttachmentContentDisposition } = await import("../attachments");
  const query = req.query as Record<string, unknown>;
  const { buffer, contentType } = await loadAttachmentServePayload(row.storage_key, row.mime_type, query, pool);
  const disposition = resolveAttachmentContentDisposition(row.mime_type, query);
  setNoStore(res);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", disposition);
  res.status(200).send(buffer);
}
