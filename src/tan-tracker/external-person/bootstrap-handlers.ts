import type { Request, Response } from "express";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { signExternalPersonCapability } from "./session-token";
import { resolveExternalPersonAuth } from "./resolve-auth";
import { mapTransferToOrderDto, listTimelineForTransfer, listRevokedParties } from "../repository";
import { listAttachmentsForTransfers } from "../attachments";

async function loadPersonOrders(pool: NonNullable<ReturnType<typeof getPool>>, partyId: string) {
  const rows = await pool.query(
    `SELECT t.* FROM tt_transfers t
     WHERE t.creator_party_id = $1::uuid OR t.holder_party_id = $1::uuid OR t.pending_party_id = $1::uuid
        OR t.final_recipient_party_id = $1::uuid
        OR EXISTS (SELECT 1 FROM tt_transfer_timeline tl WHERE tl.transfer_id = t.id AND (tl.from_party_id = $1::uuid OR tl.to_party_id = $1::uuid))
     ORDER BY t.updated_at DESC
     LIMIT 200`,
    [partyId],
  );
  const orders = [];
  for (const row of rows.rows) {
    const timeline = await listTimelineForTransfer(pool, row.id);
    const revoked = await listRevokedParties(pool, row.id);
    const attMap = await listAttachmentsForTransfers(pool, [row.id]);
    orders.push(mapTransferToOrderDto(row, timeline, revoked, { attachments: attMap.get(row.id) ?? [] }));
  }
  return orders;
}

export async function externalPersonBootstrapHandler(req: Request, res: Response): Promise<void> {
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const resolved = await resolveExternalPersonAuth(pool, {
    est: String(req.query.est ?? ""),
    cap: String(req.query.cap ?? ""),
  });
  if (!resolved) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна или истекла."));
    return;
  }
  const orders = await loadPersonOrders(pool, resolved.partyId);
  const capability = signExternalPersonCapability(resolved.personId, 24 * 60 * 60 * 1000, resolved.accessEpoch);
  setNoStore(res);
  res.status(200).json({
    externalPerson: true,
    personId: resolved.personId,
    displayName: resolved.displayName,
    phone: resolved.phone,
    capability,
    orders,
    navAllowed: false,
    previewReadOnly: false,
  });
}
