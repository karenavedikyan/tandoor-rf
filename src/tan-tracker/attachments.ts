import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;
import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { requireTanTrackerMutationAccess } from "./guards";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOW_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_FILES_PER_TRANSFER = 10;
const MAX_TOTAL_BYTES_PER_TRANSFER = 50 * 1024 * 1024;

function storageRoot(): string {
  return process.env.TT_ATTACHMENTS_DIR?.trim() || path.join(process.cwd(), "var/tt-attachments");
}

function decodeUploadFilename(rawHeader: string): string {
  const trimmed = String(rawHeader ?? "").trim();
  if (!trimmed) return "file";
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  decoded = path.basename(decoded).replace(/[\0\r\n/\\]/g, "").slice(0, 200);
  return decoded || "file";
}

export function contentDispositionFilename(
  name: string,
  disposition: "inline" | "attachment" = "inline",
): string {
  const safeName = path.basename(String(name ?? ""))
    .replace(/[\0\r\n"\\]/g, "")
    .slice(0, 200) || "file";
  const ext = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  const asciiBase = base.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim();
  let asciiFallback = asciiBase ? `${asciiBase}${ext}` : ext ? `file${ext}` : "file";
  asciiFallback = asciiFallback.replace(/["\\]/g, "_") || "file";
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export async function stageAttachmentHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user } = gate;
  const filename = decodeUploadFilename(String(req.headers["x-tt-filename"] ?? "file"));
  const mime = String(req.headers["x-tt-mime-type"] ?? "application/octet-stream").toLowerCase();
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (!buf.length || buf.length > MAX_FILE_BYTES) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый размер файла."));
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  const extOk = [".pdf", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".doc", ".docx", ".xls", ".xlsx"].includes(
    ext,
  );
  if (!ALLOW_MIME.has(mime) && !(extOk && (!mime || mime === "application/octet-stream"))) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Тип файла не поддерживается."));
    return;
  }
  const id = crypto.randomUUID();
  const key = path.join("staged", user.id, `${id}-${filename}`);
  const abs = path.join(storageRoot(), key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO tt_staged_attachments (id, owner_user_id, storage_key, original_name, mime_type, byte_size)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)`,
      [id, user.id, key, filename, mime, buf.length],
    );
  });
  setNoStore(res);
  res.status(201).json({ id, name: filename, mimeType: mime, byteSize: buf.length });
}

export async function linkStagedAttachmentsToTransfer(
  client: Db,
  userId: string,
  transferId: string,
  stagingIds: string[],
): Promise<void> {
  if (!stagingIds.length) return;
  const res = await client.query<{ id: string; storage_key: string; original_name: string; mime_type: string; byte_size: string }>(
    `SELECT id::text, storage_key, original_name, mime_type, byte_size::text
     FROM tt_staged_attachments
     WHERE owner_user_id = $1::uuid AND id = ANY($2::uuid[]) AND consumed_at IS NULL
     FOR UPDATE`,
    [userId, stagingIds],
  );
  if (res.rows.length !== stagingIds.length) {
    throw Object.assign(new Error("Вложение не найдено или уже использовано."), { http: 400 });
  }
  const existing = await client.query<{ cnt: string; total: string }>(
    `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(byte_size),0)::text AS total
     FROM tt_transfer_attachments WHERE transfer_id = $1`,
    [transferId],
  );
  const existingCount = Number(existing.rows[0]?.cnt ?? 0);
  const existingTotal = Number(existing.rows[0]?.total ?? 0);
  const addTotal = res.rows.reduce((s, r) => s + Number(r.byte_size), 0);
  if (existingCount + res.rows.length > MAX_FILES_PER_TRANSFER) {
    throw Object.assign(new Error(`Не более ${MAX_FILES_PER_TRANSFER} файлов на передачу.`), { http: 400 });
  }
  if (existingTotal + addTotal > MAX_TOTAL_BYTES_PER_TRANSFER) {
    throw Object.assign(new Error("Общий объём вложений превышает лимит."), { http: 400 });
  }
  for (const row of res.rows) {
    await client.query(
      `INSERT INTO tt_transfer_attachments (transfer_id, storage_key, original_name, mime_type, byte_size, uploaded_by_user_id)
       VALUES ($1,$2,$3,$4,$5::bigint,$6::uuid)`,
      [transferId, row.storage_key, row.original_name, row.mime_type, row.byte_size, userId],
    );
    await client.query(`UPDATE tt_staged_attachments SET consumed_at = NOW() WHERE id = $1::uuid`, [row.id]);
  }
}

export async function listAttachmentsForTransfers(
  client: Db,
  transferIds: string[],
): Promise<
  Map<
    string,
    Array<{ id: string; name: string; mimeType: string; byteSize: number; addedAt: number; addedBy: string | null }>
  >
> {
  const map = new Map<
    string,
    Array<{ id: string; name: string; mimeType: string; byteSize: number; addedAt: number; addedBy: string | null }>
  >();
  if (!transferIds.length) return map;
  const res = await client.query<{
    transfer_id: string;
    id: string;
    original_name: string;
    mime_type: string;
    byte_size: string;
    created_at: Date;
    added_by_party_id: string | null;
  }>(
    `SELECT a.transfer_id, a.id::text, a.original_name, a.mime_type, a.byte_size::text, a.created_at,
            p.id::text AS added_by_party_id
     FROM tt_transfer_attachments a
     LEFT JOIN tt_parties p ON p.user_id = a.uploaded_by_user_id AND p.kind = 'user'
     WHERE a.transfer_id = ANY($1::text[])
     ORDER BY a.created_at ASC`,
    [transferIds],
  );
  for (const row of res.rows) {
    const list = map.get(row.transfer_id) ?? [];
    list.push({
      id: row.id,
      name: row.original_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      addedAt: row.created_at.getTime(),
      addedBy: row.added_by_party_id,
    });
    map.set(row.transfer_id, list);
  }
  return map;
}

export function attachmentAbsolutePath(storageKey: string): string {
  return path.join(storageRoot(), storageKey);
}

export async function downloadAttachmentHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!req.authUser || !req.accessContext) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }
  const transferId = String(req.params.id ?? "").trim();
  const attId = String(req.params.attId ?? "").trim();
  const pool = await import("../db/pool").then((m) => m.getPool());
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
    return;
  }
  const row = (
    await pool.query<{ storage_key: string; original_name: string; mime_type: string }>(
      `SELECT storage_key, original_name, mime_type FROM tt_transfer_attachments
       WHERE id = $1::uuid AND transfer_id = $2 LIMIT 1`,
      [attId, transferId],
    )
  ).rows[0];
  if (!row) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Вложение не найдено."));
    return;
  }
  const { buildTanTrackerBootstrap } = await import("./service");
  const bootstrap = await buildTanTrackerBootstrap(req.authUser, req.accessContext);
  if (!bootstrap.orders.some((o) => o.id === transferId || o.attachments?.some((a) => a.id === attId))) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нет доступа к вложению."));
    return;
  }
  const abs = attachmentAbsolutePath(row.storage_key);
  try {
    const data = await fs.readFile(abs);
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Content-Disposition", contentDispositionFilename(row.original_name));
    res.status(200).send(data);
  } catch {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Файл не найден."));
  }
}
