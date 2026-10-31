import type { PoolClient } from "pg";
import { transferIdsWithConfirmedFirstCustodyAudit } from "./custody-state";
import { resolvePartyDisplayNameForNotification, sanitizeNotificationDisplayName } from "./staff-notification-route";

export type NotificationTransferState = {
  phase: "ready" | "waiting" | "received" | "done";
  holderName?: string;
  pendingName?: string;
};

/** A frozen event-time snapshot. Delivery must never re-read today's holder for an old event. */
export async function buildNotificationTransferState(
  client: PoolClient, transferId: string,
): Promise<NotificationTransferState | undefined> {
  const row = (await client.query<{
    id: string; status: string; holder_party_id: string; pending_party_id: string | null; first_custody_at: Date | null;
  }>(
    `SELECT id,status,holder_party_id,pending_party_id,first_custody_at FROM tt_transfers WHERE id=$1 LIMIT 1`,
    [transferId],
  )).rows[0];
  if (!row) return undefined;
  const phase = row.status === "completed" ? "done" : row.pending_party_id ? "waiting" :
    row.status === "delivered" || row.first_custody_at != null ||
    (await transferIdsWithConfirmedFirstCustodyAudit(client, [row.id])).has(row.id) ? "received" : "ready";
  const holderName = await resolvePartyDisplayNameForNotification(client, row.holder_party_id);
  const pendingName = phase === "waiting"
    ? await resolvePartyDisplayNameForNotification(client, row.pending_party_id) : null;
  return { phase, ...(holderName ? { holderName } : {}), ...(pendingName ? { pendingName } : {}) };
}

export function normalizeNotificationTransferState(value: unknown): NotificationTransferState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.phase !== "string" || !["ready", "waiting", "received", "done"].includes(v.phase)) return undefined;
  const holderName = typeof v.holderName === "string" ? sanitizeNotificationDisplayName(v.holderName) : null;
  const pendingName = v.phase === "waiting" && typeof v.pendingName === "string"
    ? sanitizeNotificationDisplayName(v.pendingName) : null;
  return { phase: v.phase as NotificationTransferState["phase"],
    ...(holderName ? { holderName } : {}), ...(pendingName ? { pendingName } : {}) };
}

export function formatNotificationTransferState(value: NotificationTransferState | undefined): string {
  const state = normalizeNotificationTransferState(value);
  if (!state) return "";
  const label = state.phase === "done" ? "Завершена" :
    state.phase === "received" ? "Получение подтверждено" :
    state.phase === "waiting" ? `Ожидает приёма · ${state.pendingName || "Получатель не указан"}` : "Ожидает передачи";
  return `Статус: ${label}\n${state.phase === "done" ? "Последний держатель" : "Ответственный"}: ${state.holderName || "Не указан"}`;
}
