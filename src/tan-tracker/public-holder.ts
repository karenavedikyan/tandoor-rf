import type { Request, Response } from "express";
import { withTransaction } from "../access/db";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { getAppOrigin } from "../config";
import { holderAccessTtlMs, signHolderAccess, verifyHolderAccess } from "./holder-access";
import {
  listRevokedParties,
  listTimelineForTransfer,
  mapTransferToOrderDto,
  partyToContact,
} from "./repository";
import { listAttachmentsForTransfers } from "./attachments";

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
  const partyIds = [row.holder_party_id, row.final_recipient_party_id, row.pending_party_id].filter(Boolean);
  const parties = await pool.query(
    `SELECT p.id, p.kind, p.user_id, p.display_name, p.phone_e164, NULL::text AS linked_employee_id
     FROM tt_parties p WHERE p.id = ANY($1::uuid[])`,
    [partyIds],
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
        `UPDATE tt_transfers SET pending_party_id = $2, status = 'waiting', handoff_version = $3 WHERE id = $1`,
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
