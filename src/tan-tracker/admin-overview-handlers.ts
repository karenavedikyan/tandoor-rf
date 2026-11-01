import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { requireTanTrackerMutationAccess } from "./guards";
import { ADMIN_CREATED_EVENT, ADMIN_NOTIFICATION_MODES, type AdminNotificationMode } from "./admin-overview";

export async function updateAdminTrackNotifications(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  setNoStore(res);
  if (gate.user.role !== "admin" || gate.access.preview?.active) {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Настройка доступна только администратору вне режима просмотра."));
    return;
  }
  const mode = req.body?.mode;
  if (!ADMIN_NOTIFICATION_MODES.includes(mode as AdminNotificationMode)
      || Object.keys(req.body ?? {}).some(k => k !== "mode")) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Выберите допустимый режим уведомлений."));
    return;
  }
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tt_admin_track_notification_preferences (user_id,mode,enabled_since)
       VALUES ($1::uuid,$2,clock_timestamp())
       ON CONFLICT (user_id) DO UPDATE SET mode=EXCLUDED.mode,updated_at=clock_timestamp(),
         enabled_since=CASE WHEN tt_admin_track_notification_preferences.mode=EXCLUDED.mode
           THEN tt_admin_track_notification_preferences.enabled_since ELSE clock_timestamp() END`,
      [gate.user.id, mode],
    );
    // Pending old-mode alerts must not reappear when the administrator enables again.
    await client.query(
      `UPDATE tanbot_notification_outbox o SET status='cancelled',last_error_code='ADMIN_PREFERENCE_CHANGED'
       FROM tt_admin_track_notification_preferences p
       WHERE o.user_id=$1::uuid AND p.user_id=o.user_id AND o.event_type=$2
         AND o.status='pending'
         AND (p.mode='off' OR NOT EXISTS (
           SELECT 1 FROM tt_transfers t WHERE t.id=o.payload->>'transferId'
             AND t.created_at>=p.enabled_since AND t.deleted_at IS NULL
             AND (p.mode='all' OR p.mode=CASE WHEN t.from_external THEN 'external' ELSE 'staff' END)))`,
      [gate.user.id, ADMIN_CREATED_EVENT],
    );
    await client.query("COMMIT");
    res.status(200).json({ notificationMode: mode });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
