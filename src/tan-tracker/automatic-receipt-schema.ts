import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { resolveMigrationsDir } from "../db/migrate-runner";

export async function ensureAutomaticReceiptSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='30s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [902_451_003]);
    const exists = (
      await client.query(
        "SELECT to_regclass('public.tt_automatic_receipt_codes') AS name",
      )
    ).rows[0]?.name;
    if (!exists)
      await client.query(
        await fs.readFile(
          path.join(
            resolveMigrationsDir(),
            "079_tt_automatic_receipt_codes.sql",
          ),
          "utf8",
        ),
      );
    await client.query(`SELECT id,transfer_id,handoff_version,pending_party_id,channel,messenger_user_id,
      messenger_chat_id,phone_snapshot,status,generation,encrypted_code,code_hash,code_expires_at,header_sent_at,
      sent_at,attempt_count,next_attempt_at,last_error_code,created_at FROM tt_automatic_receipt_codes LIMIT 0`);
    const unique = await client.query(`SELECT 1 FROM pg_constraint
      WHERE conrelid='tt_automatic_receipt_codes'::regclass AND contype='u'
        AND pg_get_constraintdef(oid)='UNIQUE (transfer_id, handoff_version)'`);
    if (!unique.rows.length)
      throw Object.assign(new Error("QUEUE_SCHEMA_INVALID"), {
        code: "QUEUE_SCHEMA_INVALID",
      });
    await client.query(
      "INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT(filename) DO NOTHING",
      ["079_tt_automatic_receipt_codes.sql"],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
