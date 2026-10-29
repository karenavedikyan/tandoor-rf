import type { PoolClient } from "pg";

export type OutboxChannel = "telegram";

export type TanTrackerAssignmentPayload = {
  transferId: string;
  publicCode: string;
  itemTitle: string;
  handoffVersion: number;
};

export async function enqueueNotificationOutbox(
  client: PoolClient,
  input: {
    idempotencyKey: string;
    userId: string;
    channel: OutboxChannel;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO tanbot_notification_outbox (idempotency_key, user_id, channel, event_type, payload)
     VALUES ($1, $2::uuid, $3, $4, $5::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [input.idempotencyKey, input.userId, input.channel, input.eventType, JSON.stringify(input.payload)],
  );
}

export async function enqueueTanTrackerAssignmentTelegram(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    handoffVersion: number;
    holderUserId: string;
  },
): Promise<void> {
  const idempotencyKey = `tt-assignment:${input.transferId}:hv:${input.handoffVersion}:telegram:${input.holderUserId}`;
  await enqueueNotificationOutbox(client, {
    idempotencyKey,
    userId: input.holderUserId,
    channel: "telegram",
    eventType: "tan_tracker.assignment",
    payload: {
      transferId: input.transferId,
      publicCode: input.publicCode,
      itemTitle: input.itemTitle,
      handoffVersion: input.handoffVersion,
    },
  });
}

export async function resolveUserIdForParty(client: PoolClient, partyId: string): Promise<string | null> {
  const row = await client.query<{ user_id: string }>(
    `SELECT user_id::text FROM tt_parties WHERE id = $1::uuid AND kind = 'user' AND user_id IS NOT NULL`,
    [partyId],
  );
  return row.rows[0]?.user_id ?? null;
}
