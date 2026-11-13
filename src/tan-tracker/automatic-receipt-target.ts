import type { PoolClient } from "pg";
import { isExternalMessengerFeatureEnabled } from "./external-messenger/config";
import { recipientBotLinks } from "./external-messenger/direct-invitation";
import { isTanbotTelegramDeliveryEnabled } from "../tanbot-telegram/stage2-config";
import { isTanbotMaxDeliveryEnabled } from "../tanbot-max/stage2-config";
import { hasExternalMessengerIdentityConflict } from "./external-person/identity-conflict";

export type ReceiptChannel = "telegram" | "max";
export type ReceiptTarget = {
  channel: ReceiptChannel;
  userId: string;
  chatId: string;
  phone: string | null;
};

/** No unverified draft contact or rebindable MST session is a persistent identity proof. */
export async function automaticReceiptTargets(
  client: PoolClient,
  partyId: string,
): Promise<ReceiptTarget[]> {
  if (!isExternalMessengerFeatureEnabled()) return [];
  if (await hasExternalMessengerIdentityConflict(client, { partyId })) return [];
  const available = recipientBotLinks(`er${"x".repeat(43)}`);
  const rows = await client.query<{
    channel: ReceiptChannel;
    user_id: string;
    chat_id: string;
    phone: string | null;
  }>(
    `SELECT v.channel,v.messenger_user_id::text AS user_id,v.messenger_chat_id::text AS chat_id,p.phone_e164 AS phone
     FROM tt_parties p JOIN tt_external_persons ep ON ep.party_id=p.id AND ep.phone_e164=p.phone_e164
     JOIN tt_external_person_verifications v ON v.person_id=ep.id
     WHERE p.id=$1::uuid AND p.kind='external' AND v.notifications_enabled=TRUE AND v.opted_out_at IS NULL
     UNION ALL
     SELECT 'telegram',a.telegram_user_id::text,a.telegram_chat_id::text,p.phone_e164
     FROM tt_parties p JOIN users u ON u.id=p.user_id AND u.status='active'
     JOIN tanbot_telegram_accounts a ON a.user_id=u.id
     WHERE p.id=$1::uuid AND p.kind='user' AND a.notifications_enabled=TRUE AND a.stopped_at IS NULL
     UNION ALL
     SELECT 'max',a.max_user_id::text,a.max_chat_id::text,p.phone_e164
     FROM tt_parties p JOIN users u ON u.id=p.user_id AND u.status='active'
     JOIN tanbot_max_accounts a ON a.user_id=u.id
     WHERE p.id=$1::uuid AND p.kind='user' AND a.notifications_enabled=TRUE AND a.stopped_at IS NULL`,
    [partyId],
  );
  return rows.rows
    .filter(
      (r) =>
        available[r.channel] &&
        (r.channel === "telegram"
          ? isTanbotTelegramDeliveryEnabled()
          : isTanbotMaxDeliveryEnabled()) &&
        /^\d+$/.test(r.user_id) &&
        /^-?\d+$/.test(r.chat_id) &&
        (r.channel !== "telegram" || r.user_id === r.chat_id),
    )
    .map((r) => ({
      channel: r.channel,
      userId: r.user_id,
      chatId: r.chat_id,
      phone: r.phone,
    }));
}
