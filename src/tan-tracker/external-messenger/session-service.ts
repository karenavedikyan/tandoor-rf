import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../phone-normalize";
import { findStaffRecipientByPhone } from "../staff-phone-recipient";
import {
  generateExternalMessengerStartToken,
  hashExternalMessengerStartToken,
  isExternalMessengerStartToken,
} from "./start-token";
import {
  EXTERNAL_MESSENGER_MAX_CODE_ISSUES,
  EXTERNAL_MESSENGER_MAX_CONTACT_ATTEMPTS,
  EXTERNAL_MESSENGER_SESSION_TTL_MS,
  isExternalMessengerFeatureEnabled,
} from "./config";

export type ExternalMessengerSessionRow = {
  id: string;
  transfer_id: string;
  pending_party_id: string;
  handoff_version: number;
  channel: "telegram" | "max" | null;
  expires_at: Date;
  contact_attempt_count: number;
  code_issue_count: number;
  phone_verified_at: Date | null;
  code_issued_at: Date | null;
  telegram_chat_id: string | null;
  max_chat_id: string | null;
  bound_telegram_user_id: string | null;
  bound_max_user_id: string | null;
};

export async function supersedeActiveSessionsForTransfer(
  client: PoolClient,
  transferId: string,
  handoffVersion: number,
): Promise<void> {
  await client.query(
    `UPDATE tt_external_messenger_sessions SET superseded_at = NOW()
     WHERE transfer_id = $1 AND handoff_version = $2 AND superseded_at IS NULL`,
    [transferId, handoffVersion],
  );
}

export async function mintExternalMessengerSession(
  client: PoolClient,
  input: {
    transferId: string;
    pendingPartyId: string;
    handoffVersion: number;
    /** Native universal invitation: staff user party with phone. Default external-only. */
    allowUserParty?: boolean;
  },
): Promise<{ startToken: string; sessionId: string } | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  const party = await client.query<{ kind: string; phone_e164: string | null }>(
    `SELECT kind, phone_e164 FROM tt_parties WHERE id = $1::uuid`,
    [input.pendingPartyId],
  );
  const row = party.rows[0];
  if (!row?.phone_e164) return null;
  const kindOk =
    row.kind === "external" || (input.allowUserParty === true && row.kind === "user");
  if (!kindOk) return null;

  await supersedeActiveSessionsForTransfer(client, input.transferId, input.handoffVersion);
  const startToken = generateExternalMessengerStartToken();
  const tokenHash = hashExternalMessengerStartToken(startToken);
  const expiresAt = new Date(Date.now() + EXTERNAL_MESSENGER_SESSION_TTL_MS);
  const ins = await client.query<{ id: string }>(
    `INSERT INTO tt_external_messenger_sessions (
      token_hash, transfer_id, pending_party_id, handoff_version, expires_at
    ) VALUES ($1,$2,$3::uuid,$4,$5) RETURNING id::text`,
    [tokenHash, input.transferId, input.pendingPartyId, input.handoffVersion, expiresAt],
  );
  return { startToken, sessionId: ins.rows[0]!.id };
}

async function loadOpenTransferForSession(
  client: PoolClient,
  session: ExternalMessengerSessionRow,
) {
  const res = await client.query<{
    id: string;
    status: string;
    public_code: string;
    pending_party_id: string;
    handoff_version: number;
    phone_e164: string | null;
  }>(
    `SELECT t.id, t.status, t.public_code, t.pending_party_id, t.handoff_version, p.phone_e164
     FROM tt_transfers t
     JOIN tt_parties p ON p.id = t.pending_party_id
     JOIN tt_transfer_invitations inv
       ON inv.transfer_id = t.id AND inv.handoff_version = t.handoff_version AND inv.superseded_at IS NULL
     WHERE t.id = $1
       AND t.handoff_version = $2
       AND t.pending_party_id = $3::uuid
       AND inv.pending_party_id = $3::uuid
       AND t.status IN ('waiting','active')
     FOR UPDATE OF t`,
    [session.transfer_id, session.handoff_version, session.pending_party_id],
  );
  return res.rows[0];
}

export async function lockSessionByStartToken(
  client: PoolClient,
  startToken: string,
): Promise<ExternalMessengerSessionRow | null> {
  if (!isExternalMessengerStartToken(startToken)) return null;
  const tokenHash = hashExternalMessengerStartToken(startToken);
  const res = await client.query<ExternalMessengerSessionRow>(
    `SELECT id::text, transfer_id, pending_party_id::text, handoff_version, channel,
            expires_at, contact_attempt_count, code_issue_count, phone_verified_at, code_issued_at,
            telegram_chat_id::text, max_chat_id::text,
            bound_telegram_user_id::text, bound_max_user_id::text
     FROM tt_external_messenger_sessions
     WHERE token_hash = $1 AND superseded_at IS NULL
     FOR UPDATE`,
    [tokenHash],
  );
  const row = res.rows[0];
  if (!row || row.expires_at.getTime() <= Date.now()) return null;
  return row;
}

export async function assertSessionTransferStillOpen(
  client: PoolClient,
  session: ExternalMessengerSessionRow,
): Promise<{ ok: true; expectedPhoneE164: string } | { ok: false; message: string }> {
  const t = await loadOpenTransferForSession(client, session);
  if (!t) return { ok: false, message: "Передача недоступна или приглашение устарело." };
  const phone = normalizeRuPhoneE164(t.phone_e164 ?? "");
  if (!phone) return { ok: false, message: "Номер получателя не задан." };
  return { ok: true, expectedPhoneE164: phone };
}

/** Consume open handoff OTP rows without superseding messenger sessions or invitations. */
export async function consumeOpenHandoffCodesForTransfer(
  client: PoolClient,
  transferId: string,
): Promise<void> {
  await client.query(
    `UPDATE tt_handoff_codes SET consumed_at = NOW()
     WHERE transfer_id = $1 AND consumed_at IS NULL`,
    [transferId],
  );
}

async function resetSessionProofForChannelSwitch(
  client: PoolClient,
  session: ExternalMessengerSessionRow,
): Promise<void> {
  // Opening a link is not proof of the recipient's phone or a request to replace their OTP.
  // Keep an already delivered code valid; generateHandoffCodeForPendingParty consumes it only
  // when the phone-verified recipient actually issues a replacement (in either messenger).
  await client.query(
    `UPDATE tt_external_messenger_sessions
     SET phone_verified_at = NULL,
         code_issued_at = NULL
     WHERE id = $1::uuid`,
    [session.id],
  );
}

/**
 * Bind chat to exactly the selected invitation. Channel switches reset proof, not issued
 * codes; global contact/code issue counters are preserved. Bot starts serialize by identity.
 */
export async function bindSessionMessengerChat(
  client: PoolClient,
  session: ExternalMessengerSessionRow,
  channel: "telegram" | "max",
  chatId: bigint,
  messengerUserId: bigint,
): Promise<void> {
  const switchingChannel = session.channel != null && session.channel !== channel;
  const chatColumn = channel === "telegram" ? "telegram_chat_id" : "max_chat_id";
  const userColumn = channel === "telegram" ? "bound_telegram_user_id" : "bound_max_user_id";
  await client.query(
    `UPDATE tt_external_messenger_sessions SET ${chatColumn}=NULL, ${userColumn}=NULL
     WHERE ${chatColumn}=$1 AND id<>$2::uuid AND superseded_at IS NULL`,
    [chatId.toString(), session.id],
  );
  if (switchingChannel) {
    await resetSessionProofForChannelSwitch(client, session);
  }

  if (channel === "telegram") {
    await client.query(
      `UPDATE tt_external_messenger_sessions SET telegram_chat_id = $2, channel = 'telegram',
              bound_telegram_user_id = $3,
              max_chat_id = NULL, bound_max_user_id = NULL
       WHERE id = $1::uuid`,
      [session.id, chatId.toString(), messengerUserId.toString()],
    );
    return;
  }
  await client.query(
    `UPDATE tt_external_messenger_sessions SET max_chat_id = $2, channel = 'max',
            bound_max_user_id = $3,
            telegram_chat_id = NULL, bound_telegram_user_id = NULL
     WHERE id = $1::uuid`,
    [session.id, chatId.toString(), messengerUserId.toString()],
  );
}

/** @deprecated use bindSessionMessengerChat — kept for callers that only set channel when unset */
export async function bindSessionChannel(
  client: PoolClient,
  sessionId: string,
  channel: "telegram" | "max",
): Promise<void> {
  await client.query(
    `UPDATE tt_external_messenger_sessions SET channel = $2
     WHERE id = $1::uuid AND (channel IS NULL OR channel = $2)`,
    [sessionId, channel],
  );
}

export async function lockSessionByTelegramChat(
  client: PoolClient,
  chatId: bigint,
): Promise<ExternalMessengerSessionRow | null> {
  const res = await client.query<ExternalMessengerSessionRow>(
    `SELECT id::text, transfer_id, pending_party_id::text, handoff_version, channel,
            expires_at, contact_attempt_count, code_issue_count, phone_verified_at, code_issued_at,
            telegram_chat_id::text, max_chat_id::text,
            bound_telegram_user_id::text, bound_max_user_id::text
     FROM tt_external_messenger_sessions
     WHERE telegram_chat_id = $1 AND superseded_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [chatId.toString()],
  );
  return res.rows[0] ?? null;
}

export async function lockSessionByMaxChat(
  client: PoolClient,
  chatId: bigint,
): Promise<ExternalMessengerSessionRow | null> {
  const res = await client.query<ExternalMessengerSessionRow>(
    `SELECT id::text, transfer_id, pending_party_id::text, handoff_version, channel,
            expires_at, contact_attempt_count, code_issue_count, phone_verified_at, code_issued_at,
            telegram_chat_id::text, max_chat_id::text,
            bound_telegram_user_id::text, bound_max_user_id::text
     FROM tt_external_messenger_sessions
     WHERE max_chat_id = $1 AND superseded_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [chatId.toString()],
  );
  return res.rows[0] ?? null;
}

export async function recordContactAttempt(
  client: PoolClient,
  sessionId: string,
): Promise<{ allowed: boolean }> {
  const res = await client.query<{ contact_attempt_count: number }>(
    `UPDATE tt_external_messenger_sessions
     SET contact_attempt_count = contact_attempt_count + 1
     WHERE id = $1::uuid
     RETURNING contact_attempt_count`,
    [sessionId],
  );
  const count = res.rows[0]?.contact_attempt_count ?? EXTERNAL_MESSENGER_MAX_CONTACT_ATTEMPTS + 1;
  return { allowed: count <= EXTERNAL_MESSENGER_MAX_CONTACT_ATTEMPTS };
}

export async function markPhoneVerified(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(
    `UPDATE tt_external_messenger_sessions SET phone_verified_at = NOW() WHERE id = $1::uuid`,
    [sessionId],
  );
}

export async function recordCodeIssue(
  client: PoolClient,
  sessionId: string,
): Promise<{ allowed: boolean; alreadyIssued: boolean }> {
  const row = await client.query<{ code_issue_count: number; code_issued_at: Date | null }>(
    `SELECT code_issue_count, code_issued_at FROM tt_external_messenger_sessions WHERE id = $1::uuid FOR UPDATE`,
    [sessionId],
  );
  const cur = row.rows[0];
  if (!cur) return { allowed: false, alreadyIssued: false };
  if (cur.code_issued_at) return { allowed: false, alreadyIssued: true };
  if (cur.code_issue_count >= EXTERNAL_MESSENGER_MAX_CODE_ISSUES) return { allowed: false, alreadyIssued: false };
  await client.query(
    `UPDATE tt_external_messenger_sessions SET code_issue_count = code_issue_count + 1, code_issued_at = NOW()
     WHERE id = $1::uuid`,
    [sessionId],
  );
  return { allowed: true, alreadyIssued: false };
}

export function phonesMatch(expectedE164: string, gotE164: string): boolean {
  return expectedE164 === gotE164;
}

/** Own-contact proof may match either CURRENT profile phone of this exact recipient.
 * Never derive staff access from a historical party alias or a different bot account.
 */
export async function sessionRecipientPhoneMatches(
  client: PoolClient,
  session: ExternalMessengerSessionRow,
  got: string,
  messenger: { channel: "max" | "telegram"; userId: bigint; chatId: bigint },
): Promise<boolean> {
  const party = (await client.query<{ kind: string; user_id: string | null; phone_e164: string | null }>(
    `SELECT kind,user_id::text,phone_e164 FROM tt_parties WHERE id=$1::uuid`, [session.pending_party_id],
  )).rows[0];
  if (!party) return false;
  if (party.kind === "external") return !!party.phone_e164 && phonesMatch(party.phone_e164, got);
  if (party.kind !== "user" || !party.user_id) return false;
  try {
    const staff = await findStaffRecipientByPhone(client, got);
    if (staff?.id !== party.user_id) return false;
  } catch (err) {
    if ([400, 403, 409].includes((err as { http?: number }).http ?? 0)) return false;
    throw err;
  }
  const prefix = messenger.channel; // closed server-owned identifiers
  const accounts = (await client.query<{ user_id: string; messenger_user_id: string; messenger_chat_id: string }>(
    `SELECT user_id::text,${prefix}_user_id::text AS messenger_user_id,${prefix}_chat_id::text AS messenger_chat_id
     FROM tanbot_${prefix}_accounts
     WHERE user_id=$1::uuid OR ${prefix}_user_id::text=$2 OR ${prefix}_chat_id::text=$3`,
    [party.user_id, messenger.userId.toString(), messenger.chatId.toString()],
  )).rows;
  return accounts.every(account => account.user_id === party.user_id
    && account.messenger_user_id === messenger.userId.toString()
    && account.messenger_chat_id === messenger.chatId.toString());
}
