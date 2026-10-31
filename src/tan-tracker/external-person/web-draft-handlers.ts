import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { withTransaction } from "../../access/db";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { resolveExternalPersonAuth } from "./resolve-auth";
import { requirePersonMessengerProvenance } from "./messenger-provenance";
import { confirmExternalRequestDraft } from "../external-request/confirm";
import {
  discardActiveUnconfirmedDraftForWebFreshStart,
  ensureActiveExternalRequestDraft,
  insertExternalRequestDraft,
  loadActiveExternalRequestDraft,
} from "../external-request/draft-store";
import { lockExternalWebDraftForMutation } from "./web-draft-active";
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
       AND confirmed_transfer_id IS NULL
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
  const body = req.body as {
    step?: string;
    payload?: Record<string, unknown>;
    startFresh?: boolean;
    draftId?: string;
  };
  const step = String(body?.step ?? "item").slice(0, 32);
  const payload = body?.payload ?? {};
  const startFresh = body?.startFresh === true;
  const targetDraftId = String(body?.draftId ?? "").trim();
  const pool = getPool()!;
  const provenance = await requirePersonMessengerProvenance(pool, person.personId);
  try {
    const row = await withTransaction(async (client) => {
      if (startFresh) {
        await discardActiveUnconfirmedDraftForWebFreshStart(client, {
          channel: provenance.channel,
          messengerChatId: provenance.messengerChatId,
          personId: person.personId,
        });
        const created = await insertExternalRequestDraft(client, {
          channel: provenance.channel,
          messengerChatId: provenance.messengerChatId,
          personId: person.personId,
          step,
          payload: payload as Record<string, unknown>,
        });
        return { id: created.id };
      }
      if (targetDraftId) {
        await lockExternalWebDraftForMutation(client, {
          draftId: targetDraftId,
          personId: person.personId,
          channel: provenance.channel,
          messengerChatId: provenance.messengerChatId,
        });
        await client.query(
          `UPDATE tt_external_request_drafts
           SET person_id = $2::uuid, step = $3, payload = $4::jsonb, updated_at = NOW()
           WHERE id = $1::uuid`,
          [targetDraftId, person.personId, step, JSON.stringify(payload)],
        );
        return { id: targetDraftId };
      }
      const active = await loadActiveExternalRequestDraft(client, provenance.channel, provenance.messengerChatId);
      if (active) {
        if (active.person_id && active.person_id !== person.personId) {
          const err = new Error("Черновик недоступен.") as Error & { http?: number };
          err.http = 403;
          throw err;
        }
        await client.query(
          `UPDATE tt_external_request_drafts
           SET person_id = $2::uuid, step = $3, payload = $4::jsonb, updated_at = NOW()
           WHERE id = $1::uuid`,
          [active.id, person.personId, step, JSON.stringify(payload)],
        );
        return { id: active.id };
      }
      const created = await ensureActiveExternalRequestDraft(client, {
        channel: provenance.channel,
        messengerChatId: provenance.messengerChatId,
        personId: person.personId,
        step,
        payload: payload as Record<string, unknown>,
      });
      return { id: created.id };
    });
    setNoStore(res);
    res.status(200).json({ draftId: row.id, step });
  } catch (err) {
    const http = (err as Error & { http?: number }).http;
    const message = err instanceof Error ? err.message : "Черновик недоступен.";
    setNoStore(res);
    if (http === 403) {
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, message));
      return;
    }
    if (http === 404) {
      res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, message));
      return;
    }
    if (http === 409) {
      res.status(409).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
      return;
    }
    throw err;
  }
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
  const provenance = await requirePersonMessengerProvenance(pool, person.personId);
  const draftId = String((req.query.draftId as string) ?? "").trim();
  if (!draftId) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Черновик не указан."));
    return;
  }
  const key = `external-draft/${draftId}/${randomUUID()}-${fileName}`;
  try {
    await withTransaction(async (client) => {
      await lockExternalWebDraftForMutation(client, {
        draftId,
        personId: person.personId,
        channel: provenance.channel,
        messengerChatId: provenance.messengerChatId,
      });
      const count = await client.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
        [draftId],
      );
      if ((count.rows[0]?.c ?? 0) >= 5) {
        const err = new Error("Не более 5 фото.") as Error & { http?: number };
        err.http = 409;
        throw err;
      }
      await writeAttachmentBytes(client, key, raw);
      await client.query(
        `INSERT INTO tt_external_request_draft_files (draft_id, storage_key, file_name, mime_type, byte_size, sort_order)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
        [draftId, key, fileName, mime, raw.length, count.rows[0]?.c ?? 0],
      );
    });
  } catch (err) {
    const http = (err as Error & { http?: number }).http;
    const message = err instanceof Error ? err.message : "Не удалось загрузить фото.";
    setNoStore(res);
    if (http === 404) {
      res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, message));
      return;
    }
    if (http === 403) {
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, message));
      return;
    }
    if (http === 409) {
      res.status(409).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
      return;
    }
    throw err;
  }
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
