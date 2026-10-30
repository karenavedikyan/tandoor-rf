import type { Request, Response } from "express";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { requireTanTrackerMutationAccess, requireTanTrackerNavAccess } from "./guards";

export async function listLkNotificationsHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerNavAccess(req, res);
  if (!gate) return;
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const unreadOnly = String(req.query.unread ?? "") === "1";
  const rows = await pool.query<{
    id: string;
    transfer_id: string | null;
    event_type: string;
    title: string;
    body: string;
    created_at: Date;
    read_at: Date | null;
  }>(
    `SELECT id::text, transfer_id, event_type, title, body, created_at, read_at
     FROM tt_lk_notifications
     WHERE user_id = $1::uuid ${unreadOnly ? "AND read_at IS NULL" : ""}
     ORDER BY created_at DESC
     LIMIT 50`,
    [gate.user.id],
  );
  setNoStore(res);
  res.status(200).json({
    items: rows.rows.map((r) => ({
      id: r.id,
      transferId: r.transfer_id,
      eventType: r.event_type,
      title: r.title,
      body: r.body,
      createdAt: r.created_at.getTime(),
      readAt: r.read_at?.getTime() ?? null,
    })),
  });
}

export async function markLkNotificationsReadHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const ids = Array.isArray((req.body as { ids?: string[] })?.ids)
    ? ((req.body as { ids: string[] }).ids ?? []).slice(0, 50)
    : [];
  if (ids.length) {
    await pool.query(
      `UPDATE tt_lk_notifications SET read_at = NOW()
       WHERE user_id = $1::uuid AND id = ANY($2::uuid[]) AND read_at IS NULL`,
      [gate.user.id, ids],
    );
  } else {
    await pool.query(
      `UPDATE tt_lk_notifications SET read_at = NOW() WHERE user_id = $1::uuid AND read_at IS NULL`,
      [gate.user.id],
    );
  }
  setNoStore(res);
  res.status(200).json({ ok: true });
}
