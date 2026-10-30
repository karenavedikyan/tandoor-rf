import type { Request, Response } from "express";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { verifyInvitationToken } from "./invitation-token";
import { verifyPhoneSession } from "./phone-session";
import {
  listRevokedParties,
  listTimelineForTransfer,
  mapTransferToOrderDto,
  partyToContact,
} from "./repository";
import { getAppOrigin } from "../config";
import { tanTrackerUserTestBannerForApi } from "../shared/tan-tracker-user-test-env";
import {
  contentDispositionFilename,
  listAttachmentsForTransfers,
  resolveAttachmentContentDisposition,
} from "./attachments";

function maskPhone(phone: string | null): string {
  if (!phone || phone.length < 6) return "—";
  return phone.slice(0, 2) + " *** " + phone.slice(-4);
}

export async function publicRecipientContextHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.query.invitationToken ?? "").trim();
  const invite = verifyInvitationToken(token);
  if (!invite) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Приглашение недоступно или устарело."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const row = (
    await pool.query(
      `SELECT t.id, t.public_code, t.item_title, t.qty_label, t.comment_text, t.status,
              t.creator_party_id, t.holder_party_id, t.pending_party_id, t.final_recipient_party_id,
              t.due_at, t.holder_since, t.handoff_version, t.allow_legacy_complete, t.completed_at, t.row_version
       FROM tt_transfers t
       JOIN tt_transfer_invitations inv
         ON inv.transfer_id = t.id AND inv.handoff_version = t.handoff_version AND inv.superseded_at IS NULL
       WHERE (t.id = $1 OR t.public_code = $1)
         AND t.handoff_version = $2
         AND t.pending_party_id = $3::uuid
       LIMIT 1`,
      [invite.transferId, invite.hv, invite.pendingPartyId],
    )
  ).rows[0];
  if (!row || row.status === "completed") {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Приглашение недоступно."));
    return;
  }

  const timeline = await listTimelineForTransfer(pool, row.id);
  const revoked = await listRevokedParties(pool, row.id);
  const attMap = await listAttachmentsForTransfers(pool, [row.id]);
  const dto = mapTransferToOrderDto(row, timeline, revoked, {
    attachments: attMap.get(row.id) ?? [],
  });
  dto.attachments = (dto.attachments ?? []).map((a) => ({
    ...a,
    url: undefined,
  }));

  const parties = await pool.query(
    `SELECT p.id, p.kind, p.user_id, p.display_name, p.phone_e164, NULL::text AS linked_employee_id
     FROM tt_parties p
     WHERE p.id = ANY($1::uuid[])`,
    [[row.holder_party_id, row.pending_party_id, row.final_recipient_party_id].filter(Boolean)],
  );
  const contacts = parties.rows.map(partyToContact).map((c) => ({
    ...c,
    phone: c.id === row.pending_party_id ? maskPhone(c.phone) : c.phone,
  }));

  const appOrigin = getAppOrigin() ?? null;

  setNoStore(res);
  res.status(200).json({
    lkMode: true,
    publicRecipient: true,
    appOrigin,
    actorPartyId: row.pending_party_id,
    actorContact: {
      id: row.pending_party_id,
      kind: "external" as const,
      employeeId: null,
    },
    linkedEmployeeId: null,
    prototypeRole: "manager",
    navAllowed: false,
    previewReadOnly: true,
    contacts,
    orders: [dto],
    capabilities: { canWrite: false },
    ...tanTrackerUserTestBannerForApi(),
  });
}

/** Read-only receipt after successful public QR handoff (no corporate session). */
export async function publicRecipientReceiptHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.query.invitationToken ?? "").trim();
  const invite = verifyInvitationToken(token);
  if (!invite) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Приглашение недоступно или устарело."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const refresh = String(req.query.refresh ?? "") === "1";
  const { loadBoundedPublicRecipientOrder, recipientMayRefreshAfterReceipt } = await import("./public-recipient-bounded");
  const bounded = await loadBoundedPublicRecipientOrder(pool, {
    transferId: invite.transferId,
    recipientPartyId: invite.pendingPartyId,
  });
  if (!bounded) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Результат получения недоступен."));
    return;
  }
  const { row, dto, contacts } = bounded;
  if (!recipientMayRefreshAfterReceipt(invite, row.holder_party_id) && row.status !== "completed") {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Результат получения недоступен."));
    return;
  }
  const routeComplete =
    row.status === "completed" ||
    row.status === "delivered" ||
    (row.final_recipient_party_id != null && row.holder_party_id === row.final_recipient_party_id);
  const appOrigin = getAppOrigin() ?? null;
  setNoStore(res);
  res.status(200).json({
    publicRecipient: true,
    publicReceipt: true,
    appOrigin,
    ...tanTrackerUserTestBannerForApi(),
    receipt: {
      publicCode: row.public_code,
      item: row.item_title,
      status: row.status,
      routeComplete,
      transferStatus: row.status,
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at).getTime() : null,
      recipientPartyId: invite.pendingPartyId,
    },
    ...(refresh
      ? {
          boundedRefresh: true,
          lkMode: true,
          actorPartyId: invite.pendingPartyId,
          actorContact: { id: invite.pendingPartyId, kind: "external" as const, employeeId: null },
          contacts,
          orders: [dto],
          capabilities: { canWrite: false },
        }
      : {}),
  });
}

export async function publicRecipientAttachmentHandler(req: Request, res: Response): Promise<void> {
  const attId = String(req.params.attId ?? "").trim();
  const token = String(req.query.invitationToken ?? "").trim();
  const phoneSessionToken = String(req.query.phoneSessionToken ?? "").trim();
  const invite = verifyInvitationToken(token);
  const phoneSession = phoneSessionToken ? verifyPhoneSession(phoneSessionToken) : null;
  if (!invite || !attId || !phoneSession) {
    setNoStore(res);
    res
      .status(403)
      .json(apiError(ERROR_CODES.FORBIDDEN, "Подтвердите номер телефона, чтобы открыть файлы."));
    return;
  }
  if (
    phoneSession.partyId !== invite.pendingPartyId ||
    phoneSession.hv !== invite.hv
  ) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия подтверждения недействительна."));
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
      `SELECT t.id FROM tt_transfers t
       JOIN tt_transfer_invitations inv
         ON inv.transfer_id = t.id AND inv.handoff_version = t.handoff_version AND inv.superseded_at IS NULL
       WHERE (t.id = $1 OR t.public_code = $1)
         AND t.handoff_version = $2
         AND t.pending_party_id = $3::uuid
         AND inv.pending_party_id = $3::uuid
         AND t.status <> 'completed'`,
      [invite.transferId, invite.hv, invite.pendingPartyId],
    )
  ).rows[0];
  if (!transfer || transfer.id !== phoneSession.transferId) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Приглашение недоступно."));
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
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Вложение не найдено."));
    return;
  }
  const query = req.query as Record<string, unknown>;
  try {
    const { loadAttachmentServePayload } = await import("./attachment-preview");
    const { buffer, contentType } = await loadAttachmentServePayload(
      fileRow.storage_key,
      fileRow.mime_type,
      query,
      pool,
    );
    const disposition = resolveAttachmentContentDisposition(fileRow.mime_type, query);
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
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Файл не найден."));
  }
}
