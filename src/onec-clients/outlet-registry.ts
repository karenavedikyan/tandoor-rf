import type { PoolClient } from "pg";
import type { ParsedRetailOutlet, RetailOutletClosureHistoryEntry } from "./extended-types";
import type { OutletGuidRegistryRow } from "./outlet-identity";

type RegistryQueryRow = {
  guid_store: string;
  guid_client: string;
  is_closed: boolean | null;
  closure_history: RetailOutletClosureHistoryEntry[] | null;
};

export async function loadOutletGuidRegistry(client: PoolClient): Promise<Map<string, OutletGuidRegistryRow>> {
  const result = await client.query<RegistryQueryRow>(
    `
      SELECT
        guid_store::text,
        guid_client::text,
        is_closed,
        closure_history
      FROM onec_retail_outlets
    `,
  );
  const map = new Map<string, OutletGuidRegistryRow>();
  for (const row of result.rows) {
    map.set(row.guid_store.toLowerCase(), {
      guid_store: row.guid_store,
      guid_client: row.guid_client,
      is_closed: row.is_closed,
      closure_history: Array.isArray(row.closure_history) ? row.closure_history : [],
    });
  }
  return map;
}

export async function upsertOutletRegistryEntries(
  client: PoolClient,
  clientGuid: string,
  outlets: ParsedRetailOutlet[],
  sourceSha256: string,
  importedAt: string,
): Promise<void> {
  for (const outlet of outlets) {
    if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
      continue;
    }
    await client.query(
      `
        INSERT INTO onec_retail_outlets (
          guid_store,
          guid_client,
          is_closed,
          first_source_sha256,
          last_source_sha256,
          first_imported_at,
          last_imported_at,
          closure_history,
          updated_at
        )
        VALUES (
          $1::uuid, $2::uuid, $3, $4, $4, $5::timestamptz, $5::timestamptz, $6::jsonb, NOW()
        )
        ON CONFLICT (guid_store) DO UPDATE SET
          guid_client = EXCLUDED.guid_client,
          is_closed = EXCLUDED.is_closed,
          last_source_sha256 = EXCLUDED.last_source_sha256,
          last_imported_at = EXCLUDED.last_imported_at,
          closure_history = EXCLUDED.closure_history,
          updated_at = NOW()
      `,
      [
        outlet.guidStore,
        clientGuid,
        outlet.closed,
        sourceSha256,
        importedAt,
        JSON.stringify(outlet.closureHistory),
      ],
    );
  }
}
