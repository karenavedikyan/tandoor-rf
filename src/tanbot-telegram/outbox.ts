import type { PoolClient } from "pg";
import { listMessengerAccounts } from "../tanbot/messenger-accounts";

export type OutboxChannel = "telegram" | "max";

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
  const accounts = await listMessengerAccounts(client, input.channel, input.userId);
  // Preserve the old key and primary-only meaning, including pending pre-upgrade jobs.
  // Additional recipients have immutable individual targets and retry state.
  const targets = [
    { key: input.idempotencyKey, id: accounts.find(a => a.is_primary)?.messenger_user_id ?? null },
    ...accounts.filter(a => !a.is_primary && !a.stopped_at && a.notifications_enabled)
      .map(a => ({ key: `${input.idempotencyKey}:account:${a.messenger_user_id}`, id: a.messenger_user_id })),
  ];
  for (const target of targets) {
    await client.query(
      `INSERT INTO tanbot_notification_outbox
        (idempotency_key, user_id, channel, event_type, payload,target_messenger_user_id)
       VALUES ($1, $2::uuid, $3, $4, $5::jsonb,$6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [target.key,input.userId,input.channel,input.eventType,JSON.stringify(input.payload),target.id]);
  }
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

export async function enqueueTanTrackerAssignmentMax(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    handoffVersion: number;
    holderUserId: string;
  },
): Promise<void> {
  const idempotencyKey = `tt-assignment:${input.transferId}:hv:${input.handoffVersion}:max:${input.holderUserId}`;
  await enqueueNotificationOutbox(client, {
    idempotencyKey,
    userId: input.holderUserId,
    channel: "max",
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
