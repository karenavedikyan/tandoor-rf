import type { PoolClient } from "pg";
import type { ExternalMessengerChannel } from "./messenger-provenance";

/** Per-channel opt-out: does not touch staff tanbot_* accounts or other messenger channels. */
export async function revokeExternalPersonMessengerChannel(
  client: PoolClient,
  input: { channel: ExternalMessengerChannel; messengerUserId: bigint },
): Promise<{ personId: string | null }> {
  const row = await client.query<{ person_id: string }>(
    `UPDATE tt_external_person_verifications
     SET notifications_enabled = FALSE, opted_out_at = NOW()
     WHERE channel = $1 AND messenger_user_id = $2
     RETURNING person_id::text`,
    [input.channel, input.messengerUserId.toString()],
  );
  const personId = row.rows[0]?.person_id ?? null;
  if (!personId) return { personId: null };

  await client.query(
    `UPDATE tt_external_person_sessions SET revoked_at = NOW()
     WHERE person_id = $1::uuid AND channel = $2 AND revoked_at IS NULL`,
    [personId, input.channel],
  );

  await client.query(
    `UPDATE tt_external_person_message_outbox SET status = 'cancelled', last_error_code = 'OPTED_OUT'
     WHERE person_id = $1::uuid AND channel = $2 AND status IN ('pending', 'processing')`,
    [personId, input.channel],
  );

  await client.query(
    `DELETE FROM tt_external_request_drafts
     WHERE person_id = $1::uuid AND channel = $2`,
    [personId, input.channel],
  );

  return { personId };
}

export function externalMessengerStopReply(channel: ExternalMessengerChannel): string {
  if (channel === "max") {
    return "Уведомления MAX для внешних передач отключены. Чтобы снова получать сообщения, пройдите привязку номера в боте.";
  }
  return "Уведомления Telegram для внешних передач отключены. Чтобы снова получать сообщения, пройдите привязку номера в боте.";
}
