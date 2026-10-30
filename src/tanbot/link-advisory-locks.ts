import type { PoolClient } from "pg";

/** Lock order: LK user first, then messenger identity (same order everywhere). */
export async function lockTanbotTelegramLkUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(845001, hashtext($1::text))`, [userId]);
}

export async function lockTanbotTelegramMessenger(client: PoolClient, telegramUserId: bigint): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(845011, hashtext($1::text))`, [telegramUserId.toString()]);
}

export async function lockTanbotMaxLkUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(845002, hashtext($1::text))`, [userId]);
}

export async function lockTanbotMaxMessenger(client: PoolClient, maxUserId: bigint): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(845012, hashtext($1::text))`, [maxUserId.toString()]);
}

export async function assertLkUserActiveForTanbotLink(client: PoolClient, userId: string): Promise<void> {
  const row = await client.query<{ status: string }>(`SELECT status FROM users WHERE id = $1::uuid LIMIT 1`, [
    userId,
  ]);
  if (!row.rows[0] || row.rows[0].status !== "active") {
    throw Object.assign(new Error("Аккаунт недоступен для привязки."), { http: 409 });
  }
}
