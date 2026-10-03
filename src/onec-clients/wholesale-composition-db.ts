import type { Pool, PoolClient } from "pg";
import type { ExistingCompositionContext } from "./wholesale-composition";

export async function loadExistingCompositionContext(
  client: Pool | PoolClient,
): Promise<ExistingCompositionContext> {
  const [clients, outlets, accessGrants, bitrixLinks] = await Promise.all([
    client.query<{ guid_client: string }>("SELECT guid_client::text FROM onec_clients"),
    client.query<{ guid_client: string; count: string }>(
      `
        SELECT guid_client::text, COUNT(*)::text AS count
        FROM onec_retail_outlets
        GROUP BY guid_client
      `,
    ),
    client.query<{ object_id: string; count: string }>(
      `
        SELECT object_id::text, COUNT(DISTINCT user_id)::text AS count
        FROM access_grants
        WHERE grant_type = 'client'
        GROUP BY object_id
      `,
    ),
    client.query<{ object_guid: string; count: string }>(
      `
        SELECT object_guid::text, COUNT(*)::text AS count
        FROM bitrix24_client_card_objects
        GROUP BY object_guid
      `,
    ),
  ]);

  const clientGuids = new Set(clients.rows.map((row) => row.guid_client.toLowerCase()));
  const confirmedOutletsByClient = new Map<string, number>();
  for (const row of outlets.rows) {
    confirmedOutletsByClient.set(row.guid_client.toLowerCase(), Number(row.count));
  }
  const linkedAccountsByClient = new Map<string, number>();
  for (const row of accessGrants.rows) {
    linkedAccountsByClient.set(row.object_id.toLowerCase(), Number(row.count));
  }
  const bitrixTaskLinksByClient = new Map<string, number>();
  for (const row of bitrixLinks.rows) {
    bitrixTaskLinksByClient.set(row.object_guid.toLowerCase(), Number(row.count));
  }

  return {
    clientGuids,
    linkedAccountsByClient,
    confirmedOutletsByClient,
    bitrixTaskLinksByClient,
  };
}
