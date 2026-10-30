import type { PoolClient } from "pg";
import type { ExternalMessengerChannel } from "./messenger-provenance";
import { requirePersonMessengerProvenance } from "./messenger-provenance";
import type { ExternalPersonMessengerEvent } from "./messenger-copy";

export type ExternalPersonOutboxDelivery = "all_verified" | "single_channel";

export async function enqueueExternalPersonMessengerNotice(
  client: PoolClient,
  input: {
    externalPartyId: string;
    body: string;
    idempotencyKey: string;
    eventType?: string;
    delivery?: ExternalPersonOutboxDelivery;
    preferredChannel?: ExternalMessengerChannel;
  },
): Promise<void> {
  const person = await client.query<{ id: string }>(
    `SELECT id::text FROM tt_external_persons WHERE party_id = $1::uuid LIMIT 1`,
    [input.externalPartyId],
  );
  const personId = person.rows[0]?.id;
  if (!personId) return;

  const eventType = input.eventType ?? "generic";
  const delivery = input.delivery ?? "all_verified";

  if (delivery === "single_channel") {
    const prov = await requirePersonMessengerProvenance(client, personId, input.preferredChannel);
    await insertOutboxRow(client, {
      personId,
      channel: prov.channel,
      messengerChatId: prov.messengerChatId,
      body: input.body,
      idempotencyKey: `${input.idempotencyKey}:${prov.channel}`,
      eventType,
    });
    return;
  }

  const channels = await client.query<{ channel: string; messenger_chat_id: string }>(
    `SELECT channel, messenger_chat_id FROM tt_external_person_verifications
     WHERE person_id = $1::uuid AND notifications_enabled = TRUE AND opted_out_at IS NULL`,
    [personId],
  );
  for (const ch of channels.rows) {
    await insertOutboxRow(client, {
      personId,
      channel: ch.channel,
      messengerChatId: ch.messenger_chat_id,
      body: input.body,
      idempotencyKey: `${input.idempotencyKey}:${ch.channel}`,
      eventType,
    });
  }
}

export async function enqueueExternalPersonMessengerEvent(
  client: PoolClient,
  input: {
    externalPartyId: string;
    publicCode: string;
    event: ExternalPersonMessengerEvent;
    body: string;
    idempotencyKey: string;
    preferredChannel?: ExternalMessengerChannel;
    singleChannel?: boolean;
  },
): Promise<void> {
  await enqueueExternalPersonMessengerNotice(client, {
    externalPartyId: input.externalPartyId,
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    eventType: `external_person.${input.event}`,
    delivery: input.singleChannel ? "single_channel" : "all_verified",
    preferredChannel: input.preferredChannel,
  });
}

async function insertOutboxRow(
  client: PoolClient,
  input: {
    personId: string;
    channel: string;
    messengerChatId: string;
    body: string;
    idempotencyKey: string;
    eventType: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO tt_external_person_message_outbox (
       person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, next_attempt_at
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, 'pending', NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      input.personId,
      input.channel,
      input.messengerChatId,
      input.body,
      input.idempotencyKey,
      input.eventType,
    ],
  );
}
