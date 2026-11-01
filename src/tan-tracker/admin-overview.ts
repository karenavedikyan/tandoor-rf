import type { Pool, PoolClient } from "pg";
import { fanoutStaffTransferNotification } from "./staff-notify-fanout";

type Db = Pool | PoolClient;
export const ADMIN_CREATED_EVENT = "tan_tracker.admin_created" as const;
export const ADMIN_NOTIFICATION_MODES = ["off", "all", "staff", "external"] as const;
export type AdminNotificationMode = (typeof ADMIN_NOTIFICATION_MODES)[number];

export async function loadAdminOverview(db: Db, userId: string) {
  const preference = await db.query<{ mode: AdminNotificationMode }>(
    `SELECT mode FROM tt_admin_track_notification_preferences WHERE user_id=$1::uuid`, [userId],
  );
  const summary = await db.query<{
    total: number; staff: number; external: number; recent: number; previous: number; authors: number;
  }>(`
    WITH bounds AS (
      SELECT (date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') - interval '29 days')
        AT TIME ZONE 'Europe/Moscow' AS since
    )
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE NOT from_external)::int AS staff,
      COUNT(*) FILTER (WHERE from_external)::int AS external,
      COUNT(*) FILTER (WHERE created_at >= bounds.since)::int AS recent,
      COUNT(*) FILTER (WHERE created_at >= bounds.since - interval '30 days'
        AND created_at < bounds.since)::int AS previous,
      COUNT(DISTINCT creator_party_id) FILTER (WHERE created_at >= bounds.since)::int AS authors
    FROM tt_transfers CROSS JOIN bounds`);
  const daily = await db.query<{ day: string; staff: number; external: number }>(`
    WITH days AS (
      SELECT generate_series(
        (NOW() AT TIME ZONE 'Europe/Moscow')::date - 29,
        (NOW() AT TIME ZONE 'Europe/Moscow')::date, interval '1 day')::date AS day
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
      COUNT(t.id) FILTER (WHERE NOT t.from_external)::int AS staff,
      COUNT(t.id) FILTER (WHERE t.from_external)::int AS external
    FROM days d LEFT JOIN tt_transfers t
      ON t.created_at >= d.day::timestamp AT TIME ZONE 'Europe/Moscow'
      AND t.created_at < (d.day + 1)::timestamp AT TIME ZONE 'Europe/Moscow'
    GROUP BY d.day ORDER BY d.day`);
  return {
    notificationMode: preference.rows[0]?.mode ?? "off",
    summary: summary.rows[0], daily: daily.rows, timeZone: "Europe/Moscow",
  };
}

/** Call only inside a real creation transaction, never from bootstrap or handoff. */
export async function notifyAdminsOfNewTrack(client: PoolClient, transferId: string): Promise<void> {
  const transfer = await client.query<{
    public_code: string; item_title: string; from_external: boolean;
    creator_name: string; recipient_name: string;
  }>(`SELECT t.public_code,t.item_title,t.from_external,
      c.display_name AS creator_name,r.display_name AS recipient_name
    FROM tt_transfers t JOIN tt_parties c ON c.id=t.creator_party_id
    LEFT JOIN tt_parties r ON r.id=t.pending_party_id WHERE t.id=$1`, [transferId]);
  const t = transfer.rows[0];
  if (!t) return;
  const recipients = await client.query<{ user_id: string }>(
    `SELECT p.user_id::text FROM tt_admin_track_notification_preferences p
     JOIN users u ON u.id=p.user_id
     JOIN tt_transfers t ON t.id=$1
     WHERE u.role='admin' AND u.status='active' AND t.created_at >= p.enabled_since
       AND (p.mode='all' OR p.mode=$2)`,
    [transferId, t.from_external ? "external" : "staff"],
  );
  await fanoutStaffTransferNotification(client, {
    eventType: ADMIN_CREATED_EVENT,
    recipientUserIds: recipients.rows.map(r => r.user_id),
    payload: {
      transferId, publicCode: t.public_code, itemTitle: t.item_title, handoffVersion: 1,
      routeFromDisplayName: t.creator_name, routeToDisplayName: t.recipient_name,
      creatorKind: t.from_external ? "external" : "staff",
    },
  });
}

/** Rechecks subscription + role at delivery, independent of personal participation/custody. */
export async function canDeliverAdminCreated(client: PoolClient, userId: string, transferId: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM tt_admin_track_notification_preferences p
     JOIN users u ON u.id=p.user_id JOIN tt_transfers t ON t.id=$2
     WHERE p.user_id=$1::uuid AND u.role='admin' AND u.status='active'
       AND t.deleted_at IS NULL AND t.created_at >= p.enabled_since
       AND (p.mode='all' OR p.mode=CASE WHEN t.from_external THEN 'external' ELSE 'staff' END)`,
    [userId, transferId],
  );
  return result.rows[0]?.ok === true;
}
