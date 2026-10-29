import fs from "fs/promises";
import path from "path";
import type { PoolClient } from "pg";
import { resolveTanTrackerAttachmentsBackend } from "../shared/tan-tracker-attachments-config";

type Db = { query: PoolClient["query"] };

function storageRoot(): string {
  return process.env.TT_ATTACHMENTS_DIR?.trim() || path.join(process.cwd(), "var/tt-attachments");
}

export function attachmentAbsolutePath(storageKey: string): string {
  return path.join(storageRoot(), storageKey);
}

function usePostgres(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveTanTrackerAttachmentsBackend(env) === "postgres";
}

export async function writeAttachmentBytes(
  client: Db | null,
  storageKey: string,
  buf: Buffer,
): Promise<void> {
  if (usePostgres()) {
    if (!client) {
      throw new Error("PostgreSQL attachment backend requires a database client.");
    }
    await client.query(
      `INSERT INTO tt_attachment_blobs (storage_key, content, byte_size)
       VALUES ($1, $2, $3)
       ON CONFLICT (storage_key) DO UPDATE SET content = EXCLUDED.content, byte_size = EXCLUDED.byte_size`,
      [storageKey, buf, buf.length],
    );
    return;
  }
  const abs = attachmentAbsolutePath(storageKey);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
}

export async function readAttachmentBytes(storageKey: string, client: Db | null = null): Promise<Buffer> {
  if (usePostgres()) {
    const db = client ?? (await import("../db/pool").then((m) => m.getPool()));
    if (!db) {
      throw Object.assign(new Error("Database unavailable."), { code: "ENOENT" as const });
    }
    const row = (
      await db.query<{ content: Buffer }>(
        `SELECT content FROM tt_attachment_blobs WHERE storage_key = $1 LIMIT 1`,
        [storageKey],
      )
    ).rows[0];
    if (!row) {
      throw Object.assign(new Error("Attachment blob not found."), { code: "ENOENT" as const });
    }
    return row.content;
  }
  return fs.readFile(attachmentAbsolutePath(storageKey));
}

export async function deleteAttachmentBytes(
  storageKey: string,
  client: Db | null = null,
): Promise<void> {
  if (usePostgres()) {
    const db = client ?? (await import("../db/pool").then((m) => m.getPool()));
    if (!db) return;
    await db.query(`DELETE FROM tt_attachment_blobs WHERE storage_key = $1`, [storageKey]);
    return;
  }
  try {
    await fs.unlink(attachmentAbsolutePath(storageKey));
  } catch {
    /* missing file */
  }
}
