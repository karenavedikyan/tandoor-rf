import type { Pool, PoolClient } from "pg";
import type { TanTrackerContactDto } from "./types";

type Db = Pool | PoolClient;
export const PRIVATE_EXTERNAL_RECIPIENT_DISPLAY_NAME = "Внешний получатель";
/** Personal presentation metadata, not a shared contact rename or an identity binding. */
export async function saveContactAlias(
  client: Db, ownerPartyId: string, actorUserId: string | null, partyId: string, name: string | undefined,
): Promise<void> {
  const alias = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 200) : "";
  if (!alias || partyId === ownerPartyId) return;
  // No schema change: append-only metadata uses the existing audit JSON.
  await client.query(
    `INSERT INTO tt_audit_log(acting_party_id,actor_user_id,action,detail)
     VALUES($1::uuid,$2::uuid,'contact_alias',$3::jsonb)`,
    [ownerPartyId, actorUserId, JSON.stringify({ partyId, name: alias })],
  );
}

export async function loadContactAliases(client: Db, ownerPartyId: string | null): Promise<Map<string, string>> {
  if (!ownerPartyId) return new Map();
  const rows = (await client.query<{ party_id: string; name: string }>(
    `SELECT DISTINCT ON (detail->>'partyId') detail->>'partyId' AS party_id,detail->>'name' AS name
     FROM tt_audit_log WHERE acting_party_id=$1::uuid AND action='contact_alias'
     ORDER BY detail->>'partyId',id DESC`, [ownerPartyId],
  )).rows;
  return new Map(rows.filter(r => r.party_id && r.name).map(r => [r.party_id, r.name]));
}

export async function personalizeContacts(client: Db, ownerPartyId: string | null, contacts: TanTrackerContactDto[]) {
  const aliases = await loadContactAliases(client, ownerPartyId);
  return contacts.map(c => aliases.has(c.id) ? { ...c, name: aliases.get(c.id)! } : c);
}
