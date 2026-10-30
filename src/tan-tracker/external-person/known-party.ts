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

  const row = await client.query<{ id: string; display_name: string }>(
    `SELECT id::text, display_name FROM tt_parties
     WHERE kind = 'external' AND phone_e164 = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [phoneE164],
  );
  const party = row.rows[0];
  if (!party) return null;
  return { partyId: party.id, displayName: party.display_name };
}
