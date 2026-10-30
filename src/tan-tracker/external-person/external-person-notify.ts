import type { PoolClient } from "pg";

export async function enqueueExternalPersonMessengerNotice(
  client: PoolClient,
  input: {
    externalPartyId: string;
    body: string;
    idempotencyKey: string;
  },
): Promise<void> {
  const person = await client.query<{ id: string }>(
    `SELECT id::text FROM tt_external_persons WHERE party_id = $1::uuid LIMIT 1`,
    [input.externalPartyId],
  );
  const personId = person.rows[0]?.id;
  if (!personId) return;
  const channels = await client.query<{ channel: string; messenger_chat_id: string }>(
    `SELECT channel, messenger_chat_id FROM tt_external_person_verifications WHERE person_id = $1::uuid`,
    [personId],
  );
  for (const ch of channels.rows) {
    await client.query(
      `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key)
       VALUES ($1::uuid, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [personId, ch.channel, ch.messenger_chat_id, input.body, `${input.idempotencyKey}:${ch.channel}`],
    );
  }
}
