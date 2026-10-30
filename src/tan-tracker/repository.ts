import type { Pool, PoolClient } from "pg";
import type {
  TanTrackerContactDto,
  TanTrackerOrderDto,
  TanTrackerPartyRow,
  TanTrackerTimelineRow,
  TanTrackerTransferRow,
} from "./types";
import { invitationTokenTtlMs, signInvitationToken } from "./invitation-token";

type Db = Pool | PoolClient;

export type PartyRowWithEmployee = TanTrackerPartyRow & {
  linked_employee_id: string | null;
};

export async function findPartyByUserId(
  client: Db,
  userId: string,
): Promise<PartyRowWithEmployee | null> {
  const res = await client.query<PartyRowWithEmployee>(
    `SELECT p.id, p.kind, p.user_id, p.display_name, p.phone_e164,
            uoel.employee_id::text AS linked_employee_id
     FROM tt_parties p
     LEFT JOIN user_onec_employee_links uoel
       ON uoel.user_id = p.user_id AND uoel.revoked_at IS NULL
     WHERE p.user_id = $1::uuid
     LIMIT 1`,
    [userId],
  );
  return res.rows[0] ?? null;
}

export async function ensurePartyForUserOnWrite(
  client: Db,
  userId: string,
  displayName: string,
  phoneE164: string | null,
): Promise<PartyRowWithEmployee> {
  const existing = await findPartyByUserId(client, userId);
  if (existing) {
    await client.query(
      `UPDATE tt_parties SET display_name = $2, phone_e164 = COALESCE($3, phone_e164)
       WHERE user_id = $1`,
      [userId, displayName, phoneE164],
    );
    return (await findPartyByUserId(client, userId))!;
  }
  await client.query(
    `INSERT INTO tt_parties (kind, user_id, display_name, phone_e164, created_by_user_id)
     VALUES ('user', $1, $2, $3, $1)`,
    [userId, displayName, phoneE164],
  );
  return (await findPartyByUserId(client, userId))!;
}

export async function listScopedPartyRows(
  client: Db,
  opts: {
    actorPartyId: string | null;
    userId: string;
    visibleTransferIds: string[];
    teamUserIds: string[];
  },
): Promise<PartyRowWithEmployee[]> {
  const res = await client.query<PartyRowWithEmployee>(
    `
      SELECT DISTINCT p.id, p.kind, p.user_id, p.display_name, p.phone_e164,
             uoel.employee_id::text AS linked_employee_id
      FROM tt_parties p
      LEFT JOIN user_onec_employee_links uoel
        ON uoel.user_id = p.user_id AND uoel.revoked_at IS NULL
      WHERE ($1::uuid IS NOT NULL AND p.id = $1::uuid)
         OR p.created_by_user_id = $2::uuid
         OR (
           cardinality($3::text[]) > 0
           AND p.id IN (
             SELECT DISTINCT x.party_id FROM (
               SELECT t.creator_party_id AS party_id FROM tt_transfers t WHERE t.id = ANY($3::text[])
               UNION SELECT t.holder_party_id FROM tt_transfers t WHERE t.id = ANY($3::text[])
               UNION SELECT t.pending_party_id FROM tt_transfers t WHERE t.id = ANY($3::text[]) AND t.pending_party_id IS NOT NULL
               UNION SELECT t.final_recipient_party_id FROM tt_transfers t WHERE t.id = ANY($3::text[]) AND t.final_recipient_party_id IS NOT NULL
               UNION SELECT tl.from_party_id FROM tt_transfer_timeline tl WHERE tl.transfer_id = ANY($3::text[]) AND tl.from_party_id IS NOT NULL
               UNION SELECT tl.to_party_id FROM tt_transfer_timeline tl WHERE tl.transfer_id = ANY($3::text[]) AND tl.to_party_id IS NOT NULL
             ) x
           )
         )
         OR (
           cardinality($4::uuid[]) > 0
           AND p.user_id IS NOT NULL
           AND p.user_id = ANY($4::uuid[])
         )
    `,
    [
      opts.actorPartyId,
      opts.userId,
      opts.visibleTransferIds,
      opts.teamUserIds,
    ],
  );
  return res.rows;
}

export async function listAllTransferRows(client: Db): Promise<TanTrackerTransferRow[]> {
  const res = await client.query<TanTrackerTransferRow>(
    `SELECT id, public_code, item_title, qty_label, comment_text, status,
            creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
            due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version,
            first_custody_at
     FROM tt_transfers
     ORDER BY updated_at DESC`,
  );
  return res.rows;
}

export async function listTimelineForTransfer(
  client: Db,
  transferId: string,
): Promise<TanTrackerTimelineRow[]> {
  const res = await client.query<TanTrackerTimelineRow>(
    `SELECT id, transfer_id, occurred_at, from_party_id, to_party_id, note
     FROM tt_transfer_timeline
     WHERE transfer_id = $1
     ORDER BY occurred_at ASC`,
    [transferId],
  );
  return res.rows;
}

export async function listRevokedParties(client: Db, transferId: string): Promise<string[]> {
  const res = await client.query<{ party_id: string }>(
    `SELECT party_id::text FROM tt_transfer_revoked_parties WHERE transfer_id = $1`,
    [transferId],
  );
  return res.rows.map((r) => r.party_id);
}

export function partyToContact(row: PartyRowWithEmployee): TanTrackerContactDto {
  return {
    id: row.id,
    name: row.display_name,
    phone: row.phone_e164 ?? "",
    kind: row.kind,
    employeeId: row.linked_employee_id,
  };
}

export function mapTransferToOrderDto(
  row: TanTrackerTransferRow,
  timeline: TanTrackerTimelineRow[],
  revoked: string[],
  extras?: {
    attachments?: TanTrackerOrderDto["attachments"];
  },
): TanTrackerOrderDto {
  const activeInvitation =
    row.pending_party_id != null
      ? {
          hv: row.handoff_version,
          pendingId: row.pending_party_id,
          holderId: row.holder_party_id,
          item: row.item_title,
          id: row.public_code,
          invitationToken: signInvitationToken({
            transferId: row.public_code,
            hv: row.handoff_version,
            pendingPartyId: row.pending_party_id,
            exp: Date.now() + invitationTokenTtlMs(),
          }),
        }
      : null;
  return {
    id: row.public_code,
    item: row.item_title,
    qty: row.qty_label ?? undefined,
    holderId: row.holder_party_id,
    pendingId: row.pending_party_id,
    status: row.status,
    dueAt: row.due_at ? row.due_at.getTime() : null,
    comment: row.comment_text ?? "",
    holderSince: row.holder_since.getTime(),
    timeline: timeline.map((t) => ({
      at: t.occurred_at.getTime(),
      from: t.from_party_id,
      to: t.to_party_id,
      note: t.note,
    })),
    finalRecipientId: row.final_recipient_party_id,
    createdById: row.creator_party_id,
    allowLegacyComplete: row.allow_legacy_complete,
    handoffVer: row.handoff_version,
    revokedParticipants: revoked,
    activeInvitation,
    attachments: extras?.attachments ?? [],
    rowVersion: row.row_version,
    fromExternal: row.from_external === true,
  };
}

export async function findExternalPartyByPhone(
  client: Db,
  phoneE164: string,
  createdByUserId: string,
): Promise<PartyRowWithEmployee | null> {
  const res = await client.query<PartyRowWithEmployee>(
    `SELECT p.id, p.kind, p.user_id, p.display_name, p.phone_e164,
            NULL::text AS linked_employee_id
     FROM tt_parties p
     WHERE p.kind = 'external' AND p.phone_e164 = $1 AND p.created_by_user_id = $2::uuid
     LIMIT 1`,
    [phoneE164, createdByUserId],
  );
  return res.rows[0] ?? null;
}

export async function createExternalParty(
  client: Db,
  displayName: string,
  phoneE164: string,
  createdByUserId: string,
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
     VALUES ('external', $1, $2, $3)
     RETURNING id::text`,
    [displayName, phoneE164, createdByUserId],
  );
  return res.rows[0].id;
}

export async function nextPublicTransferCode(client: Db): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TT-${year}-`;
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(public_code FROM '[0-9]+$') AS INTEGER)), 0) + 1 AS n
     FROM tt_transfers WHERE public_code LIKE $1`,
    [`${prefix}%`],
  );
  const n = Number(res.rows[0]?.n ?? 1);
  return `${prefix}${String(n).padStart(3, "0")}`;
}
