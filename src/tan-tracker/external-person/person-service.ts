import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../phone-normalize";
import { mintExternalPersonSessionToken } from "./session-token";
import { requireHandoffOtpPepper } from "../otp-config";

export type ExternalPersonRow = {
  id: string;
  phone_e164: string;
  display_name: string;
  party_id: string;
};

export async function findPersonByMessenger(
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

export async function upsertVerifiedPerson(
  client: PoolClient,
  input: {
    channel: "telegram" | "max";
    messengerUserId: bigint;
    messengerChatId: bigint;
    phoneRaw: string;
    displayName: string | null;
  },
): Promise<ExternalPersonRow> {
  const phone = normalizeRuPhoneE164(input.phoneRaw);
  if (!phone) {
    throw Object.assign(new Error("Некорректный номер телефона."), { http: 400 });
  }
  const existingByMessenger = await findPersonByMessenger(client, input.channel, input.messengerUserId);
  if (existingByMessenger && existingByMessenger.phone_e164 !== phone) {
    throw Object.assign(new Error("Этот мессенджер уже привязан к другому номеру."), { http: 409 });
  }
  const extParty = (
    await client.query<{ id: string }>(
      `SELECT id::text FROM tt_parties WHERE kind = 'external' AND phone_e164 = $1 ORDER BY created_at ASC LIMIT 1`,
      [phone],
    )
  ).rows[0];
  let partyId: string;
  if (extParty) {
    partyId = extParty.id;
  } else {
    const name = (input.displayName || "Клиент").trim().slice(0, 200) || "Клиент";
    partyId = (
      await client.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
         VALUES ('external', $1, $2, NULL) RETURNING id::text`,
        [name, phone],
      )
    ).rows[0]!.id;
  }
  let person = (
    await client.query<ExternalPersonRow>(
      `SELECT id::text, phone_e164, display_name, party_id::text FROM tt_external_persons WHERE phone_e164 = $1 LIMIT 1`,
      [phone],
    )
  ).rows[0];
  if (!person) {
    const name = (input.displayName || "Клиент").trim().slice(0, 200) || "Клиент";
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
    `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
     VALUES ($1::uuid, $2, $3, $4)
     ON CONFLICT (channel, messenger_user_id) DO UPDATE SET
       person_id = EXCLUDED.person_id,
       messenger_chat_id = EXCLUDED.messenger_chat_id,
       verified_at = NOW()`,
    [person.id, input.channel, input.messengerUserId.toString(), input.messengerChatId.toString()],
  );
  return person;
}

export async function createPersonBrowserSession(
  client: PoolClient,
  personId: string,
  channel: "telegram" | "max",
): Promise<string> {
  const pepper = requireHandoffOtpPepper();
  const { raw, hash, exp } = mintExternalPersonSessionToken(personId, 30 * 60_000);
  await client.query(
    `UPDATE tt_external_persons SET access_epoch = access_epoch + 1, updated_at = NOW() WHERE id = $1::uuid`,
    [personId],
  );
  await client.query(
    `UPDATE tt_external_person_sessions SET revoked_at = NOW()
     WHERE person_id = $1::uuid AND revoked_at IS NULL`,
    [personId],
  );
  await client.query(
    `INSERT INTO tt_external_person_sessions (token_hash, person_id, channel, expires_at)
     VALUES ($1, $2::uuid, $3, $4)`,
    [hash, personId, channel, exp],
  );
  return raw;
}
