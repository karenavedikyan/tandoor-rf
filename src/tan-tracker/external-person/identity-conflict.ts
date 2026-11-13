import type { Pool, PoolClient } from "pg";

type Db = Pick<Pool, "query"> | PoolClient;

/**
 * Legacy external proofs and staff links live in separate tables. Never choose
 * the first of several identities, or trust a staff link for a different phone.
 * No mutation, guessed canonical identity or fallback to a different chat.
 */
export async function hasExternalMessengerIdentityConflict(
  client: Db,
  subject: { personId: string } | { partyId: string },
): Promise<boolean> {
  const column = "personId" in subject ? "id" : "party_id";
  const id = "personId" in subject ? subject.personId : subject.partyId;
  const result = await client.query<{ conflict: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM tt_external_persons ep
       JOIN tt_external_person_verifications v ON v.person_id=ep.id
       LEFT JOIN tanbot_max_accounts m ON v.channel='max' AND
         (m.max_user_id::text=v.messenger_user_id OR m.max_chat_id::text=v.messenger_chat_id)
       LEFT JOIN users mu ON mu.id=m.user_id
       LEFT JOIN tanbot_telegram_accounts g ON v.channel='telegram' AND
         (g.telegram_user_id::text=v.messenger_user_id OR g.telegram_chat_id::text=v.messenger_chat_id)
       LEFT JOIN users gu ON gu.id=g.user_id
       WHERE ep.${column}=$1::uuid
       AND (
         (SELECT COUNT(*) FROM tt_external_person_verifications other
          WHERE other.person_id=ep.id AND other.channel=v.channel)>1
         OR (m.user_id IS NOT NULL AND (mu.status<>'active' OR (mu.phone IS NOT NULL AND mu.phone<>ep.phone_e164)
           OR m.max_user_id::text<>v.messenger_user_id OR m.max_chat_id::text<>v.messenger_chat_id))
         OR (g.user_id IS NOT NULL AND (gu.status<>'active' OR (gu.phone IS NOT NULL AND gu.phone<>ep.phone_e164)
           OR g.telegram_user_id::text<>v.messenger_user_id OR g.telegram_chat_id::text<>v.messenger_chat_id))
       )
     ) AS conflict`,
    [id],
  );
  return result.rows[0]?.conflict === true;
}

/** Called under existing messenger + phone transaction locks before adding proof. */
export async function externalMessengerProofWouldConflict(
  client: Db,
  input: { phone: string; channel: "max" | "telegram"; userId: string; chatId: string },
): Promise<boolean> {
  const prefix = input.channel;
  const result = await client.query<{ conflict: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM tt_external_persons ep
         JOIN tt_external_person_verifications v ON v.person_id=ep.id
         WHERE ep.phone_e164=$1 AND v.channel=$2
           AND (v.messenger_user_id<>$3 OR v.messenger_chat_id<>$4)
       ) OR EXISTS (
         SELECT 1 FROM tanbot_${prefix}_accounts a JOIN users u ON u.id=a.user_id
         WHERE (a.${prefix}_user_id::text=$3 OR a.${prefix}_chat_id::text=$4)
           AND (u.status<>'active' OR (u.phone IS NOT NULL AND u.phone<>$1)
             OR a.${prefix}_user_id::text<>$3 OR a.${prefix}_chat_id::text<>$4)
       )
     ) AS conflict`,
    [input.phone, input.channel, input.userId, input.chatId],
  );
  return result.rows[0]?.conflict === true;
}
