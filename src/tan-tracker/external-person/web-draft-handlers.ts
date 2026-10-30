import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { withTransaction } from "../../access/db";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { resolveExternalPersonAuth } from "./resolve-auth";
import { requirePersonMessengerProvenance } from "./messenger-provenance";
import { confirmExternalRequestDraft } from "../external-request/confirm";
import { buildExternalPersonBootstrapPayload } from "./bootstrap-build";
import { writeAttachmentBytes } from "../attachments";
import { detectImageMimeFromMagic } from "../../tanbot-telegram/bounded-binary-fetch";
const MAX_DRAFT_PHOTO_BYTES = 8 * 1024 * 1024;

async function resolveCap(req: Request) {
  const pool = getPool();
  if (!pool) return null;
  return resolveExternalPersonAuth(pool, {
    est: String(req.headers["x-tt-external-est"] ?? req.query.est ?? ""),
    cap: String(req.headers["x-tt-external-cap"] ?? req.query.cap ?? ""),
  });
}

export async function getExternalWebDraftHandler(req: Request, res: Response): Promise<void> {
  const person = await resolveCap(req);
  if (!person) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна."));
    return;
  }
  const pool = getPool()!;
  const provenance = await requirePersonMessengerProvenance(pool, person.personId);
  const draft = await pool.query<{ id: string; step: string; payload: Record<string, unknown> }>(
    `SELECT id::text, step, payload FROM tt_external_request_drafts
     WHERE channel = $1 AND messenger_chat_id = $2 AND person_id = $3::uuid
     ORDER BY updated_at DESC LIMIT 1`,
    [provenance.channel, provenance.messengerChatId, person.personId],
  );
  setNoStore(res);
  res.status(200).json({ draft: draft.rows[0] ?? null });
}

export async function upsertExternalWebDraftHandler(req: Request, res: Response): Promise<void> {
  const person = await resolveCap(req);
  if (!person) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна."));
    return;
  }
  const step = String((req.body as { step?: string })?.step ?? "item").slice(0, 32);
  const payload = (req.body as { payload?: Record<string, unknown> })?.payload ?? {};
  const pool = getPool()!;
  const provenance = await requirePersonMessengerProvenance(pool, person.personId);
  const row = await pool.query<{ id: string }>(
    `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
     VALUES ($1, $2, $3::uuid, $4, $5::jsonb)
     ON CONFLICT (channel, messenger_chat_id) DO UPDATE SET
       person_id = EXCLUDED.person_id,
       step = EXCLUDED.step,
       payload = EXCLUDED.payload,
       updated_at = NOW()
     RETURNING id::text`,
    [provenance.channel, provenance.messengerChatId, person.personId, step, JSON.stringify(payload)],
  );
  setNoStore(res);
  res.status(200).json({ draftId: row.rows[0]!.id, step });
}

export async function uploadExternalWebDraftPhotoHandler(req: Request, res: Response): Promise<void> {
  const person = await resolveCap(req);
  if (!person) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна."));
    return;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!raw.length || raw.length > MAX_DRAFT_PHOTO_BYTES) {
    setNoStore(res);
    res.status(raw.length ? 413 : 400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный файл."));
    return;
  }
  const mime = detectImageMimeFromMagic(raw);
  if (!mime) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Допустимы только изображения."));
    return;
  }
  const fileName = String(req.headers["x-tt-filename"] ?? "photo.jpg").slice(0, 200);
  const pool = getPool()!;
  const draftId = String((req.query.draftId as string) ?? "").trim();
  const draft = await pool.query<{ id: string }>(
    `SELECT id::text FROM tt_external_request_drafts WHERE id = $1::uuid AND person_id = $2::uuid LIMIT 1`,
    [draftId, person.personId],
  );
  if (!draft.rows[0]) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Черновик не найден."));
    return;
  }
  const count = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draftId],
  );
  if ((count.rows[0]?.c ?? 0) >= 5) {
    setNoStore(res);
    res.status(409).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Не более 5 фото."));
    return;
  }
  const key = `external-draft/${draftId}/${randomUUID()}-${fileName}`;
  await withTransaction(async (client) => {
    await writeAttachmentBytes(client, key, raw);
    await client.query(
      `INSERT INTO tt_external_request_draft_files (draft_id, storage_key, file_name, mime_type, byte_size, sort_order)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [draftId, key, fileName, mime, raw.length, count.rows[0]?.c ?? 0],
    );
  });
  setNoStore(res);
  res.status(201).json({ ok: true });
}

export async function confirmExternalWebDraftHandler(req: Request, res: Response): Promise<void> {
  const person = await resolveCap(req);
  if (!person) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна."));
    return;
  }
  const draftId = String((req.body as { draftId?: string })?.draftId ?? "").trim();
  const pool = getPool()!;
  const outcome = await withTransaction(async (client) =>
    confirmExternalRequestDraft(client, {
      personId: person.personId,
      externalPartyId: person.partyId,
      draftId,
      idempotencyKey: `ext-web:${draftId}`,
    }),
  );
  const bootstrap = await buildExternalPersonBootstrapPayload(pool, person);
  setNoStore(res);
  res.status(200).json({ ok: true, publicCode: outcome.publicCode, bootstrap });
}
