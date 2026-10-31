import type { PoolClient } from "pg";
import { insertLkNotification } from "./lk-notifications";
import { enqueueNotificationOutbox, type OutboxChannel } from "../tanbot-telegram/outbox";
import type { StaffNotificationPayload, StaffTransferEventType } from "./staff-notification-copy";
import { staffNotificationLkCopy } from "./staff-notification-copy";
import { resolveUserIdForParty } from "../tanbot-telegram/outbox";

const CHANNELS: OutboxChannel[] = ["telegram", "max"];

function idempotencyKey(
  eventType: StaffTransferEventType,
  transferId: string,
  handoffVersion: number,
  channel: OutboxChannel,
  userId: string,
): string {
  const slug = eventType.replace("tan_tracker.", "");
  return `tt-staff:${slug}:${transferId}:hv:${handoffVersion}:${channel}:${userId}`;
}

export async function uniqueStaffUserIdsFromParties(
  client: PoolClient,
  partyIds: Array<string | null | undefined>,
): Promise<string[]> {
  const out = new Set<string>();
  for (const pid of partyIds) {
    if (!pid) continue;
    const uid = await resolveUserIdForParty(client, pid);
    if (uid) out.add(uid);
  }
  return [...out];
}

/** LK bell + telegram/max outbox for the same staff event (respects messenger opt-in at delivery). */
export async function fanoutStaffTransferNotification(
  client: PoolClient,
  input: {
    eventType: StaffTransferEventType;
    recipientUserIds: string[];
    payload: StaffNotificationPayload;
    lkIdempotencySuffix?: string;
  },
): Promise<void> {
  const deduped = [...new Set(input.recipientUserIds.filter(Boolean))];
  if (!deduped.length) return;
  const lkCopy = staffNotificationLkCopy(input.eventType, input.payload);
  const payloadJson = {
    transferId: input.payload.transferId,
    publicCode: input.payload.publicCode,
    itemTitle: input.payload.itemTitle,
    handoffVersion: input.payload.handoffVersion,
    ...(input.payload.reason != null ? { reason: input.payload.reason } : {}),
    ...(input.payload.routeFromDisplayName ? { routeFromDisplayName: input.payload.routeFromDisplayName } : {}),
    ...(input.payload.routeToDisplayName ? { routeToDisplayName: input.payload.routeToDisplayName } : {}),
  };

  for (const userId of deduped) {
    const lkKey =
      input.lkIdempotencySuffix != null
        ? `tt-lk-${input.eventType.replace("tan_tracker.", "")}:${input.payload.transferId}:hv:${input.payload.handoffVersion}:${userId}:${input.lkIdempotencySuffix}`
        : `tt-lk-${input.eventType.replace("tan_tracker.", "")}:${input.payload.transferId}:hv:${input.payload.handoffVersion}:${userId}`;
    await insertLkNotification(client, {
      userId,
      transferId: input.payload.transferId,
      eventType: input.eventType,
      title: lkCopy.title,
      body: lkCopy.body,
      idempotencyKey: lkKey,
    });
    for (const channel of CHANNELS) {
      await enqueueNotificationOutbox(client, {
        idempotencyKey: idempotencyKey(
          input.eventType,
          input.payload.transferId,
          input.payload.handoffVersion,
          channel,
          userId,
        ),
        userId,
        channel,
        eventType: input.eventType,
        payload: payloadJson,
      });
    }
  }
}

export function transferPayload(input: {
  transferId: string;
  publicCode: string;
  itemTitle: string;
  handoffVersion: number;
  reason?: string | null;
}): StaffNotificationPayload {
  return {
    transferId: input.transferId,
    publicCode: input.publicCode,
    itemTitle: input.itemTitle,
    handoffVersion: input.handoffVersion,
    reason: input.reason,
  };
}
