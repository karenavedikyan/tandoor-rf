import type { PoolClient } from "pg";
import { insertLkNotification } from "./lk-notifications";
import { resolveUserIdForParty } from "../tanbot-telegram/outbox";

async function partyUserId(client: PoolClient, partyId: string | null | undefined): Promise<string | null> {
  if (!partyId) return null;
  return resolveUserIdForParty(client, partyId);
}

/** Dedupe staff user ids (same person in multiple roles on one transfer). */
export async function uniqueStaffUserIds(client: PoolClient, partyIds: Array<string | null | undefined>): Promise<string[]> {
  const out = new Set<string>();
  for (const pid of partyIds) {
    const uid = await partyUserId(client, pid);
    if (uid) out.add(uid);
  }
  return [...out];
}

export async function notifyTransferAssignmentLk(
  client: PoolClient,
  input: { transferId: string; publicCode: string; itemTitle: string; holderUserId: string; handoffVersion: number },
): Promise<void> {
  await insertLkNotification(client, {
    userId: input.holderUserId,
    transferId: input.transferId,
    eventType: "tan_tracker.assignment",
    title: "Вам назначена передача",
    body: `${input.itemTitle} (${input.publicCode})`,
    idempotencyKey: `tt-lk-assignment:${input.transferId}:hv:${input.handoffVersion}:${input.holderUserId}`,
  });
}

export async function notifyCodeGeneratedLk(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    holderPartyId: string;
    pendingPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const holderUserId = await partyUserId(client, input.holderPartyId);
  if (!holderUserId) return;
  await insertLkNotification(client, {
    userId: holderUserId,
    transferId: input.transferId,
    eventType: "tan_tracker.code_obtained",
    title: "Получатель запросил код",
    body: `${input.itemTitle} (${input.publicCode})`,
    idempotencyKey: `tt-lk-code-obtained:${input.transferId}:hv:${input.handoffVersion}:${holderUserId}`,
  });
}

export async function notifyHandoffConfirmedLk(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    previousHolderPartyId: string;
    newHolderPartyId: string;
    creatorPartyId: string;
    handoffVersion: number;
    delivered: boolean;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIds(client, [
    input.previousHolderPartyId,
    input.newHolderPartyId,
    input.creatorPartyId,
  ]);
  for (const userId of userIds) {
    await insertLkNotification(client, {
      userId,
      transferId: input.transferId,
      eventType: "tan_tracker.handoff_confirmed",
      title: input.delivered ? "Доставлено конечному получателю" : "Передача подтверждена",
      body: `${input.itemTitle} (${input.publicCode})`,
      idempotencyKey: `tt-lk-handoff-confirmed:${input.transferId}:hv:${input.handoffVersion}:${userId}`,
    });
  }
}

export async function notifyDeliveredLk(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    creatorPartyId: string;
    holderPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIds(client, [input.creatorPartyId, input.holderPartyId]);
  for (const userId of userIds) {
    await insertLkNotification(client, {
      userId,
      transferId: input.transferId,
      eventType: "tan_tracker.delivered",
      title: "Доставлено",
      body: `${input.itemTitle} (${input.publicCode})`,
      idempotencyKey: `tt-lk-delivered:${input.transferId}:hv:${input.handoffVersion}:${userId}`,
    });
  }
}

export async function notifyContinuedReturnedLk(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    holderPartyId: string;
    kind: "continued" | "returned";
    handoffVersion: number;
  },
): Promise<void> {
  const holderUserId = await partyUserId(client, input.holderPartyId);
  if (!holderUserId) return;
  const title = input.kind === "continued" ? "Назначен следующий получатель" : "Ожидание передачи отменено";
  await insertLkNotification(client, {
    userId: holderUserId,
    transferId: input.transferId,
    eventType: input.kind === "continued" ? "tan_tracker.continued" : "tan_tracker.returned",
    title,
    body: `${input.itemTitle} (${input.publicCode})`,
    idempotencyKey: `tt-lk-${input.kind}:${input.transferId}:hv:${input.handoffVersion}:${holderUserId}`,
  });
}

export async function notifyClosedLk(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    partyIds: string[];
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIds(client, input.partyIds);
  for (const userId of userIds) {
    await insertLkNotification(client, {
      userId,
      transferId: input.transferId,
      eventType: "tan_tracker.closed",
      title: "Передача завершена",
      body: `${input.itemTitle} (${input.publicCode})`,
      idempotencyKey: `tt-lk-closed:${input.transferId}:hv:${input.handoffVersion}:${userId}`,
    });
  }
}

export async function isExternalParty(client: PoolClient, partyId: string): Promise<boolean> {
  const row = await client.query(
    `SELECT 1 FROM tt_external_persons ep JOIN tt_parties p ON p.id = ep.party_id WHERE ep.party_id = $1::uuid LIMIT 1`,
    [partyId],
  );
  return (row.rowCount ?? 0) > 0;
}
