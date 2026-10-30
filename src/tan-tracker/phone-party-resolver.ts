import type { Pool, PoolClient } from "pg";
import { loadCanonicalExternalPartyForPhone } from "./phone-canonical-validation";
import { upsertPhoneDedupeConflictForPhone } from "./phone-dedupe";

type Db = Pool | PoolClient;

const PHONE_PARTY_LOCK_NS = 845_020;

export class PhonePartyConflictError extends Error {
  readonly http = 409;
  readonly phoneE164: string;
  constructor(phoneE164: string) {
    super("Для номера найдено несколько контактов. Администратор должен выбрать основной.");
    this.name = "PhonePartyConflictError";
    this.phoneE164 = phoneE164;
  }
}

export class EmployeePhoneCollisionError extends Error {
  readonly http = 403;
  constructor() {
    super("Этот номер принадleжит сотруднику. Используйте личный кабинет.");
    this.name = "EmployeePhoneCollisionError";
  }
}

/** Transaction-scoped lock: one creator at a time per normalized phone. */
export async function lockPhonePartyResolution(client: Db, phoneE164: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2::text))`, [PHONE_PARTY_LOCK_NS, phoneE164]);
}

export async function assertNoEmployeePhoneCollision(client: Db, phoneE164: string): Promise<void> {
  const employeeCollision = await client.query(
    `SELECT 1 FROM users u
     WHERE u.status = 'active'
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
  if ((employeeCollision.rowCount ?? 0) > 0) {
    throw new EmployeePhoneCollisionError();
  }
}

type ExternalPartyPick = { id: string; display_name: string };

/** Canonical admin pick, else oldest external when unambiguous; null if none. */
export async function pickGlobalExternalPartyForPhone(
  client: Db,
  phoneE164: string,
): Promise<ExternalPartyPick | null> {
  const canonicalParty = await loadCanonicalExternalPartyForPhone(client, phoneE164);
  if (canonicalParty) return canonicalParty;

  const rows = await client.query<ExternalPartyPick>(
    `SELECT id::text AS id, display_name FROM tt_parties
     WHERE kind = 'external' AND phone_e164 = $1
     ORDER BY created_at ASC`,
    [phoneE164],
  );
  if (rows.rowCount === 0) return null;
  if (rows.rowCount === 1) return rows.rows[0]!;
  await upsertPhoneDedupeConflictForPhone(client, phoneE164);
  throw new PhonePartyConflictError(phoneE164);
}

/**
 * Global phone-first external party for staff/public-holder create paths.
 * Reuses existing rows (no rename). Creates when absent under advisory lock.
 */
export async function resolveOrCreateGlobalExternalPartyByPhone(
  client: Db,
  input: { phoneE164: string; displayName: string; createdByUserId: string },
): Promise<string> {
  const name = input.displayName.trim();
  if (!name) {
    throw Object.assign(new Error("Введите имя получателя."), { http: 400 });
  }
  await lockPhonePartyResolution(client, input.phoneE164);
  await assertNoEmployeePhoneCollision(client, input.phoneE164);

  const existing = await pickGlobalExternalPartyForPhone(client, input.phoneE164);
  if (existing) return existing.id;

  const res = await client.query<{ id: string }>(
    `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
     VALUES ('external', $1, $2, $3::uuid)
     RETURNING id::text`,
    [name, input.phoneE164, input.createdByUserId],
  );
  return res.rows[0]!.id;
}

/** Read-only lookup for bots (throws on employee collision or unresolved duplicate). */
export async function resolveKnownGlobalExternalPartyByPhone(
  client: Db,
  phoneE164: string,
): Promise<{ partyId: string; displayName: string } | null> {
  await assertNoEmployeePhoneCollision(client, phoneE164);
  const pick = await pickGlobalExternalPartyForPhone(client, phoneE164);
  if (!pick) return null;
  return { partyId: pick.id, displayName: pick.display_name };
}
