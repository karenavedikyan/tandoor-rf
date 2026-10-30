import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/** Scan tt_parties for duplicate phone_e164 across kinds; upsert conflict report rows. */
export async function refreshPhoneDedupeReport(client: Db): Promise<{ conflicts: number }> {
  const dupes = await client.query<{ phone_e164: string; party_ids: string[]; kinds: string[] }>(
    `SELECT phone_e164,
            array_agg(id ORDER BY created_at) AS party_ids,
            array_agg(kind ORDER BY created_at) AS kinds
     FROM tt_parties
     WHERE phone_e164 IS NOT NULL AND phone_e164 <> ''
     GROUP BY phone_e164
     HAVING COUNT(*) > 1`,
  );
  for (const row of dupes.rows) {
    await client.query(
      `INSERT INTO tt_phone_dedupe_conflicts (phone_e164, party_ids, kinds)
       VALUES ($1, $2::uuid[], $3::text[])
       ON CONFLICT (phone_e164) DO UPDATE SET party_ids = EXCLUDED.party_ids, kinds = EXCLUDED.kinds, detected_at = NOW()
       WHERE tt_phone_dedupe_conflicts.resolved_at IS NULL`,
      [row.phone_e164, row.party_ids, row.kinds],
    );
  }
  return { conflicts: dupes.rowCount ?? 0 };
}

/** Upsert one open conflict row for a phone (used when resolver sees ambiguous externals). */
export async function upsertPhoneDedupeConflictForPhone(client: Db, phoneE164: string): Promise<void> {
  const row = await client.query<{ party_ids: string[]; kinds: string[] }>(
    `SELECT array_agg(id ORDER BY created_at) AS party_ids,
            array_agg(kind ORDER BY created_at) AS kinds
     FROM tt_parties
     WHERE phone_e164 = $1
     GROUP BY phone_e164`,
    [phoneE164],
  );
  const agg = row.rows[0];
  if (!agg || agg.party_ids.length < 2) return;
  await client.query(
    `INSERT INTO tt_phone_dedupe_conflicts (phone_e164, party_ids, kinds)
     VALUES ($1, $2::uuid[], $3::text[])
     ON CONFLICT (phone_e164) DO UPDATE SET party_ids = EXCLUDED.party_ids, kinds = EXCLUDED.kinds, detected_at = NOW()
     WHERE tt_phone_dedupe_conflicts.resolved_at IS NULL`,
    [phoneE164, agg.party_ids, agg.kinds],
  );
}
