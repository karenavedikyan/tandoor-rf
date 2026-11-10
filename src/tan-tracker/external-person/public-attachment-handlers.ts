import type { Request, Response } from "express";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { resolveExternalPersonAuth } from "./resolve-auth";
import { loadExternalPersonOrders } from "./external-person-orders";
import { contentDispositionFilename, resolveAttachmentContentDisposition } from "../attachments";

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
      `SELECT a.storage_key, a.original_name, a.mime_type
       FROM tt_transfer_attachments a JOIN tt_transfers t ON t.id = a.transfer_id
       WHERE a.id = $1::uuid AND t.public_code = $2 LIMIT 1`,
      [attId, transferId],
    )
  ).rows[0];
  if (!row) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Вложение не найдено."));
    return;
  }
  const { loadAttachmentServePayload } = await import("../attachment-preview");
  const query = req.query as Record<string, unknown>;
  const { buffer, contentType } = await loadAttachmentServePayload(row.storage_key, row.mime_type, query, pool);
  const disposition = resolveAttachmentContentDisposition(row.mime_type, query);
  setNoStore(res);
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", contentDispositionFilename(row.original_name, disposition));
  res.status(200).send(buffer);
}
