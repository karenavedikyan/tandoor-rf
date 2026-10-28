import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { withTransaction } from "../access/db";
import { resolveTanTrackerAuditUserId, resolveTanTrackerEffectiveUser } from "./effective-user";
import {
  ensurePartyForUserOnWrite,
  mapTransferToOrderDto,
  nextPublicTransferCode,
} from "./repository";
import { buildTanTrackerBootstrap } from "./service";

type CreateBody = {
  item?: string;
  qty?: string;
  comment?: string;
  dueAt?: string | null;
  finalRecipientPartyId?: string;
  relayPartyId?: string | null;
};

export async function createTransferHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!req.authUser || !req.accessContext) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }
  if (req.accessContext.preview?.readOnly) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Изменения запрещены в режиме просмотра."));
    return;
  }
  const user = resolveTanTrackerEffectiveUser(req.authUser, req.accessContext);
  if (user.role === "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Администратор не участвует в передачах."));
    return;
  }
  const body = req.body as CreateBody;
  const item = String(body.item ?? "").trim();
  const finalId = String(body.finalRecipientPartyId ?? "").trim();
  const relayId = body.relayPartyId ? String(body.relayPartyId).trim() : null;
  if (!item) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите, что передаёте."));
    return;
  }
  if (!finalId) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Выберите конечного получателя."));
    return;
  }
  const pendingId = relayId || finalId;
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser, req.accessContext);

  let created: string;
  try {
    created = await withTransaction(async (client) => {
    const holderParty = await ensurePartyForUserOnWrite(
      client,
      user.id,
      user.fullName,
      user.phone,
    );
    if (finalId === holderParty.id || pendingId === holderParty.id) {
      throw Object.assign(new Error("Нельзя назначить себя получателем."), { status: 400 });
    }
    const publicCode = await nextPublicTransferCode(client);
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;
    await client.query(
      `INSERT INTO tt_transfers (
        id, public_code, item_title, qty_label, comment_text, status,
        creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
        due_at, handoff_version
      ) VALUES ($1,$1,$2,$3,$4,'waiting',$5,$5,$6,$7,$8,1)`,
      [
        publicCode,
        item,
        body.qty?.trim() || null,
        body.comment?.trim() || null,
        holderParty.id,
        pendingId,
        finalId,
        dueAt,
      ],
    );
    const note = relayId
      ? "Создана передача · сначала промежуточному звену"
      : "Создана передача · конечному получателю";
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5::uuid)`,
      [publicCode, holderParty.id, pendingId, note, auditUserId],
    );
    await client.query(
      `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
       VALUES ($1,1,$2,$3,$4)`,
      [publicCode, holderParty.id, pendingId, item],
    );
    await client.query(
      `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
       VALUES ($1,$2::uuid,$3,'create',$4::jsonb)`,
      [publicCode, auditUserId, holderParty.id, JSON.stringify({ item, finalId, pendingId })],
    );
    return publicCode;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось создать передачу.";
    if (message.includes("Нельзя назначить")) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
      return;
    }
    throw err;
  }

  const bootstrap = await buildTanTrackerBootstrap(req.authUser, req.accessContext);
  setNoStore(res);
  res.status(201).json({
    publicCode: created,
    bootstrap,
  });
}
