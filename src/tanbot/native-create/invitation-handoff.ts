import type { PoolClient } from "pg";
import { formatNotificationTransferState } from "../../tan-tracker/notification-transfer-state";
import { getAppOrigin } from "../../config";
import { mintExternalMessengerSession } from "../../tan-tracker/external-messenger/session-service";

export function formatForwardableRecipientInvitation(input: {
  publicCode: string;
  senderName: string;
  recipientName: string;
  item: string;
  portalUrl: string;
}): string {
  const line = (value: string, limit = 160) => value.replace(/\s+/gu, " ").trim().slice(0, limit);
  return [
    "Тандор · Вам передают предмет",
    "",
    `Передача: ${line(input.publicCode)}`,
    `Отправитель: ${line(input.senderName)}`,
    `Получатель: ${line(input.recipientName)}`,
    `Предмет: ${line(input.item, 500)}`,
    "",
    formatNotificationTransferState({ phase: "waiting", holderName: input.senderName, pendingName: input.recipientName }),
    "",
    "Откройте ссылку, посмотрите детали и получите код приёма. Вход в личный кабинет не нужен.",
    "Сообщите код отправителю при получении посылки. Отправитель введёт его, чтобы подтвердить передачу.",
    "",
    `Посмотреть передачу и получить код: ${input.portalUrl}`,
  ].join("\n");
}

/** Canonical holder invitation for external pending party (same session mint as LK). */
export async function buildExternalPendingInviteMessage(
  client: PoolClient,
  input: {
    transferId: string;
    pendingPartyId: string;
    handoffVersion: number;
    channel: "telegram" | "max";
  },
): Promise<string | null> {
  const context = await client.query<{
    public_code: string; item_title: string; sender_name: string; recipient_name: string;
  }>(
    `SELECT t.public_code, t.item_title, h.display_name AS sender_name, p.display_name AS recipient_name
     FROM tt_transfers t
     JOIN tt_parties h ON h.id = t.holder_party_id
     JOIN tt_parties p ON p.id = t.pending_party_id
     WHERE t.id = $1 AND t.pending_party_id = $2::uuid AND t.handoff_version = $3`,
    [input.transferId, input.pendingPartyId, input.handoffVersion],
  );
  const transfer = context.rows[0];
  if (!transfer) return null;
  const minted = await mintExternalMessengerSession(client, {
    transferId: input.transferId,
    pendingPartyId: input.pendingPartyId,
    handoffVersion: input.handoffVersion,
  });
  if (!minted) return null;
  const origin = getAppOrigin() ?? "";
  const portalPath = `/tan-tracker/recipient?mst=${encodeURIComponent(minted.startToken)}`;
  const portalUrl = origin ? `${origin}${portalPath}` : portalPath;
  return formatForwardableRecipientInvitation({
    publicCode: transfer.public_code,
    senderName: transfer.sender_name,
    recipientName: transfer.recipient_name,
    item: transfer.item_title,
    portalUrl,
  });
}
