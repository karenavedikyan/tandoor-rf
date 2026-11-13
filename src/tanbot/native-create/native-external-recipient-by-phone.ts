import type { Pool, PoolClient } from "pg";
import { ensurePartyForUserOnWrite } from "../../tan-tracker/repository";
import {
  resolveExternalRecipientPartyId,
  resolveExternalRecipientPartyIdForExternalActor,
  type ExternalRecipientInput,
} from "../../tan-tracker/party-eligibility";
import { lockPhonePartyResolution, PhonePartyConflictError } from "../../tan-tracker/phone-party-resolver";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";
import { findStaffRecipientByPhone } from "../../tan-tracker/staff-phone-recipient";
import { externalUnavailableMessage } from "./recipient-unified";

type Db = Pool | PoolClient;

export type NativeExternalPhonePendingResolution = {
  pendingPartyId: string;
  recipientKind: "staff" | "external";
};

function neutralRecipientUnavailable(): Error {
  return Object.assign(new Error(externalUnavailableMessage()), { http: 403 });
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
    /** Preserve existing public-holder contact provenance; never supplied by the external caller. */
    externalRecipientCreatedByUserId?: string;
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

  // The same profile-only decision as LK. Do not disclose directory/conflict details
  // to an external actor, and never fall back to external on a rejected profile.
  let user;
  try {
    user = await findStaffRecipientByPhone(client, phoneE164);
  } catch (err) {
    if ([403, 409].includes((err as { http?: number }).http ?? 0)) throw neutralRecipientUnavailable();
    throw err;
  }
  if (user) {
    const party = await ensurePartyForUserOnWrite(
      client,
      user.id,
      user.full_name,
      normalizeRuPhoneE164(user.phone ?? user.additional_phone ?? "") ?? phoneE164,
    );
    if (party.id === input.senderExternalPartyId) {
      throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
    }
    return { pendingPartyId: party.id, recipientKind: "staff" };
  }

  const extInput = input.externalRecipient;
  if (!extInput?.name?.trim() || !extInput.phone?.trim()) {
    throw Object.assign(new Error("Заполните все шаги заявки."), { http: 409 });
  }

  try {
    const recipient = { name: extInput.name, phone: phoneE164 };
    const pendingPartyId = input.externalRecipientCreatedByUserId
      ? await resolveExternalRecipientPartyId(client, input.externalRecipientCreatedByUserId, recipient)
      : await resolveExternalRecipientPartyIdForExternalActor(client, recipient);
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

/** Public holder: same canonical phone rules regardless of the track creator. */
export async function resolvePublicHolderPendingPartyByPhoneForExternalActor(
  client: Db,
  input: {
    holderPartyId: string;
    phoneE164: string;
    externalRecipient: ExternalRecipientInput;
    externalRecipientCreatedByUserId?: string;
  },
): Promise<string> {
  const resolved = await resolveNativeExternalPendingPartyByPhone(client, {
    senderExternalPartyId: input.holderPartyId,
    phoneE164: input.phoneE164,
    externalRecipient: input.externalRecipient,
    externalRecipientCreatedByUserId: input.externalRecipientCreatedByUserId,
  });
  return resolved.pendingPartyId;
}
