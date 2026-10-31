import type { PoolClient } from "pg";
import { staffNotificationContextBlock, type StaffNotificationPayload } from "./staff-notification-copy";

export type StaffOutboxPayload = StaffNotificationPayload;

export function normalizeStaffOutboxPayload(payload: Record<string, unknown>): StaffOutboxPayload {
  return {
    transferId: String(payload.transferId ?? ""),
    publicCode: String(payload.publicCode ?? ""),
    itemTitle: String(payload.itemTitle ?? "Передача"),
    handoffVersion: Number(payload.handoffVersion ?? 0),
    reason: payload.reason != null ? String(payload.reason) : null,
    routeFromDisplayName:
      typeof payload.routeFromDisplayName === "string" ? payload.routeFromDisplayName : undefined,
    routeToDisplayName:
      typeof payload.routeToDisplayName === "string" ? payload.routeToDisplayName : undefined,
  };
}

/** Deep link to LK transfer card (fallback when handoff-code pilot is off). */
export function staffTransferLkDetailUrl(appOrigin: string, publicCode: string): string {
  const base = appOrigin.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("tt_screen", "detail");
  params.set("tt_id", publicCode);
  return `${base}/tan-tracker#?${params.toString()}`;
}

export function buildStaffExternalCreatedNoticeText(
  payload: StaffOutboxPayload,
  pilotEnabled: boolean,
): string {
  const ctx = staffNotificationContextBlock(payload);
  if (pilotEnabled) {
    return (
      `${ctx}\n\n` +
      `Вам передают от клиента.\n` +
      `Кнопка ниже выдаст одноразовый код приёма. Когда получите предмет в руки, сообщите код отправителю: он введёт его и подтвердит передачу.`
    );
  }
  return (
    `${ctx}\n\n` +
    `Вам передают от клиента.\n` +
    `Получите код приёма в личном кабинете и сообщите его отправителю, когда предмет будет у вас.`
  );
}

/** True when transfer is still waiting/active with this user as pending staff recipient. */
export async function isStaffExternalIntakeOutboxStillPending(
  client: PoolClient,
  transferId: string,
  handoffVersion: number,
  userId: string,
): Promise<boolean> {
  if (!transferId || !Number.isFinite(handoffVersion) || handoffVersion <= 0) {
    return false;
  }
  const intended = await client.query(
    `SELECT 1 FROM tt_transfers t
     JOIN tt_parties p ON p.id=t.pending_party_id AND p.kind='user'
     WHERE t.id=$1 AND t.handoff_version=$2 AND p.user_id=$3::uuid
       AND t.status IN ('waiting','active')`,
    [transferId, handoffVersion, userId],
  );
  return intended.rows.length > 0;
}
