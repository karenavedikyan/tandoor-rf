import { Pool, type PoolClient } from "pg";
import type { ParsedClientRecord } from "../../src/onec-clients/types";

export async function seedOnecClientsForReconcile(
  client: PoolClient,
  records: ParsedClientRecord[],
  sourceSha256: string,
): Promise<void> {
  for (const record of records) {
    await client.query(
      `
        INSERT INTO onec_clients (
          guid_client, name_client, guid_holding, name_holding,
          guid_manager, name_manager, address, telephone, source_sha256
        ) VALUES (
          $1::uuid, $2, $3::uuid, $4,
          $5::uuid, $6, $7, $8::jsonb, $9
        )
        ON CONFLICT (guid_client) DO UPDATE SET
          name_client = EXCLUDED.name_client,
          guid_holding = EXCLUDED.guid_holding,
          name_holding = EXCLUDED.name_holding,
          source_sha256 = EXCLUDED.source_sha256,
          last_imported_at = NOW()
      `,
      [
        record.guid_client,
        record.name_client,
        record.guid_holding,
        record.name_holding,
        record.guid_manager,
        record.name_manager,
        record.address,
        JSON.stringify(record.telephone),
        sourceSha256,
      ],
    );
  }
}

export async function loadActiveLegalLinks(
  pool: Pool,
): Promise<Array<{ guid_client: string; guid_holding_root: string; is_holding_head: boolean }>> {
  const result = await pool.query(
    `
      SELECT guid_client::text, guid_holding_root::text, is_holding_head
      FROM onec_holding_v2_legal_links
      WHERE link_active = TRUE
      ORDER BY guid_client
    `,
  );
  return result.rows;
}

export async function loadActiveOutletLinks(
  pool: Pool,
): Promise<Array<{ guid_store: string; guid_holding_root: string; is_closed: boolean | null; closure_known: boolean }>> {
  const result = await pool.query(
    `
      SELECT guid_store::text, guid_holding_root::text, is_closed, closure_known
      FROM onec_holding_v2_outlet_links
      WHERE link_active = TRUE
      ORDER BY guid_store
    `,
  );
  return result.rows;
}
