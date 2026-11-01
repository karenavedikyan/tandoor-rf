import type { Pool, PoolClient } from "pg";
import { ensurePartyForUserOnWrite } from "../../tan-tracker/repository";
import { resolveExternalRecipientPartyIdForExternalActor, type ExternalRecipientInput } from "../../tan-tracker/party-eligibility";
import { lockPhonePartyResolution, PhonePartyConflictError } from "../../tan-tracker/phone-party-resolver";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";
import { externalUnavailableMessage } from "./recipient-unified";

type Db = Pool | PoolClient;

export type NativeExternalPhonePendingResolution = {
  pendingPartyId: string;
  recipientKind: "staff" | "external";
};

function neutralRecipientUnavailable(): Error {
  return Object.assign(new Error(externalUnavailableMessage()), { http: 403 });
}

/** Active users whose normalized phone matches (users.phone or linked user party). */
async function loadActiveUsersByPhoneE164(
  client: Db,
  phoneE164: string,
): Promise<Array<{ id: string; full_name: string; phone: string | null }>> {
  const res = await client.query<{ id: string; full_name: string; phone: string | null }>(
    `SELECT u.id::text, u.full_name, u.phone
     FROM users u
     WHERE u.status = 'active'
       AND (
         regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
         OR EXISTS (
           SELECT 1 FROM tt_parties p
           WHERE p.user_id = u.id AND p.kind = 'user' AND p.phone_e164 = $1
         )
       )`,
    [phoneE164],
  );
  return res.rows;
}

async function hasInactiveUserPhoneCollision(client: Db, phoneE164: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM users u
     WHERE u.status <> 'active'
       AND (
         regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
         OR EXISTS (
           SELECT 1 FROM tt_parties p
           WHERE p.user_id = u.id AND p.kind = 'user' AND p.phone_e164 = $1
         )
       )
     LIMIT 1`,
    [phoneE164],
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

  const activeUsers = await loadActiveUsersByPhoneE164(client, phoneE164);
  if (activeUsers.length > 1) {
    throw neutralRecipientUnavailable();
  }
  if (activeUsers.length === 1) {
    const user = activeUsers[0]!;
    const userPhone = user.phone?.trim() ? normalizeRuPhoneE164(user.phone) : phoneE164;
    const party = await ensurePartyForUserOnWrite(client, user.id, user.full_name, userPhone ?? phoneE164);
    if (party.id === input.senderExternalPartyId) {
      throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
    }
    return { pendingPartyId: party.id, recipientKind: "staff" };
  }

  if (await hasInactiveUserPhoneCollision(client, phoneE164)) {
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
