import type { Pool, PoolClient } from "pg";
import { isUuid, normalizeRuPhoneE164 } from "./phone-normalize";
import { assertNoEmployeePhoneCollision } from "./phone-party-resolver";

type Db = Pool | PoolClient;

export class PhoneCanonicalValidationError extends Error {
  readonly http: number;
  constructor(message: string, http = 400) {
    super(message);
    this.name = "PhoneCanonicalValidationError";
    this.http = http;
  }
}

/** Admin canonical row: external party phone must match normalized key; no employee collision; no person rebind. */
export async function validateAdminPhoneCanonicalAssignment(
  client: Db,
  input: { phoneE164Raw: string; partyId: string },
): Promise<{ phoneE164: string; partyId: string }> {
  const phoneE164 = normalizeRuPhoneE164(input.phoneE164Raw);
  if (!phoneE164) {
    throw new PhoneCanonicalValidationError("Некорректный номер: 10 цифр после +7.", 400);
  }
  const partyId = input.partyId.trim();
  if (!isUuid(partyId)) {
    throw new PhoneCanonicalValidationError("Некорректный идентификатор контакта.", 400);
  }

  await assertNoEmployeePhoneCollision(client, phoneE164);

  const party = await client.query<{ kind: string; phone_e164: string | null }>(
    `SELECT kind, phone_e164 FROM tt_parties WHERE id = $1::uuid LIMIT 1`,
    [partyId],
  );
  const row = party.rows[0];
  if (!row || row.kind !== "external") {
    throw new PhoneCanonicalValidationError("Каноническим может быть только внешний контакт.", 400);
  }
  if (row.phone_e164 !== phoneE164) {
    throw new PhoneCanonicalValidationError("Выбранный контакт привязан к другому номеру.", 409);
  }

  const person = await client.query<{ party_id: string }>(
    `SELECT party_id::text FROM tt_external_persons WHERE phone_e164 = $1 LIMIT 1`,
    [phoneE164],
  );
  if (person.rows[0] && person.rows[0].party_id !== partyId) {
    throw new PhoneCanonicalValidationError(
      "Для номера уже есть проверенный профиль с другим контактом. Смена канона без слияния запрещена.",
      409,
    );
  }

  return { phoneE164, partyId };
}

/** Resolve canonical external party only when party.phone_e164 matches the canonical phone key. */
export async function loadCanonicalExternalPartyForPhone(
  client: Db,
  phoneE164: string,
): Promise<{ id: string; display_name: string } | null> {
  const canonical = await client.query<{ party_id: string }>(
    `SELECT party_id::text FROM tt_phone_canonical_parties WHERE phone_e164 = $1 LIMIT 1`,
    [phoneE164],
  );
  if (!canonical.rows[0]) return null;

  const party = await client.query<{ id: string; display_name: string; phone_e164: string | null; kind: string }>(
    `SELECT id::text AS id, display_name, phone_e164, kind FROM tt_parties WHERE id = $1::uuid LIMIT 1`,
    [canonical.rows[0].party_id],
  );
  const row = party.rows[0];
  if (!row || row.kind !== "external") {
    throw new PhoneCanonicalValidationError("Каноническая запись указывает на недопустимый контакт.", 409);
  }
  if (row.phone_e164 !== phoneE164) {
    throw new PhoneCanonicalValidationError("Канонический контакт не соответствует номеру.", 409);
  }
  return { id: row.id, display_name: row.display_name };
}
