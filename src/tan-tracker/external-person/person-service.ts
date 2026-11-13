import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../phone-normalize";
import { mintExternalPersonSessionToken } from "./session-token";
import { requireHandoffOtpPepper } from "../otp-config";
import { resolveKnownExternalPartyByPhone } from "./known-party";
import { assertPersonHasVerificationChannel, type ExternalMessengerChannel } from "./messenger-provenance";
import { lockPhonePartyResolution, resolveOrCreateGlobalExternalPartyByPhone } from "../phone-party-resolver";
import { lockTanbotMaxMessenger, lockTanbotTelegramMessenger } from "../../tanbot/link-advisory-locks";
import { externalMessengerProofWouldConflict, hasExternalMessengerIdentityConflict } from "./identity-conflict";

export type ExternalPersonRow = {
  id: string;
  phone_e164: string;
  display_name: string;
  party_id: string;
};

async function loadPersonByMessenger(
  client: PoolClient,
  channel: "telegram" | "max",
  messengerUserId: bigint,
): Promise<ExternalPersonRow | null> {
  const row = await client.query<ExternalPersonRow>(
    `SELECT p.id::text, p.phone_e164, p.display_name, p.party_id::text
     FROM tt_external_person_verifications v
     JOIN tt_external_persons p ON p.id = v.person_id
     WHERE v.channel = $1 AND v.messenger_user_id = $2
     LIMIT 1`,
    [channel, messengerUserId.toString()],
  );
  return row.rows[0] ?? null;
}

export async function findPersonByMessenger(
  client: PoolClient,
  channel: "telegram" | "max",
  messengerUserId: bigint,
): Promise<ExternalPersonRow | null> {
  const person = await loadPersonByMessenger(client, channel, messengerUserId);
  if (!person || await hasExternalMessengerIdentityConflict(client, { personId: person.id })) return null;
  return person;
}

export async function upsertVerifiedPerson(
  client: PoolClient,
  input: {
    channel: "telegram" | "max";
    messengerUserId: bigint;
    messengerChatId: bigint;
    phoneRaw: string;
    displayName: string | null;
    /** Set only after the messenger has authenticated an own-contact event. */
    allowSelfRegistration?: boolean;
  },
): Promise<ExternalPersonRow> {
  const phone = normalizeRuPhoneE164(input.phoneRaw);
  if (!phone) {
    throw Object.assign(new Error("Некорректный номер телефона."), { http: 400 });
  }
  // Serialize one messenger identity, then one phone across both channels.
  // Keep the phone lock through person/verification creation in the caller's transaction.
  await (input.channel === "telegram" ? lockTanbotTelegramMessenger : lockTanbotMaxMessenger)(
    client, input.messengerUserId,
  );
  await lockPhonePartyResolution(client, phone);
  if (await externalMessengerProofWouldConflict(client, {
    phone, channel: input.channel, userId: input.messengerUserId.toString(), chatId: input.messengerChatId.toString(),
  })) {
    throw Object.assign(new Error("Конфликт привязок номера к мессенджеру. Обратитесь к администратору."), { http: 409 });
  }
  // A conflicted old proof still reserves its messenger: hiding it from auth
  // must not make it available to register against a different phone.
  const existingByMessenger = await loadPersonByMessenger(client, input.channel, input.messengerUserId);
  if (existingByMessenger && existingByMessenger.phone_e164 !== phone) {
    throw Object.assign(new Error("Этот мессенджер уже привязан к другому номеру."), { http: 409 });
  }
  const known = await resolveKnownExternalPartyByPhone(client, phone);
  if (!known && !input.allowSelfRegistration) {
    throw Object.assign(
      new Error("Номер не найден среди контактов Тандор. Попросите сотрудника добавить вас в передачу."),
      { http: 403 },
    );
  }
  const name = (known?.displayName || input.displayName || "Клиент").trim().slice(0, 200) || "Клиент";
  const partyId = known?.partyId ?? await resolveOrCreateGlobalExternalPartyByPhone(client, {
    phoneE164: phone, displayName: name, createdByUserId: null,
  });
  let person = (
    await client.query<ExternalPersonRow>(
      `SELECT id::text, phone_e164, display_name, party_id::text FROM tt_external_persons WHERE phone_e164 = $1 LIMIT 1`,
      [phone],
    )
  ).rows[0];
  if (!person) {
    person = (
      await client.query<ExternalPersonRow>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id)
         VALUES ($1, $2, $3::uuid)
         RETURNING id::text, phone_e164, display_name, party_id::text`,
        [phone, name, partyId],
      )
    ).rows[0]!;
  } else if (person.party_id !== partyId) {
    throw Object.assign(new Error("Конфликт данных контакта. Обратитесь к сотруднику Тандор."), { http: 409 });
  }
  await client.query(
    `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id, notifications_enabled, opted_out_at)
     VALUES ($1::uuid, $2, $3, $4, TRUE, NULL)
     ON CONFLICT (channel, messenger_user_id) DO UPDATE SET
       person_id = EXCLUDED.person_id,
       messenger_chat_id = EXCLUDED.messenger_chat_id,
       verified_at = NOW(),
       notifications_enabled = TRUE,
       opted_out_at = NULL`,
    [person.id, input.channel, input.messengerUserId.toString(), input.messengerChatId.toString()],
  );
  return person;
}

/** New browser session: does not bump access_epoch (other devices stay valid). Revoke only this session slot via logout. */
export async function createPersonBrowserSession(
  client: PoolClient,
  personId: string,
  channel: ExternalMessengerChannel,
): Promise<string> {
  await assertPersonHasVerificationChannel(client, personId, channel);
  const pepper = requireHandoffOtpPepper();
  const { raw, hash, exp } = mintExternalPersonSessionToken(personId, 30 * 60_000);
  await client.query(
    `INSERT INTO tt_external_person_sessions (token_hash, person_id, channel, expires_at)
     VALUES ($1, $2::uuid, $3, $4)`,
    [hash, personId, channel, exp],
  );
  return raw;
}

/** Explicit logout-all: invalidates capability tokens on every device. */
export async function revokeAllExternalPersonSessions(client: PoolClient, personId: string): Promise<void> {
  await client.query(
    `UPDATE tt_external_persons SET access_epoch = access_epoch + 1, updated_at = NOW() WHERE id = $1::uuid`,
    [personId],
  );
  await client.query(
    `UPDATE tt_external_person_sessions SET revoked_at = NOW()
     WHERE person_id = $1::uuid AND revoked_at IS NULL`,
    [personId],
  );
}
