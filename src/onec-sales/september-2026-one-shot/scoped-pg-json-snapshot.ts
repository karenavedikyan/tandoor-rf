import type { PoolClient } from "pg";

/** Capture scoped rows as PostgreSQL `json_agg(row_to_json)` text — no JS Number/Date coercion. */
export async function capturePgJsonRowset(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  const result = await client.query<{ snapshot_json: string }>(sql, params);
  const text = result.rows[0]?.snapshot_json;
  if (text === undefined || text === null) {
    return "[]";
  }
  return text;
}

export async function restorePgJsonRowset(
  client: PoolClient,
  tableName: string,
  jsonText: string,
): Promise<void> {
  if (jsonText === "[]") {
    return;
  }
  await client.query(
    `
      INSERT INTO ${tableName}
      SELECT *
      FROM json_populate_recordset(null::${tableName}, $1::json)
    `,
    [jsonText],
  );
}
