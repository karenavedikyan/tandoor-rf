import type { PoolClient } from "pg";

export type KnownExternalParty = {
  partyId: string;
  displayName: string;
};

/** External party must already exist (staff-created contact). No self-registration. */
export async function resolveKnownExternalPartyByPhone(
  client: PoolClient,
  phoneE164: string,
): Promise<KnownExternalParty | null> {
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
    throw Object.assign(new Error("Этот номер принадлежит сотруднику. Используйте личный кабинет."), { http: 403 });
  }

  const canonical = await client.query<{ party_id: string }>(
    `SELECT party_id::text FROM tt_phone_canonical_parties WHERE phone_e164 = $1 LIMIT 1`,
    [phoneE164],
  );
  if (canonical.rows[0]) {
    const party = await client.query<{ id: string; display_name: string }>(
      `SELECT id::text, display_name FROM tt_parties WHERE id = $1::uuid AND kind = 'external' LIMIT 1`,
      [canonical.rows[0].party_id],
    );
    if (party.rows[0]) {
      return { partyId: party.rows[0].id, displayName: party.rows[0].display_name };
    }
  }
  const row = await client.query<{ id: string; display_name: string }>(
    `SELECT id::text, display_name FROM tt_parties
     WHERE kind = 'external' AND phone_e164 = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [phoneE164],
  );
  const party = row.rows[0];
  if (!party) return null;
  const dup = await client.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM tt_parties WHERE kind = 'external' AND phone_e164 = $1`,
    [phoneE164],
  );
  if ((dup.rows[0]?.c ?? 0) > 1) {
    throw Object.assign(
      new Error("Для номера найдено несколько контактов. Администратор должен выбрать основной."),
      { http: 409 },
    );
  }
  return { partyId: party.id, displayName: party.display_name };
}
