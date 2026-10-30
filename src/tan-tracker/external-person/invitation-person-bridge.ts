import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../phone-normalize";
import type { ExternalMessengerChannel } from "./messenger-provenance";

export type InvitationHandoffBridgeResult =
  | { kind: "no_invitation_proof" }
  | { kind: "ok"; channel: ExternalMessengerChannel }
  | { kind: "invitation_proof_rejected"; channel: ExternalMessengerChannel };

type InvitationProofSession = {
  channel: ExternalMessengerChannel;
  messengerUserId: string;
  messengerChatId: string;
};

async function loadInvitationHandoffProof(
  client: PoolClient,
  input: { transferId: string; externalPartyId: string; preHandoffVersion: number },
): Promise<InvitationProofSession | null> {
  const res = await client.query<{
    channel: ExternalMessengerChannel;
    telegram_chat_id: string | null;
    max_chat_id: string | null;
    bound_telegram_user_id: string | null;
    bound_max_user_id: string | null;
  }>(
    `SELECT channel, telegram_chat_id::text, max_chat_id::text,
            bound_telegram_user_id::text, bound_max_user_id::text
     FROM tt_external_messenger_sessions
     WHERE transfer_id = $1
       AND pending_party_id = $2::uuid
       AND handoff_version = $3
       AND superseded_at IS NULL
       AND expires_at > NOW()
       AND phone_verified_at IS NOT NULL
       AND code_issued_at IS NOT NULL
       AND channel IS NOT NULL
     ORDER BY code_issued_at DESC
     LIMIT 1`,
    [input.transferId, input.externalPartyId, input.preHandoffVersion],
  );
  const row = res.rows[0];
  if (!row?.channel) return null;

  const codeConsumed = await client.query(
    `SELECT 1 FROM tt_handoff_codes
     WHERE transfer_id = $1 AND handoff_version = $2 AND consumed_at IS NOT NULL
     LIMIT 1`,
    [input.transferId, input.preHandoffVersion],
  );
  if (!codeConsumed.rowCount) return null;

  if (row.channel === "telegram") {
    if (!row.telegram_chat_id || !row.bound_telegram_user_id) return null;
    return {
      channel: "telegram",
      messengerUserId: row.bound_telegram_user_id,
      messengerChatId: row.telegram_chat_id,
    };
  }
  if (!row.max_chat_id || !row.bound_max_user_id) return null;
  return {
    channel: "max",
    messengerUserId: row.bound_max_user_id,
    messengerChatId: row.max_chat_id,
  };
}

/** Contact proof started on invitation path but strict proof is not valid (expired session, etc.). */
async function loadInvitationHandoffArtifact(
  client: PoolClient,
  input: { transferId: string; externalPartyId: string; preHandoffVersion: number },
): Promise<InvitationProofSession | null> {
  const res = await client.query<{
    channel: ExternalMessengerChannel;
    telegram_chat_id: string | null;
    max_chat_id: string | null;
    bound_telegram_user_id: string | null;
    bound_max_user_id: string | null;
  }>(
    `SELECT channel, telegram_chat_id::text, max_chat_id::text,
            bound_telegram_user_id::text, bound_max_user_id::text
     FROM tt_external_messenger_sessions
     WHERE transfer_id = $1
       AND pending_party_id = $2::uuid
       AND handoff_version = $3
       AND superseded_at IS NULL
       AND phone_verified_at IS NOT NULL
       AND code_issued_at IS NOT NULL
       AND channel IS NOT NULL
     ORDER BY code_issued_at DESC
     LIMIT 1`,
    [input.transferId, input.externalPartyId, input.preHandoffVersion],
  );
  const row = res.rows[0];
  if (!row?.channel) return null;
  if (row.channel === "telegram") {
    if (!row.telegram_chat_id || !row.bound_telegram_user_id) return null;
    return {
      channel: "telegram",
      messengerUserId: row.bound_telegram_user_id,
      messengerChatId: row.telegram_chat_id,
    };
  }
  if (!row.max_chat_id || !row.bound_max_user_id) return null;
  return {
    channel: "max",
    messengerUserId: row.bound_max_user_id,
    messengerChatId: row.max_chat_id,
  };
}

type MaterializeOutcome =
  | { ok: true; channel: ExternalMessengerChannel }
  | { ok: false; channel: ExternalMessengerChannel };

async function materializePersonFromInvitationProof(
  client: PoolClient,
  input: { externalPartyId: string; proof: InvitationProofSession },
): Promise<MaterializeOutcome> {
  const { proof } = input;
  const party = await client.query<{ kind: string; phone_e164: string | null; display_name: string }>(
    `SELECT kind, phone_e164, display_name FROM tt_parties WHERE id = $1::uuid LIMIT 1`,
    [input.externalPartyId],
  );
  const p = party.rows[0];
  if (p?.kind !== "external") return { ok: false, channel: proof.channel };
  const phone = normalizeRuPhoneE164(p.phone_e164 ?? "");
  if (!phone) return { ok: false, channel: proof.channel };

  const existingPerson = await client.query<{ id: string }>(
    `SELECT id::text FROM tt_external_persons WHERE party_id = $1::uuid LIMIT 1`,
    [input.externalPartyId],
  );
  let personId = existingPerson.rows[0]?.id;

  const messengerTaken = await client.query<{ person_id: string; party_id: string }>(
    `SELECT v.person_id::text, p.party_id::text
     FROM tt_external_person_verifications v
     JOIN tt_external_persons p ON p.id = v.person_id
     WHERE v.channel = $1 AND v.messenger_user_id = $2
     LIMIT 1`,
    [proof.channel, proof.messengerUserId],
  );
  const taken = messengerTaken.rows[0];
  if (taken && taken.party_id !== input.externalPartyId) {
    return { ok: false, channel: proof.channel };
  }

  if (!personId) {
    const byPhone = await client.query<{ id: string; party_id: string }>(
      `SELECT id::text, party_id::text FROM tt_external_persons WHERE phone_e164 = $1 LIMIT 1`,
      [phone],
    );
    if (byPhone.rows[0] && byPhone.rows[0].party_id !== input.externalPartyId) {
      return { ok: false, channel: proof.channel };
    }
    personId = byPhone.rows[0]?.id;
  }

  if (!personId) {
    const name = (p.display_name || "Клиент").trim().slice(0, 200) || "Клиент";
    personId = (
      await client.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id)
         VALUES ($1, $2, $3::uuid)
         RETURNING id::text`,
        [phone, name, input.externalPartyId],
      )
    ).rows[0]!.id;
  }

  await client.query(
    `INSERT INTO tt_external_person_verifications (
       person_id, channel, messenger_user_id, messenger_chat_id, notifications_enabled, opted_out_at
     ) VALUES ($1::uuid, $2, $3, $4, TRUE, NULL)
     ON CONFLICT (channel, messenger_user_id) DO UPDATE SET
       person_id = EXCLUDED.person_id,
       messenger_chat_id = EXCLUDED.messenger_chat_id,
       verified_at = NOW(),
       notifications_enabled = CASE
         WHEN tt_external_person_verifications.opted_out_at IS NOT NULL
         THEN tt_external_person_verifications.notifications_enabled
         ELSE TRUE
       END,
       opted_out_at = tt_external_person_verifications.opted_out_at`,
    [personId, proof.channel, proof.messengerUserId, proof.messengerChatId],
  );

  return { ok: true, channel: proof.channel };
}

/**
 * Invitation-scoped handoff notify: distinguish missing proof vs proof that must not
 * fall back to another messenger channel.
 */
export async function resolveInvitationHandoffForNotify(
  client: PoolClient,
  input: { transferId: string; externalPartyId: string; preHandoffVersion: number },
): Promise<InvitationHandoffBridgeResult> {
  const proof = await loadInvitationHandoffProof(client, input);
  if (proof) {
    const materialized = await materializePersonFromInvitationProof(client, {
      externalPartyId: input.externalPartyId,
      proof,
    });
    if (!materialized.ok) {
      return { kind: "invitation_proof_rejected", channel: materialized.channel };
    }
    return { kind: "ok", channel: materialized.channel };
  }

  const artifact = await loadInvitationHandoffArtifact(client, input);
  if (artifact) {
    return { kind: "invitation_proof_rejected", channel: artifact.channel };
  }
  return { kind: "no_invitation_proof" };
}

/** @deprecated use resolveInvitationHandoffForNotify */
export async function resolveInvitationHandoffMessengerChannel(
  client: PoolClient,
  input: { transferId: string; externalPartyId: string; preHandoffVersion: number },
): Promise<ExternalMessengerChannel | null> {
  const r = await resolveInvitationHandoffForNotify(client, input);
  return r.kind === "ok" ? r.channel : null;
}
