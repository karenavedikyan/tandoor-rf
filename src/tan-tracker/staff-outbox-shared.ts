import type { PoolClient } from "pg";

export type StaffOutboxPayload = {
  transferId: string;
  publicCode: string;
  itemTitle: string;
  handoffVersion: number;
};

export function normalizeStaffOutboxPayload(payload: Record<string, unknown>): StaffOutboxPayload {
  return {
    transferId: String(payload.transferId ?? ""),
    publicCode: String(payload.publicCode ?? ""),
    itemTitle: String(payload.itemTitle ?? "Передача"),
    handoffVersion: Number(payload.handoffVersion ?? 0),
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
  itemTitle: string,
  publicCode: string,
  pilotEnabled: boolean,
): string {
  const item = itemTitle.trim() || "Передача";
  if (pilotEnabled) {
    return (
      `Тан-трекер: вам передают «${item}» (${publicCode}).\n` +
      `Кнопка ниже выдаст одноразовый код приёма. Когда получите предмет в руки, сообщите код отправителю: он введёт его и подтвердит передачу.`
    );
  }
  return (
    `Тан-трекер: вам передают «${item}» (${publicCode}).\n` +
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
