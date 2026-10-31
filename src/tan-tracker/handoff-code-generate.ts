import type { PoolClient } from "pg";
import { generateNumericOtp, hashOtp } from "./phone-verification";
import {
  HANDOFF_CODE_TTL_MS,
  requireHandoffOtpPepper,
} from "./otp-config";
import { transferWriteBlocked, TRANSFER_WRITE_BLOCKED_MESSAGE } from "./transfer-write-guard";

export type HandoffCodeGenerateResult =
  | {
      ok: true;
      code: string;
      expiresAt: number;
      transferId: string;
      publicCode: string;
      itemTitle: string;
      handoffVersion: number;
    }
  | { ok: false; http: number; message: string };

async function loadTransferForCode(client: PoolClient, id: string) {
  const res = await client.query<{
    id: string;
    status: string;
    public_code: string;
    item_title: string;
    pending_party_id: string | null;
    handoff_version: number;
    deleted_at: Date | null;
    general_archived_at: Date | null;
  }>(
    `SELECT id, status, public_code, item_title, pending_party_id, handoff_version,
            deleted_at, general_archived_at
     FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1 FOR UPDATE`,
    [id],
  );
  return res.rows[0];
}

/** Canonical handoff code issuance for pending recipient (LK or bot). */
export async function generateHandoffCodeForPendingParty(
  client: PoolClient,
  input: {
    transferIdOrCode: string;
    pendingPartyId: string;
    auditUserId: string | null;
    auditPartyId: string;
    auditAction?: string;
  },
): Promise<HandoffCodeGenerateResult> {
  let pepper: string;
  try {
    pepper = requireHandoffOtpPepper();
  } catch {
    return { ok: false, http: 503, message: "Сервис кодов временно недоступен." };
  }

  const row = await loadTransferForCode(client, input.transferIdOrCode.slice(0, 64));
  if (!row || transferWriteBlocked(row)) {
    return { ok: false, http: 404, message: transferWriteBlocked(row) ? TRANSFER_WRITE_BLOCKED_MESSAGE : "Передача не найдена." };
  }
  if (!row.pending_party_id) {
    return { ok: false, http: 404, message: "Передача не найдена." };
  }
  if (row.pending_party_id !== input.pendingPartyId) {
    return { ok: false, http: 403, message: "Только ожидающий получатель может выпустить код." };
  }
  if (row.status !== "waiting" && row.status !== "active" && row.status !== "delivered") {
    return { ok: false, http: 409, message: "Передача недоступна для получения кода." };
  }

  const code = generateNumericOtp(6);
  const hash = hashOtp(code, pepper);
  const expiresAt = new Date(Date.now() + HANDOFF_CODE_TTL_MS);
  await client.query(
    `UPDATE tt_handoff_codes SET consumed_at = NOW()
     WHERE transfer_id = $1 AND handoff_version = $2 AND consumed_at IS NULL`,
    [row.id, row.handoff_version],
  );
  await client.query(
    `INSERT INTO tt_handoff_codes (transfer_id, handoff_version, pending_party_id, code_hash, expires_at, verify_attempt_count)
     VALUES ($1,$2,$3,$4,$5,0)`,
    [row.id, row.handoff_version, row.pending_party_id, hash, expiresAt],
  );
  await client.query(
    `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
     VALUES ($1,$2::uuid,$3,$4,'{}'::jsonb)`,
    [row.id, input.auditUserId, input.auditPartyId, input.auditAction ?? "code_generate"],
  );

  const holderParty = (
    await client.query<{ holder_party_id: string }>(`SELECT holder_party_id::text FROM tt_transfers WHERE id = $1`, [
      row.id,
    ])
  ).rows[0]?.holder_party_id;
  if (holderParty) {
    const { notifyCodeGenerated } = await import("./transfer-lk-notify");
    const pendingPartyId = row.pending_party_id;
    if (pendingPartyId) {
      await notifyCodeGenerated(client, {
        transferId: row.id,
        publicCode: row.public_code,
        itemTitle: row.item_title,
        holderPartyId: holderParty,
        pendingPartyId,
        handoffVersion: row.handoff_version,
      });
    }
  }

  return {
    ok: true,
    code,
    expiresAt: expiresAt.getTime(),
    transferId: row.id,
    publicCode: row.public_code,
    itemTitle: row.item_title,
    handoffVersion: row.handoff_version,
  };
}
