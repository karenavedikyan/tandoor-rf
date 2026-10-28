import type { Pool } from "pg";

export async function loadPartyEmployeeMap(
  pool: Pool,
  partyIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (partyIds.length === 0) return map;
  const res = await pool.query<{ id: string; employee_id: string | null }>(
    `
      SELECT p.id::text AS id, uoel.employee_id::text AS employee_id
      FROM tt_parties p
      LEFT JOIN user_onec_employee_links uoel
        ON uoel.user_id = p.user_id AND uoel.revoked_at IS NULL
      WHERE p.id = ANY($1::uuid[])
    `,
    [partyIds],
  );
  for (const row of res.rows) {
    map.set(row.id, row.employee_id);
  }
  return map;
}

export function employeeIdForParty(
  partyId: string | null | undefined,
  map: Map<string, string | null>,
): string | null {
  if (!partyId) return null;
  return map.get(partyId) ?? null;
}
