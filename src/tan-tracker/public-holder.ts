import type { Request, Response } from "express";
import { withTransaction } from "../access/db";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { getAppOrigin } from "../config";
import { tanTrackerUserTestBannerForApi } from "../shared/tan-tracker-user-test-env";
import { holderAccessTtlMs, signHolderAccess, verifyHolderAccess } from "./holder-access";
import { applyPendingReceiptHandoff } from "./handoff-complete";
import { requireHandoffOtpPepper } from "./otp-config";
import { HANDOFF_CODE_MAX_VERIFY_ATTEMPTS } from "./otp-config";
import { hashOtp } from "./phone-verification";
import {
  contentDispositionFilename,
  resolveAttachmentContentDisposition,
  decodeUploadFilename,
  deleteAttachmentBytes,
  linkStagedAttachmentsToTransfer,
  listAttachmentsForTransfers,
  stageAttachmentBuffer,
} from "./attachments";
import {
  listRevokedParties,
  listTimelineForTransfer,
  mapTransferToOrderDto,
  partyToContact,
} from "./repository";
import {
  loadPublicHolderCreatorUserId,
  resolvePublicHolderPendingPartyId,
} from "./public-holder-eligibility";

async function loadHolderTransfer(
  client: { query: Function },
  transferId: string,
  partyId: string,
  hv: number,
) {
  return (
    await client.query(
      `SELECT id, public_code, item_title, qty_label, comment_text, status,
              creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
              due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version
       FROM tt_transfers
       WHERE id = $1 AND holder_party_id = $2::uuid AND handoff_version = $3 AND status <> 'completed'
       LIMIT 1 FOR UPDATE`,
      [transferId, partyId, hv],
    )
  ).rows[0] as
    | {
        id: string;
        public_code: string;
        item_title: string;
        status: string;
        holder_party_id: string;
        pending_party_id: string | null;
        final_recipient_party_id: string | null;
        handoff_version: number;
        due_at: Date | null;
      }
    | undefined;
}

async function buildPublicHolderJson(pool: NonNullable<ReturnType<typeof getPool>>, transferId: string) {
  const row = (
    await pool.query(
      `SELECT id, public_code, item_title, qty_label, comment_text, status,
              creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
              due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version
       FROM tt_transfers WHERE id = $1 LIMIT 1`,
      [transferId],
    )
  ).rows[0];
  if (!row) return null;
  const timeline = await listTimelineForTransfer(pool, row.id);
  const revoked = await listRevokedParties(pool, row.id);
  const attMap = await listAttachmentsForTransfers(pool, [row.id]);
  const dto = mapTransferToOrderDto(row, timeline, revoked, {
    attachments: attMap.get(row.id) ?? [],
  });
  dto.attachments = (dto.attachments ?? []).map((a) => ({ ...a, url: undefined }));
  const partyIdSet = new Set<string>(
    [
      row.creator_party_id,
      row.holder_party_id,
      row.final_recipient_party_id,
      row.pending_party_id,
      ...timeline.map((t) => t.from_party_id),
      ...timeline.map((t) => t.to_party_id),
    ].filter(Boolean) as string[],
  );
  const parties = await pool.query(
    `SELECT p.id, p.kind, p.user_id, p.display_name, p.phone_e164,
            uoel.employee_id::text AS linked_employee_id
     FROM tt_parties p
     LEFT JOIN user_onec_employee_links uoel ON uoel.user_id = p.user_id AND uoel.revoked_at IS NULL
     WHERE p.id = ANY($1::uuid[])`,
    [[...partyIdSet]],
  );
  const contacts = parties.rows.map(partyToContact);
  const holderToken = signHolderAccess({
    transferId: row.id,
    partyId: row.holder_party_id,
    hv: row.handoff_version,
    exp: Date.now() + holderAccessTtlMs(),
  });
  return {
    lkMode: true,
    publicHolder: true,
    appOrigin: getAppOrigin() ?? null,
    actorPartyId: row.holder_party_id,
    actorContact: { id: row.holder_party_id, kind: "external" as const, employeeId: null },
    linkedEmployeeId: null,
    prototypeRole: "manager",
    navAllowed: false,
    previewReadOnly: false,
    contacts,
    orders: [dto],
    capabilities: {
      canWrite: false,
      canSendToFinal: !row.pending_party_id && !!row.final_recipient_party_id,
    },
    holderAccessToken: holderToken,
    ...tanTrackerUserTestBannerForApi(),
  };
}

export async function publicHolderContextHandler(req: Request, res: Response): Promise<void> {
  const holderAccessToken = String(req.query.holderAccessToken ?? "").trim();
  const access = holderAccessToken ? verifyHolderAccess(holderAccessToken) : null;
  if (!access) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступ недоступен или устарел."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const row = (
    await pool.query(`SELECT id FROM tt_transfers WHERE id = $1 AND holder_party_id = $2::uuid AND handoff_version = $3`, [
      access.transferId,
      access.partyId,
      access.hv,
    ])
  ).rows[0];
  if (!row) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Передача недоступна."));
    return;
  }
  const payload = await buildPublicHolderJson(pool, access.transferId);
  if (!payload) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Передача не найдена."));
    return;
  }
  setNoStore(res);
  res.status(200).json(payload);
}

export async function publicHolderSendToFinalHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { holderAccessToken?: string };
  const access = body.holderAccessToken ? verifyHolderAccess(body.holderAccessToken) : null;
  if (!access) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступ недоступен или устарел."));
    return;
  }
  let transferId = "";
  try {
    transferId = await withTransaction(async (client) => {
      const row = await loadHolderTransfer(client, access.transferId, access.partyId, access.hv);
      if (!row) {
        throw Object.assign(new Error("Передача недоступна."), { http: 404 });
      }
      if (!row.final_recipient_party_id) {
        throw Object.assign(new Error("Конечный получатель не задан."), { http: 409 });
      }
      if (row.pending_party_id) {
        throw Object.assign(new Error("Ожидание уже назначено."), { http: 409 });
      }
      const nextVer = row.handoff_version + 1;
      await client.query(
        `UPDATE tt_transfers SET pending_party_id = $2, status = 'waiting', handoff_version = $3,
                row_version = row_version + 1 WHERE id = $1`,
        [row.id, row.final_recipient_party_id, nextVer],
      );
      await client.query(
        `UPDATE tt_transfer_invitations SET superseded_at = NOW() WHERE transfer_id = $1 AND superseded_at IS NULL`,
        [row.id],
      );
      await client.query(
        `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
         VALUES ($1,$2,$3,$4,$5)`,
        [row.id, nextVer, row.holder_party_id, row.final_recipient_party_id, row.item_title],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
         VALUES ($1,$2,$3,$4,NULL)`,
        [row.id, row.holder_party_id, row.final_recipient_party_id, "Назначен конечный получатель"],
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,NULL,$2::uuid,'holder_send_to_final','{}'::jsonb)`,
        [row.id, row.holder_party_id],
      );
      return row.id as string;
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 503;
    const message = err instanceof Error ? err.message : "Не удалось назначить получателя.";
    setNoStore(res);
    res
      .status(http)
      .json(
        apiError(
          http === 403 ? ERROR_CODES.FORBIDDEN : http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR,
          message,
        ),
      );
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const payload = await buildPublicHolderJson(pool, transferId);
  setNoStore(res);
  res.status(200).json(payload ?? { ok: true });
}

export async function publicHolderVerifyCodeHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { holderAccessToken?: string; code?: string };
  const access = body.holderAccessToken ? verifyHolderAccess(body.holderAccessToken) : null;
  const rawCode = String(body.code ?? "").replace(/\D/g, "");
  if (!access || rawCode.length !== 6) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные данные."));
    return;
  }
  let pepper: string;
  try {
    pepper = requireHandoffOtpPepper();
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис кодов временно недоступен."));
    return;
  }
  type VerifyResult = { ok: true } | { ok: false; http: number; message: string };
  let result: VerifyResult;
  try {
    result = await withTransaction(async (client) => {
      const row = await loadHolderTransfer(client, access.transferId, access.partyId, access.hv);
      if (!row || !row.pending_party_id) {
        return { ok: false, http: 404, message: "Передача недоступна." };
      }
      const codeRes = await client.query<{
        id: string;
        code_hash: string;
        expires_at: Date;
        verify_attempt_count: number;
      }>(
        `SELECT id, code_hash, expires_at, verify_attempt_count FROM tt_handoff_codes
         WHERE transfer_id = $1 AND handoff_version = $2 AND pending_party_id = $3 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [row.id, row.handoff_version, row.pending_party_id],
      );
      const codeRow = codeRes.rows[0];
      if (!codeRow) {
        return { ok: false, http: 409, message: "Код не выпущен или истёк." };
      }
      if (codeRow.expires_at.getTime() <= Date.now()) {
        await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
        return { ok: false, http: 409, message: "Срок кода истёк." };
      }
      if (codeRow.verify_attempt_count >= HANDOFF_CODE_MAX_VERIFY_ATTEMPTS) {
        await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
        return { ok: false, http: 409, message: "Превышено число попыток." };
      }
      const hash = hashOtp(rawCode, pepper);
      if (hash !== codeRow.code_hash) {
        const attempts = codeRow.verify_attempt_count + 1;
        await client.query(`UPDATE tt_handoff_codes SET verify_attempt_count = $2 WHERE id = $1`, [
          codeRow.id,
          attempts,
        ]);
        return { ok: false, http: 400, message: "Неверный код." };
      }
      await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
      const fullRow = (
        await client.query(
          `SELECT id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version
           FROM tt_transfers WHERE id = $1 FOR UPDATE`,
          [row.id],
        )
      ).rows[0];
      await applyPendingReceiptHandoff(
        client,
        fullRow,
        null,
        access.partyId,
        "Подтверждено одноразовым кодом",
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,NULL,$2::uuid,'holder_code_verify_ok','{}'::jsonb)`,
        [row.id, access.partyId],
      );
      return { ok: true };
    });
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось подтвердить код."));
    return;
  }
  if (!result.ok) {
    setNoStore(res);
    res
      .status(result.http)
      .json(
        apiError(
          result.http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR,
          result.message,
        ),
      );
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const payload = await buildPublicHolderJson(pool, access.transferId);
  setNoStore(res);
  res.status(200).json(payload ?? { ok: true });
}

export async function publicHolderAttachmentHandler(req: Request, res: Response): Promise<void> {
  const attId = String(req.params.attId ?? "").trim();
  const holderAccessToken = String(req.query.holderAccessToken ?? "").trim();
  const access = holderAccessToken ? verifyHolderAccess(holderAccessToken) : null;
  if (!access || !attId) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступ недоступен."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const transfer = (
    await pool.query<{ id: string }>(
      `SELECT id FROM tt_transfers WHERE id = $1 AND holder_party_id = $2::uuid AND handoff_version = $3`,
      [access.transferId, access.partyId, access.hv],
    )
  ).rows[0];
  if (!transfer) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Передача недоступна."));
    return;
  }
  const fileRow = (
    await pool.query<{ storage_key: string; original_name: string; mime_type: string }>(
      `SELECT storage_key, original_name, mime_type FROM tt_transfer_attachments
       WHERE id = $1::uuid AND transfer_id = $2 LIMIT 1`,
      [attId, transfer.id],
    )
  ).rows[0];
  if (!fileRow) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Файл не найден."));
    return;
  }
  const mime = fileRow.mime_type || "application/octet-stream";
  const query = req.query as Record<string, unknown>;
  try {
    const { loadAttachmentServePayload } = await import("./attachment-preview");
    const { buffer, contentType } = await loadAttachmentServePayload(
      fileRow.storage_key,
      mime,
      query,
      pool,
    );
    const disposition = resolveAttachmentContentDisposition(mime, query);
    setNoStore(res);
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", contentDispositionFilename(fileRow.original_name, disposition));
    res.status(200).send(buffer);
  } catch (err: unknown) {
    const http = (err as { http?: number }).http;
    setNoStore(res);
    if (http === 400 || http === 422) {
      res
        .status(http)
        .json(
          apiError(
            ERROR_CODES.VALIDATION_ERROR,
            err instanceof Error ? err.message : "Предпросмотр недоступен.",
          ),
        );
      return;
    }
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Файл недоступен."));
  }
}

export async function publicHolderChangePendingHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    holderAccessToken?: string;
    pendingPartyId?: string;
    external?: { name?: string; phone?: string };
  };
  const access = body.holderAccessToken ? verifyHolderAccess(body.holderAccessToken) : null;
  if (!access) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступ недоступен или устарел."));
    return;
  }
  let transferId = "";
  try {
    transferId = await withTransaction(async (client) => {
      const row = await loadHolderTransfer(client, access.transferId, access.partyId, access.hv);
      if (!row) {
        throw Object.assign(new Error("Передача недоступна."), { http: 404 });
      }
      if (row.pending_party_id) {
        throw Object.assign(new Error("Ожидание уже назначено."), { http: 409 });
      }
      const externalInput =
        body.external && (body.external.name || body.external.phone)
          ? { name: body.external.name ?? "", phone: body.external.phone ?? "" }
          : undefined;
      const pendingPartyId = await resolvePublicHolderPendingPartyId(
        client,
        row.id,
        access.partyId,
        body.pendingPartyId,
        externalInput,
      );
      const nextVer = row.handoff_version + 1;
      await client.query(
        `UPDATE tt_transfers SET pending_party_id = $2, status = 'waiting', handoff_version = $3,
                row_version = row_version + 1 WHERE id = $1`,
        [row.id, pendingPartyId, nextVer],
      );
      await client.query(
        `UPDATE tt_transfer_invitations SET superseded_at = NOW() WHERE transfer_id = $1 AND superseded_at IS NULL`,
        [row.id],
      );
      await client.query(
        `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
         VALUES ($1,$2,$3,$4,$5)`,
        [row.id, nextVer, row.holder_party_id, pendingPartyId, row.item_title],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
         VALUES ($1,$2,$3,$4,NULL)`,
        [row.id, row.holder_party_id, pendingPartyId, "Назначен следующий получатель"],
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,NULL,$2::uuid,'holder_pending_change','{}'::jsonb)`,
        [row.id, access.partyId],
      );
      return row.id as string;
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 503;
    const message = err instanceof Error ? err.message : "Не удалось назначить получателя.";
    setNoStore(res);
    res
      .status(http)
      .json(
        apiError(
          http === 403 ? ERROR_CODES.FORBIDDEN : http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR,
          message,
        ),
      );
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const payload = await buildPublicHolderJson(pool, transferId);
  setNoStore(res);
  res.status(200).json(payload);
}

export async function publicHolderStageAttachmentHandler(req: Request, res: Response): Promise<void> {
  const holderAccessToken = String(req.query.holderAccessToken ?? "").trim();
  const access = holderAccessToken ? verifyHolderAccess(holderAccessToken) : null;
  if (!access) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступ недоступен или устарел."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const creatorUserId = await loadPublicHolderCreatorUserId(pool, access.transferId);
  if (!creatorUserId) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось загрузить файл."));
    return;
  }
  const filename = decodeUploadFilename(String(req.headers["x-tt-filename"] ?? "file"));
  const mime = String(req.headers["x-tt-mime-type"] ?? "application/octet-stream").toLowerCase();
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  try {
    const staged = await stageAttachmentBuffer(creatorUserId, filename, mime, buf);
    setNoStore(res);
    res.status(201).json(staged);
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 400;
    setNoStore(res);
    res
      .status(http)
      .json(apiError(ERROR_CODES.VALIDATION_ERROR, err instanceof Error ? err.message : "Не удалось загрузить файл."));
  }
}

export async function publicHolderAddAttachmentsHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { holderAccessToken?: string; stagingAttachmentIds?: string[] };
  const access = body.holderAccessToken ? verifyHolderAccess(body.holderAccessToken) : null;
  if (!access) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступ недоступен или устарел."));
    return;
  }
  const stagingIds = Array.isArray(body.stagingAttachmentIds)
    ? body.stagingAttachmentIds.map(String).filter(Boolean)
    : [];
  if (!stagingIds.length || stagingIds.length > 10) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите файлы для прикрепления."));
    return;
  }
  let transferId = "";
  try {
    transferId = await withTransaction(async (client) => {
      const row = await loadHolderTransfer(client, access.transferId, access.partyId, access.hv);
      if (!row) {
        throw Object.assign(new Error("Передача недоступна."), { http: 404 });
      }
      const creatorUserId = await loadPublicHolderCreatorUserId(client, row.id);
      if (!creatorUserId) {
        throw Object.assign(new Error("Не удалось прикрепить файлы."), { http: 503 });
      }
      await linkStagedAttachmentsToTransfer(client, creatorUserId, row.id, stagingIds);
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,NULL,$2::uuid,'holder_attach_add', $3::jsonb)`,
        [row.id, access.partyId, JSON.stringify({ count: stagingIds.length })],
      );
      return row.id as string;
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 503;
    const message = err instanceof Error ? err.message : "Не удалось прикрепить файлы.";
    setNoStore(res);
    res
      .status(http)
      .json(
        apiError(
          http === 403 ? ERROR_CODES.FORBIDDEN : http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR,
          message,
        ),
      );
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const payload = await buildPublicHolderJson(pool, transferId);
  setNoStore(res);
  res.status(200).json(payload);
}

export async function publicHolderDeleteAttachmentHandler(req: Request, res: Response): Promise<void> {
  const attId = String(req.params.attId ?? "").trim();
  const holderAccessToken = String(req.query.holderAccessToken ?? "").trim();
  const access = holderAccessToken ? verifyHolderAccess(holderAccessToken) : null;
  if (!access || !attId) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступ недоступен."));
    return;
  }
  let transferId = "";
  try {
    transferId = await withTransaction(async (client) => {
      const row = await loadHolderTransfer(client, access.transferId, access.partyId, access.hv);
      if (!row) {
        throw Object.assign(new Error("Передача недоступна."), { http: 404 });
      }
      const deleted = (
        await client.query<{ storage_key: string }>(
          `DELETE FROM tt_transfer_attachments
           WHERE id = $1::uuid AND transfer_id = $2
           RETURNING storage_key`,
          [attId, row.id],
        )
      ).rows[0];
      if (!deleted) {
        throw Object.assign(new Error("Вложение не найдено."), { http: 404 });
      }
      const { deleteAttachmentPreviewDerivatives } = await import("./attachment-preview");
      await deleteAttachmentPreviewDerivatives(deleted.storage_key, client);
      await deleteAttachmentBytes(deleted.storage_key, client);
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,NULL,$2::uuid,'holder_attach_delete', $3::jsonb)`,
        [row.id, access.partyId, JSON.stringify({ attachmentId: attId })],
      );
      return row.id as string;
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 503;
    const message = err instanceof Error ? err.message : "Не удалось удалить вложение.";
    setNoStore(res);
    res
      .status(http)
      .json(
        apiError(
          http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.FORBIDDEN,
          message,
        ),
      );
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const payload = await buildPublicHolderJson(pool, transferId);
  setNoStore(res);
  res.status(200).json(payload);
}
