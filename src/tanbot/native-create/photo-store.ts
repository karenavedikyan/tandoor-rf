import type { PoolClient } from "pg";
import crypto from "crypto";
import { writeAttachmentBytes } from "../../tan-tracker/attachments";
import { classifyNativeStorageMime, safeNativeAttachmentFileName } from "./native-attachment-magic";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function draftHasNonImageOnlyAttachments(client: PoolClient, draftId: string): Promise<boolean> {
  const c = await client.query<{ mime_type: string }>(
    `SELECT mime_type FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draftId],
  );
  for (const row of c.rows) {
    const mime = row.mime_type?.toLowerCase() ?? "";
    if (mime === "application/pdf" || mime === "application/octet-stream" || mime.startsWith("video/")) return true;
  }
  return false;
}

/** @deprecated */
export async function draftHasPdfAttachment(client: PoolClient, draftId: string): Promise<boolean> {
  return draftHasNonImageOnlyAttachments(client, draftId);
}

export async function photoCountForDraft(client: PoolClient, draftId: string): Promise<number> {
  const c = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draftId],
  );
  return c.rows[0]?.n ?? 0;
}

export async function appendNativeCreateDraftPhoto(
  client: PoolClient,
  input: {
    draftId: string;
    sortOrder: number;
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    telegramFileId?: string | null;
    maxFileToken?: string | null;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!input.buffer.length) {
    return { ok: false, message: "Не удалось принять пустой файл." };
  }
  if (input.buffer.length > MAX_PHOTO_BYTES) {
    return { ok: false, message: "Файл больше 8 МБ. Отправьте файл меньше." };
  }
  const mimeType = classifyNativeStorageMime(input.buffer);
  const safeFileName = safeNativeAttachmentFileName(input.fileName);
  const key = `native-draft/${input.draftId}/${crypto.randomUUID()}-${safeFileName}`;
  await writeAttachmentBytes(client, key, input.buffer);
  await client.query(
    `INSERT INTO tt_external_request_draft_files (
       draft_id, storage_key, file_name, mime_type, byte_size, sort_order, telegram_file_id, max_file_token)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.draftId,
      key,
      safeFileName,
      mimeType,
      input.buffer.length,
      input.sortOrder,
      input.telegramFileId?.trim() || null,
      input.maxFileToken?.trim() || null,
    ],
  );
  return { ok: true };
}
