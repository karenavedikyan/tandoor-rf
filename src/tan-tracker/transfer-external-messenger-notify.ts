import type { PoolClient } from "pg";
import { buildExternalPersonMessengerBody } from "./external-person/messenger-copy";
import { enqueueExternalPersonMessengerEvent } from "./external-person/external-person-notify";
import { signExternalPersonMessengerLinks } from "./external-person/holder-links";
import { resolveInvitationHandoffForNotify } from "./external-person/invitation-person-bridge";
import type { ExternalMessengerChannel } from "./external-person/messenger-provenance";
import { isExternalParty } from "./transfer-lk-notify";
import { buildNotificationRouteSnapshot } from "./staff-notification-route";

async function transferMeta(client: PoolClient, transferId: string) {
  return (
    await client.query<{ public_code: string; item_title: string }>(
      `SELECT public_code, item_title FROM tt_transfers WHERE id = $1 LIMIT 1`,
      [transferId],
    )
  ).rows[0];
}

async function routeSnapshotForLeg(
  client: PoolClient,
  fromPartyId?: string | null,
  toPartyId?: string | null,
) {
  if (fromPartyId == null && toPartyId == null) {
    return {};
  }
  return buildNotificationRouteSnapshot(client, fromPartyId ?? null, toPartyId ?? null);
}

export async function notifyExternalPartyAfterHandoff(
  client: PoolClient,
  input: {
    externalPartyId: string;
    transferId: string;
    handoffVersion: number;
    event: "after_code" | "after_receipt" | "delivered" | "closed";
    preferredChannel?: ExternalMessengerChannel;
    singleChannel?: boolean;
    routeFromPartyId?: string | null;
    routeToPartyId?: string | null;
  },
): Promise<void> {
  if (!(await isExternalParty(client, input.externalPartyId))) return;
  const meta = await transferMeta(client, input.transferId);
  if (!meta) return;
  const preHandoffVersion = Math.max(1, input.handoffVersion - 1);
  const bridge = await resolveInvitationHandoffForNotify(client, {
    transferId: input.transferId,
    externalPartyId: input.externalPartyId,
    preHandoffVersion,
  });
  if (bridge.kind === "invitation_proof_rejected") {
    return;
  }

  let singleChannel = input.singleChannel ?? input.event === "after_receipt";
  let preferredChannel =
    input.preferredChannel ?? (bridge.kind === "ok" ? bridge.channel : undefined);
  if (bridge.kind === "no_invitation_proof" && singleChannel && !preferredChannel) {
    singleChannel = false;
  }

  const links = await signExternalPersonMessengerLinks(client, {
    externalPartyId: input.externalPartyId,
    transferId: input.transferId,
    handoffVersion: input.handoffVersion,
  });
  const route = await routeSnapshotForLeg(client, input.routeFromPartyId, input.routeToPartyId);
  const body = buildExternalPersonMessengerBody({
    event: input.event === "after_code" ? "after_code" : input.event,
    publicCode: meta.public_code,
    itemTitle: meta.item_title,
    holderUrl: links?.holderUrl,
    shellUrl: links?.shellUrl,
    routeFromDisplayName: route.routeFromDisplayName,
    routeToDisplayName: route.routeToDisplayName,
  });
  await enqueueExternalPersonMessengerEvent(client, {
    externalPartyId: input.externalPartyId,
    publicCode: meta.public_code,
    event: input.event,
    body,
    idempotencyKey: `tt-ext-msg:${input.event}:${input.transferId}:hv:${input.handoffVersion}`,
    preferredChannel,
    singleChannel,
  });
}

export async function notifyExternalPartyHandoffCode(
  client: PoolClient,
  input: {
    externalPartyId: string;
    transferId: string;
    handoffVersion: number;
    code: string;
    preferredChannel: ExternalMessengerChannel;
  },
): Promise<void> {
  if (!(await isExternalParty(client, input.externalPartyId))) return;
  const meta = await transferMeta(client, input.transferId);
  if (!meta) return;
  const body = buildExternalPersonMessengerBody({
    event: "handoff_code",
    publicCode: meta.public_code,
    itemTitle: meta.item_title,
    extraLine: input.code,
  });
  await enqueueExternalPersonMessengerEvent(client, {
    externalPartyId: input.externalPartyId,
    publicCode: meta.public_code,
    event: "handoff_code",
    body,
    idempotencyKey: `tt-ext-msg:handoff_code:${input.transferId}:hv:${input.handoffVersion}:${input.preferredChannel}`,
    preferredChannel: input.preferredChannel,
    singleChannel: true,
  });
}
