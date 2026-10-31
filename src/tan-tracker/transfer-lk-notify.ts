import type { PoolClient } from "pg";
import {
  fanoutStaffTransferNotification,
  transferPayload,
  uniqueStaffUserIdsFromParties,
} from "./staff-notify-fanout";
import { buildNotificationRouteSnapshot } from "./staff-notification-route";
import type { StaffNotificationPayload } from "./staff-notification-copy";
import { buildNotificationTransferState } from "./notification-transfer-state";

export { uniqueStaffUserIdsFromParties as uniqueStaffUserIds };

async function payloadWithRoute(
  client: PoolClient,
  base: Omit<StaffNotificationPayload, "routeFromDisplayName" | "routeToDisplayName">,
  route: { fromPartyId?: string | null; toPartyId?: string | null },
): Promise<StaffNotificationPayload> {
  const snap = await buildNotificationRouteSnapshot(client, route.fromPartyId, route.toPartyId);
  return { ...transferPayload(base), ...snap, notificationState: await buildNotificationTransferState(client, base.transferId) };
}

export async function notifyTransferAssignment(
  client: PoolClient,
  input: {
    transferId: string;
    publicCode: string;
    itemTitle: string;
    holderUserId: string;
    holderPartyId: string;
    handoffVersion: number;
    fromPartyId?: string | null;
  },
): Promise<void> {
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.assignment",
    recipientUserIds: [input.holderUserId],
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.fromPartyId,
      toPartyId: input.holderPartyId,
    }),
  });
}

export async function notifyCodeGenerated(
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
  const userIds = await uniqueStaffUserIdsFromParties(client, [input.holderPartyId]);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.code_obtained",
    recipientUserIds: userIds,
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.holderPartyId,
      toPartyId: input.pendingPartyId,
    }),
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
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.previousHolderPartyId,
      toPartyId: input.newHolderPartyId,
    }),
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
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.previousHolderPartyId,
      toPartyId: input.holderPartyId,
    }),
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
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.holderPartyId,
      toPartyId: input.newPendingPartyId,
    }),
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
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.holderPartyId,
      toPartyId: input.creatorPartyId,
    }),
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
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.holderPartyId,
      toPartyId: input.revokedPendingPartyId,
    }),
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
    holderPartyId?: string | null;
  },
): Promise<void> {
  const userIds = await uniqueStaffUserIdsFromParties(client, input.partyIds);
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.closed",
    recipientUserIds: userIds,
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.holderPartyId,
      toPartyId: null,
    }),
  });
}

export async function notifyExternalCreatedStaff(
  client: PoolClient,
  input: {
    transferId: string;
    staffUserId: string;
    itemTitle: string;
    publicCode: string;
    handoffVersion: number;
    externalPartyId: string;
    staffPartyId: string;
  },
): Promise<void> {
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.external_created",
    recipientUserIds: [input.staffUserId],
    payload: await payloadWithRoute(client, input, {
      fromPartyId: input.externalPartyId,
      toPartyId: input.staffPartyId,
    }),
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
    externalPartyId?: string | null;
    staffPartyId?: string | null;
  },
): Promise<void> {
  await fanoutStaffTransferNotification(client, {
    eventType: "tan_tracker.external_declined",
    recipientUserIds: [input.staffUserId],
    payload: await payloadWithRoute(client, { ...input, reason: input.reason }, {
      fromPartyId: input.externalPartyId,
      toPartyId: input.staffPartyId,
    }),
  });
}

/** External recipient/creator party in tt_parties (not “has tt_external_persons row”). */
export async function isExternalParty(client: PoolClient, partyId: string): Promise<boolean> {
  const row = await client.query(
    `SELECT 1 FROM tt_parties WHERE id = $1::uuid AND kind = 'external' LIMIT 1`,
    [partyId],
  );
  return (row.rowCount ?? 0) > 0;
}
