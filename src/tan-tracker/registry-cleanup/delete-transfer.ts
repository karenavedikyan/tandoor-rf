import type { PoolClient } from "pg";
import { transferHasConfirmedFirstCustody, loadTransferForCustodyCheck } from "../custody-state";
import { cancelQueuedNotificationsForTransferDelete } from "./cancel-transfer-notifications";
import { clearPersonalFlagsForTransfer } from "./personal-flags";

export async function deleteTransferBeforeFirstCustody(
  client: PoolClient,
  transferId: string,
  actor: { userId: string | null; partyId: string },
  options?: { adminForceDelete?: boolean },
): Promise<{ ok: true; publicCode: string } | { ok: false; reason: string }> {
  const adminForceDelete = options?.adminForceDelete === true;
  const row = await loadTransferForCustodyCheck(client, transferId, true);
  if (!row) return { ok: false, reason: "Передача не найдена." };
  if (!adminForceDelete) {
    if (row.status === "completed") {
      return { ok: false, reason: "Нельзя удалить завершённую передачу." };
    }
    if (await transferHasConfirmedFirstCustody(client, row.id)) {
      return { ok: false, reason: "Получение уже подтверждалось — удаление недоступно." };
    }
  }
  const meta = await client.query<{ public_code: string }>(
    `SELECT public_code FROM tt_transfers WHERE id = $1 FOR UPDATE`,
    [row.id],
  );
  const publicCode = meta.rows[0]?.public_code;
  if (!publicCode) return { ok: false, reason: "Передача не найдена." };

  await client.query(
    `INSERT INTO tt_transfer_delete_audit (transfer_public_code, actor_user_id, actor_party_id)
     VALUES ($1, $2::uuid, $3::uuid)`,
    [publicCode, actor.userId, actor.partyId],
  );
  await cancelQueuedNotificationsForTransferDelete(client, row.id);
  await clearPersonalFlagsForTransfer(client, row.id);
  await client.query(`DELETE FROM tt_transfers WHERE id = $1`, [row.id]);
  return { ok: true, publicCode };
}
