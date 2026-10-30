import type { PoolClient } from "pg";

export async function insertLkNotification(
  client: PoolClient,
  input: {
    userId: string;
    transferId: string | null;
    eventType: string;
    title: string;
    body: string;
    idempotencyKey: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO tt_lk_notifications (user_id, transfer_id, event_type, title, body, idempotency_key)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [input.userId, input.transferId, input.eventType, input.title, input.body, input.idempotencyKey],
  );
}

export async function enqueueExternalDeclinedNotification(
  client: PoolClient,
  input: { transferId: string; staffUserId: string; itemTitle: string; reason: string | null },
): Promise<void> {
  await insertLkNotification(client, {
    userId: input.staffUserId,
    transferId: input.transferId,
    eventType: "tan_tracker.external_declined",
    title: "Заявка отклонена",
    body: input.reason ? input.itemTitle + ": " + input.reason : input.itemTitle,
    idempotencyKey: `tt-ext-decline-lk:${input.transferId}:${input.staffUserId}`,
  });
}

export async function enqueueExternalCreatedNotifications(
  client: PoolClient,
  input: { transferId: string; staffUserId: string; externalPartyId: string; itemTitle: string },
): Promise<void> {
  await insertLkNotification(client, {
    userId: input.staffUserId,
    transferId: input.transferId,
    eventType: "tan_tracker.external_created",
    title: "Вам передают от клиента",
    body: input.itemTitle,
    idempotencyKey: `tt-ext-created:${input.transferId}:${input.staffUserId}`,
  });
}
