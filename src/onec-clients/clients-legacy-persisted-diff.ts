import type { PoolClient } from "pg";
import type { ValidatedClientsPayload } from "./types";

function telephoneEqual(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** True when incoming legacy client fields differ from persisted onec_clients rows. */
export async function clientsLegacyBusinessIncomingDiffersFromStored(
  client: PoolClient,
  payload: ValidatedClientsPayload,
): Promise<boolean> {
  if (payload.records.length === 0) {
    return false;
  }

  const guids = payload.records.map((record) => record.guid_client);
  const rows = await client.query<{
    guid_client: string;
    name_client: string;
    guid_holding: string | null;
    name_holding: string;
    guid_manager: string;
    name_manager: string;
    address: string;
    telephone: unknown;
  }>(
    `
      SELECT
        guid_client::text,
        name_client,
        guid_holding::text,
        name_holding,
        guid_manager::text,
        name_manager,
        address,
        telephone
      FROM onec_clients
      WHERE guid_client = ANY($1::uuid[])
    `,
    [guids],
  );

  const existingByGuid = new Map(rows.rows.map((row) => [row.guid_client.toLowerCase(), row]));

  for (const incoming of payload.records) {
    const existing = existingByGuid.get(incoming.guid_client.toLowerCase());
    if (!existing) {
      return true;
    }
    const telephone = Array.isArray(existing.telephone) ? (existing.telephone as string[]) : [];
    if (
      existing.name_client !== incoming.name_client ||
      (existing.guid_holding ?? null) !== incoming.guid_holding ||
      existing.name_holding !== incoming.name_holding ||
      existing.guid_manager !== incoming.guid_manager ||
      existing.name_manager !== incoming.name_manager ||
      existing.address !== incoming.address ||
      !telephoneEqual(telephone, incoming.telephone)
    ) {
      return true;
    }
  }

  return false;
}
