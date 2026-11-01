import type { Pool, PoolClient } from "pg";
import { ensurePartyForUserOnWrite } from "../../tan-tracker/repository";
import { resolveExternalRecipientPartyIdForExternalActor, type ExternalRecipientInput } from "../../tan-tracker/party-eligibility";
import { lockPhonePartyResolution, PhonePartyConflictError } from "../../tan-tracker/phone-party-resolver";
import { normalizeRuPhoneE164, ruPhoneNational10 } from "../../tan-tracker/phone-normalize";
import { externalUnavailableMessage } from "./recipient-unified";

type Db = Pool | PoolClient;

export type NativeExternalPhonePendingResolution = {
  pendingPartyId: string;
  recipientKind: "staff" | "external";
};

/** SQL: normalize users.phone to 10 national digits (7/8/10-digit RU forms). */
const USER_PHONE_NATIONAL10_SQL = `
  CASE
    WHEN length(d) = 11 AND left(d, 1) IN ('7', '8') THEN right(d, 10)
    WHEN length(d) = 10 THEN d
    ELSE NULL
  END`;

function neutralRecipientUnavailable(): Error {
  return Object.assign(new Error(externalUnavailableMessage()), { http: 403 });
}

type StaffUserRow = { id: string; full_name: string; phone: string | null };

async function loadActiveUsersByNational10(client: Db, national10: string): Promise<StaffUserRow[]> {
  const res = await client.query<StaffUserRow>(
    `SELECT u.id::text, u.full_name, u.phone
     FROM users u
     CROSS JOIN LATERAL (
       SELECT regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') AS d
     ) norm
     WHERE u.status = 'active'
       AND (${USER_PHONE_NATIONAL10_SQL}) = $1`,
    [national10],
  );
  return res.rows;
}

async function loadInactiveUsersByNational10(client: Db, national10: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1
     FROM users u
     CROSS JOIN LATERAL (
       SELECT regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') AS d
     ) norm
     WHERE u.status <> 'active'
       AND (${USER_PHONE_NATIONAL10_SQL}) = $1
     LIMIT 1`,
    [national10],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Stale user party phone_e164 matches input but users.phone is a different valid number. */
async function hasStaleStaffPartyPhoneAlias(client: Db, phoneE164: string, national10: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1
     FROM tt_parties p
     JOIN users u ON u.id = p.user_id
     CROSS JOIN LATERAL (
       SELECT regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') AS d
     ) norm
     WHERE p.kind = 'user'
       AND p.phone_e164 = $1
       AND u.phone IS NOT NULL
       AND trim(u.phone) <> ''
       AND (${USER_PHONE_NATIONAL10_SQL}) IS DISTINCT FROM $2
     LIMIT 1`,
    [phoneE164, national10],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Native external actor: pending party by phone only (ignores draft recipient UUID picks).
 * Active staff → canonical user party; else global external party (no shadow on staff phones).
 */
export async function resolveNativeExternalPendingPartyByPhone(
  client: Db,
  input: {
    senderExternalPartyId: string;
    phoneE164: string;
    externalRecipient?: ExternalRecipientInput;
  },
): Promise<NativeExternalPhonePendingResolution> {
  const phoneE164 = normalizeRuPhoneE164(input.phoneE164);
  if (!phoneE164) {
    throw Object.assign(new Error("Введите телефон: 10 цифр после +7."), { http: 400 });
  }
  const national10 = ruPhoneNational10(phoneE164);
  if (!national10) {
    throw Object.assign(new Error("Введите телефон: 10 цифр после +7."), { http: 400 });
  }

  const senderPhone = (
    await client.query<{ phone_e164: string | null }>(
      `SELECT phone_e164 FROM tt_parties WHERE id = $1::uuid LIMIT 1`,
      [input.senderExternalPartyId],
    )
  ).rows[0]?.phone_e164;
  const senderNorm = senderPhone ? normalizeRuPhoneE164(senderPhone) : null;
  if (senderNorm && senderNorm === phoneE164) {
    throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
  }

  await lockPhonePartyResolution(client, phoneE164);

  if (await hasStaleStaffPartyPhoneAlias(client, phoneE164, national10)) {
    throw neutralRecipientUnavailable();
  }

  const activeUsers = await loadActiveUsersByNational10(client, national10);
  if (activeUsers.length > 1) {
    throw neutralRecipientUnavailable();
  }
  if (activeUsers.length === 1) {
    const user = activeUsers[0]!;
    const userPhoneNorm = user.phone?.trim() ? normalizeRuPhoneE164(user.phone) : null;
    if (userPhoneNorm && userPhoneNorm !== phoneE164) {
      throw neutralRecipientUnavailable();
    }
    const party = await ensurePartyForUserOnWrite(
      client,
      user.id,
      user.full_name,
      userPhoneNorm ?? phoneE164,
    );
    if (party.id === input.senderExternalPartyId) {
      throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
    }
    return { pendingPartyId: party.id, recipientKind: "staff" };
  }

  if (await loadInactiveUsersByNational10(client, national10)) {
    throw neutralRecipientUnavailable();
  }

  const extInput = input.externalRecipient;
  if (!extInput?.name?.trim() || !extInput.phone?.trim()) {
    throw Object.assign(new Error("Заполните все шаги заявки."), { http: 409 });
  }

  try {
    const pendingPartyId = await resolveExternalRecipientPartyIdForExternalActor(client, {
      name: extInput.name,
      phone: phoneE164,
    });
    if (pendingPartyId === input.senderExternalPartyId) {
      throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
    }
    return { pendingPartyId, recipientKind: "external" };
  } catch (err) {
    if (err instanceof PhonePartyConflictError) {
      throw Object.assign(new Error(err.message), { http: err.http });
    }
    throw err;
  }
}

/** Public holder (null staff creator): same phone rules as native create. */
export async function resolvePublicHolderPendingPartyByPhoneForExternalActor(
  client: Db,
  input: {
    holderPartyId: string;
    phoneE164: string;
    externalRecipient: ExternalRecipientInput;
  },
): Promise<string> {
  const resolved = await resolveNativeExternalPendingPartyByPhone(client, {
    senderExternalPartyId: input.holderPartyId,
    phoneE164: input.phoneE164,
    externalRecipient: input.externalRecipient,
  });
  return resolved.pendingPartyId;
}
