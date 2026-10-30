import type { PoolClient } from "pg";
import {
  fanoutStaffTransferNotification,
  transferPayload,
  uniqueStaffUserIdsFromParties,
} from "./staff-notify-fanout";

export { uniqueStaffUserIdsFromParties as uniqueStaffUserIds };

export async function notifyTransferAssignment(
  client: PoolClient,
  input: { transferId: string; publicCode: string; itemTitle: string; holderUserId: string; handoffVersion: number },
): Promise<void> {
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.assignment",
    recipientUserIds: [input.holderUserId],
    payload: transferPayload(input),
  });
}

export async function notifyCodeGenerated(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    holderPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, [input.holderPartyId]);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.code_obtained",
    recipientUserIds: userIds,
    payload: transferPayload(input),
  });
}

/** Intermediate handoff (not final delivery to route end). */
export async function notifyHandoffConfirmed(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    previousHolderPartyId: string;
    newHolderPartyId: string;
    creatorPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, [
    input.previousHolderPartyId,
    input.newHolderPartyId,
    input.creatorPartyId,
  ]);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.handoff_confirmed",
    recipientUserIds: userIds,
    payload: transferPayload(input),
  });
}

/** Final delivery to route end — single logical receipt (no duplicate handoff_confirmed). */
export async function notifyTransferDelivered(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    creatorPartyId: string;
    holderPartyId: string;
    previousHolderPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, [
    input.creatorPartyId,
    input.holderPartyId,
    input.previousHolderPartyId,
  ]);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.delivered",
    recipientUserIds: userIds,
    payload: transferPayload(input),
  });
}

/** Next recipient assigned while holder keeps custody. */
export async function notifyRouteContinued(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    holderPartyId: string;
    newPendingPartyId: string;
    creatorPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, [
    input.holderPartyId,
    input.newPendingPartyId,
    input.creatorPartyId,
  ]);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.continued",
    recipientUserIds: userIds,
    payload: transferPayload(input),
  });
}

/** Return route toward creator (pending set to creator). */
export async function notifyReturnToCreator(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    holderPartyId: string;
    creatorPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, [input.holderPartyId, input.creatorPartyId]);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.returned",
    recipientUserIds: userIds,
    payload: transferPayload(input),
  });
}

/** Pending invitation cancelled; item stays with holder. */
export async function notifyPendingCancelled(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    holderPartyId: string;
    revokedPendingPartyId: string;
    creatorPartyId: string;
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, [
    input.holderPartyId,
    input.revokedPendingPartyId,
    input.creatorPartyId,
  ]);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.pending_cancelled",
    recipientUserIds: userIds,
    payload: transferPayload(input),
  });
}

export async function notifyClosed(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    partyIds: string[];
    handoffVersion: number;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, input.partyIds);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.closed",
    recipientUserIds: userIds,
    payload: transferPayload(input),
  });
}

export async function notifyExternalCreatedStaff(
  client: PoolClient,
  input: { transferId: string; staffUserId: string; itemTitle: string; publicCode: string; handoffVersion: number },
): Promise<void> {
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.external_created",
    recipientUserIds: [input.staffUserId],
    payload: transferPayload(input),
  });
}

export async function notifyExternalDeclinedStaff(
  client: PoolClient,
  input: {
    transferId: string;
    staffUserId: string;
    itemTitle: string;
    publicCode: string;
    reason: string | null;
    handoffVersion: number;
  },
): Promise<void> {
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.external_declined",
    recipientUserIds: [input.staffUserId],
    payload: transferPayload({ ...input, reason: input.reason }),
  });
}

export async function isExternalParty(client: PoolClient, partyId: string): Promise<boolean> {
  const row = await client.query(
    `SELECT 1 FROM tt_external_persons ep JOIN tt_parties p ON p.id = ep.party_id WHERE ep.party_id = $1::uuid LIMIT 1`,
    [partyId],
  );
  return (row.rowCount ?? 0) > 0;
}
