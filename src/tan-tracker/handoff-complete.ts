import type { PoolClient } from "pg";
import { markFirstCustodyIfUnset } from "./custody-state";
import { resolveUserIdForParty } from "../tanbot-telegram/outbox";
import {
  notifyHandoffConfirmed,
  notifyTransferAssignment,
  notifyTransferDelivered,
} from "./transfer-lk-notify";
import { notifyExternalPartyAfterHandoff } from "./transfer-external-messenger-notify";

type TransferRow = {
  id: string;
  holder_party_id: string;
  pending_party_id: string | null;
  final_recipient_party_id: string | null;
  handoff_version: number;
  row_version: number;
};

/** Move holder → pending (same outcome as successful code verify). */
export async function applyPendingReceiptHandoff(
  client: PoolClient,
  row: TransferRow,
  auditUserId: string | null,
  actingPartyId: string,
  timelineNote: string,
): Promise<{ transferStatus: string; routeComplete: boolean }> {
  if (!row.pending_party_id) {
    throw Object.assign(new Error("Нет ожидающего получателя."), { http: 409 });
  }
  const from = row.holder_party_id;
  const to = row.pending_party_id;
  let newStatus = "active";
  const routeComplete = to === row.final_recipient_party_id;
  if (routeComplete) newStatus = "delivered";
  await client.query(
    `UPDATE tt_transfers SET holder_party_id = $2, pending_party_id = NULL, status = $3,
            holder_since = NOW(), handoff_version = handoff_version + 1, row_version = row_version + 1,
            delivered_at = CASE WHEN $3 = 'delivered' THEN NOW() ELSE delivered_at END
     WHERE id = $1 AND row_version = $4`,
    [row.id, to, newStatus, row.row_version],
  );
  await client.query(
    `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
     VALUES ($1,$2,$3,$4,$5::uuid)`,
    [row.id, from, to, timelineNote, auditUserId],
  );
  if (routeComplete) {
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5::uuid)`,
      [row.id, to, row.final_recipient_party_id, "Доставлено конечному получателю", auditUserId],
    );
  }
  await client.query(
    `UPDATE tt_transfer_invitations SET superseded_at = NOW()
     WHERE transfer_id = $1 AND superseded_at IS NULL`,
    [row.id],
  );
  await markFirstCustodyIfUnset(client, row.id);

  const newHandoffVersion = row.handoff_version + 1;
  const meta = await client.query<{
    public_code: string;
    item_title: string;
    creator_party_id: string;
  }>(`SELECT public_code, item_title, creator_party_id FROM tt_transfers WHERE id = $1`, [row.id]);
  const m = meta.rows[0];

  if (m) {
    if (routeComplete) {
      await notifyTransferDelivered(client, {
        transferId: row.id,
        publicCode: m.public_code,
        itemTitle: m.item_title,
        creatorPartyId: m.creator_party_id,
        holderPartyId: to,
        previousHolderPartyId: from,
        handoffVersion: newHandoffVersion,
      });
    } else {
      await notifyHandoffConfirmed(client, {
        transferId: row.id,
        publicCode: m.public_code,
        itemTitle: m.item_title,
        previousHolderPartyId: from,
        newHolderPartyId: to,
        creatorPartyId: m.creator_party_id,
        handoffVersion: newHandoffVersion,
      });
    }
    const extEvent = routeComplete ? "delivered" : "after_receipt";
    await notifyExternalPartyAfterHandoff(client, {
      externalPartyId: to,
      transferId: row.id,
      handoffVersion: newHandoffVersion,
      event: extEvent,
      singleChannel: true,
    });
    await notifyExternalPartyAfterHandoff(client, {
      externalPartyId: from,
      transferId: row.id,
      handoffVersion: newHandoffVersion,
      event: "after_code",
      singleChannel: false,
    });
  }

  if (newStatus === "active") {
    const holderUserId = await resolveUserIdForParty(client, to);
    if (holderUserId && m) {
      await notifyTransferAssignment(client, {
        transferId: row.id,
        publicCode: m.public_code,
        itemTitle: m.item_title,
        holderUserId,
        handoffVersion: newHandoffVersion,
      });
    }
  }

  return { transferStatus: newStatus, routeComplete };
}
