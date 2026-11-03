import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  automaticReceiptTargets,
  type ReceiptChannel,
} from "./automatic-receipt-target";
import {
  encryptAutomaticReceiptCode,
  decryptAutomaticReceiptCode,
} from "./automatic-receipt-crypto";
import { generateHandoffCodeForPendingParty } from "./handoff-code-generate";
import { hashOtp } from "./phone-verification";
import {
  HANDOFF_CODE_TTL_MS,
  HANDOFF_CODE_MAX_VERIFY_ATTEMPTS,
  requireHandoffOtpPepper,
} from "./otp-config";
import {
  formatTransferContextHeader,
  buildNotificationRouteSnapshot,
} from "./staff-notification-route";
import {
  lockTanbotTelegramMessenger,
  lockTanbotMaxMessenger,
} from "../tanbot/link-advisory-locks";

type Job = {
  id: string;
  transfer_id: string;
  handoff_version: number;
  pending_party_id: string;
  channel: ReceiptChannel;
  messenger_user_id: string;
  messenger_chat_id: string;
  phone_snapshot: string | null;
  status: string;
  generation: number;
  encrypted_code: string | null;
  code_hash: string | null;
  code_expires_at: Date | null;
  header_sent_at: Date | null;
  created_at: Date;
  next_attempt_at: Date;
  attempt_count: number;
};
type Transfer = {
  id: string;
  public_code: string;
  item_title: string;
  holder_party_id: string;
  pending_party_id: string | null;
  handoff_version: number;
  status: string;
  deleted_at: Date | null;
  general_archived_at: Date | null;
};
export type AutomaticReceiptTransport = (input: {
  channel: ReceiptChannel;
  userId: string;
  chatId: string;
  text: string;
  callback?: string;
}) => Promise<
  | { ok: true }
  | { ok: false; code: string; retryable?: boolean; retryAfterSeconds?: number }
>;
export const automaticReceiptCallback = (id: string) => `ac:${id}`;
export const isAutomaticReceiptCallback = (s: string) =>
  /^ac:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const automaticReceiptSenderGuidance = (code: string, existingTrack = false) =>
  `${existingTrack ? `Для трека ${code} назначен следующий получатель.` : `Передача создана: ${code}.`}\n\nКод будет отправлен получателю в подключённый бот. Пересылать приглашение не нужно.\nПопросите получателя назвать код при получении предмета, затем нажмите «Ввести код».\nОтветственность перейдёт только после проверки кода.\nЕсли сообщение не пришло, нажмите «Запросить код повторно».`;

async function queueAutomaticReceiptRenewal(client: PoolClient, id: string): Promise<void> {
  await client.query(
    `UPDATE tt_automatic_receipt_codes SET generation=generation+1,status='pending',
    encrypted_code=NULL,code_hash=NULL,code_expires_at=NULL,header_sent_at=NULL,sent_at=NULL,
    attempt_count=0,next_attempt_at=NOW(),last_error_code=NULL WHERE id=$1::uuid`, [id],
  );
}

/** A holder requests delivery, never acts as the recipient and never receives the code. */
export async function requestAutomaticReceiptCodeByHolder(
  client: PoolClient,
  input: { transferId: string; holderPartyId: string; handoffVersion: number; channel: ReceiptChannel },
): Promise<"queued" | "manual" | "unavailable" | "cooldown"> {
  const t = (await client.query<Transfer>(
    "SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [input.transferId],
  )).rows[0];
  if (!t || t.holder_party_id !== input.holderPartyId || t.handoff_version !== input.handoffVersion ||
      !t.pending_party_id || t.pending_party_id === t.holder_party_id || t.deleted_at ||
      t.general_archived_at || !["waiting", "active"].includes(t.status)) return "unavailable";
  if (!await enqueueAutomaticReceiptCode(client, t.id, input.channel)) return "manual";
  const j = (await client.query<Job>(
    "SELECT * FROM tt_automatic_receipt_codes WHERE transfer_id=$1 AND handoff_version=$2 FOR UPDATE",
    [t.id, t.handoff_version],
  )).rows[0];
  // Never silently retarget an existing job after a messenger rebind.
  if (!j || !open(t, j) || !await targetStillMatches(client, j)) return "manual";
  if (j.code_expires_at && Date.now() - (j.code_expires_at.getTime() - HANDOFF_CODE_TTL_MS) < 60_000) {
    return "cooldown";
  }
  await queueAutomaticReceiptRenewal(client, j.id);
  return "queued";
}

export async function enqueueAutomaticReceiptCode(
  client: PoolClient,
  transferId: string,
  preferredChannel?: ReceiptChannel,
): Promise<boolean> {
  const t = (
    await client.query<Transfer>("SELECT * FROM tt_transfers WHERE id=$1", [
      transferId,
    ])
  ).rows[0];
  if (
    !t?.pending_party_id ||
    t.deleted_at ||
    t.general_archived_at ||
    !["waiting", "active"].includes(t.status)
  )
    return false;
  const targets = await automaticReceiptTargets(client, t.pending_party_id);
  const target =
    targets.find((r) => r.channel === preferredChannel) ??
    targets.find((r) => r.channel === "max") ??
    targets[0];
  if (!target) return false;
  await client.query(
    `INSERT INTO tt_automatic_receipt_codes
    (id,transfer_id,handoff_version,pending_party_id,channel,messenger_user_id,messenger_chat_id,phone_snapshot)
    VALUES($1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8) ON CONFLICT(transfer_id,handoff_version) DO NOTHING`,
    [
      randomUUID(),
      t.id,
      t.handoff_version,
      t.pending_party_id,
      target.channel,
      target.userId,
      target.chatId,
      target.phone,
    ],
  );
  return true;
}

function context(j: Job): string {
  return JSON.stringify([
    j.id,
    j.transfer_id,
    j.handoff_version,
    j.pending_party_id,
    j.channel,
    j.messenger_user_id,
    j.messenger_chat_id,
    j.phone_snapshot,
    j.generation,
  ]);
}
function open(t: Transfer | undefined, j: Job): t is Transfer {
  return (
    !!t &&
    !t.deleted_at &&
    !t.general_archived_at &&
    ["waiting", "active"].includes(t.status) &&
    t.handoff_version === j.handoff_version &&
    t.pending_party_id === j.pending_party_id &&
    t.holder_party_id !== j.pending_party_id
  );
}
async function targetStillMatches(
  client: PoolClient,
  j: Job,
): Promise<boolean> {
  return (await automaticReceiptTargets(client, j.pending_party_id)).some(
    (t) =>
      t.channel === j.channel &&
      t.userId === j.messenger_user_id &&
      t.chatId === j.messenger_chat_id &&
      t.phone === j.phone_snapshot,
  );
}
async function codeStillValid(client: PoolClient, j: Job): Promise<boolean> {
  return (
    !!j.code_hash &&
    (
      await client.query(
        `SELECT 1 FROM tt_handoff_codes
    WHERE transfer_id=$1 AND handoff_version=$2 AND pending_party_id=$3::uuid AND code_hash=$4
      AND consumed_at IS NULL AND expires_at>NOW() AND verify_attempt_count<$5`,
        [
          j.transfer_id,
          j.handoff_version,
          j.pending_party_id,
          j.code_hash,
          HANDOFF_CODE_MAX_VERIFY_ATTEMPTS,
        ],
      )
    ).rows.length > 0
  );
}
async function cancel(client: PoolClient, id: string, reason: string) {
  await client.query(
    "UPDATE tt_automatic_receipt_codes SET status='cancelled',encrypted_code=NULL,last_error_code=$2 WHERE id=$1::uuid",
    [id, reason],
  );
}

/** Transfer -> job lock order also matches transfer deletion/cascade and explicit renew. */
async function deliverStep(
  pool: Pool,
  id: string,
  channel: ReceiptChannel,
  transport: AutomaticReceiptTransport,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const ref = (
      await c.query<{ transfer_id: string }>(
        "SELECT transfer_id FROM tt_automatic_receipt_codes WHERE id=$1::uuid",
        [id],
      )
    ).rows[0];
    if (!ref) {
      await c.query("COMMIT");
      return "skip";
    }
    const t = (
      await c.query<Transfer>(
        "SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE SKIP LOCKED",
        [ref.transfer_id],
      )
    ).rows[0];
    if (!t) {
      await c.query("COMMIT");
      return "skip";
    }
    const j = (
      await c.query<Job>(
        `SELECT * FROM tt_automatic_receipt_codes WHERE id=$1::uuid AND channel=$2
      AND status='pending' AND next_attempt_at<=NOW() FOR UPDATE SKIP LOCKED`,
        [id, channel],
      )
    ).rows[0];
    if (!j) {
      await c.query("COMMIT");
      return "skip";
    }
    if (!open(t, j) || !(await targetStillMatches(c, j))) {
      await cancel(c, id, "STALE_RECIPIENT");
      await c.query("COMMIT");
      return "cancelled";
    }
    if (
      !j.code_hash &&
      Date.now() - j.next_attempt_at.getTime() > 30 * 60_000
    ) {
      await cancel(c, id, "DELIVERY_WINDOW_EXPIRED");
      await c.query("COMMIT");
      return "cancelled";
    }
    let code: string;
    if (j.code_hash) {
      if (!(await codeStillValid(c, j)) || !j.encrypted_code) {
        await cancel(c, id, "CODE_EXPIRED_OR_REPLACED");
        await c.query("COMMIT");
        return "cancelled";
      }
      try {
        code = decryptAutomaticReceiptCode(j.encrypted_code, context(j));
      } catch {
        await cancel(c, id, "CODE_DECRYPT_FAILED");
        await c.query("COMMIT");
        return "cancelled";
      }
    } else {
      const issued = await generateHandoffCodeForPendingParty(c, {
        transferIdOrCode: t.id,
        pendingPartyId: j.pending_party_id,
        auditUserId: null,
        auditPartyId: j.pending_party_id,
        auditAction: "automatic_receipt_code",
        notifyHolder: false,
      });
      if (!issued.ok) {
        await cancel(c, id, "CODE_UNAVAILABLE");
        await c.query("COMMIT");
        return "cancelled";
      }
      code = issued.code;
      await c.query(
        `UPDATE tt_automatic_receipt_codes SET encrypted_code=$2,code_hash=$3,code_expires_at=$4
        WHERE id=$1::uuid`,
        [
          id,
          encryptAutomaticReceiptCode(code, context(j)),
          hashOtp(code, requireHandoffOtpPepper()),
          new Date(issued.expiresAt),
        ],
      );
    }
    const header = !j.header_sent_at;
    const route = header
      ? await buildNotificationRouteSnapshot(
          c,
          t.holder_party_id,
          t.pending_party_id,
        )
      : {};
    const text = header
      ? `${formatTransferContextHeader({ publicCode: t.public_code, itemTitle: t.item_title, ...route })}\n\nВАМ ПЕРЕДАЮТ ПРЕДМЕТ.\nСледующее сообщение — код приёма. Назовите его отправителю только при получении предмета.\nКод одноразовый, действует ${Math.round(HANDOFF_CODE_TTL_MS / 60000)} минут. Если истечёт, нажмите кнопку ниже.\nПолучение ещё не подтверждено.`
      : code;
    let result: Awaited<ReturnType<AutomaticReceiptTransport>>;
    try {
      result = await transport({
        channel,
        userId: j.messenger_user_id,
        chatId: j.messenger_chat_id,
        text,
        ...(header ? { callback: automaticReceiptCallback(id) } : {}),
      });
    } catch {
      result = { ok: false, code: "TRANSPORT_FAILED", retryable: true };
    }
    if (result.ok) {
      await c.query(
        header
          ? "UPDATE tt_automatic_receipt_codes SET header_sent_at=NOW(),attempt_count=0 WHERE id=$1::uuid"
          : "UPDATE tt_automatic_receipt_codes SET status='sent',sent_at=NOW(),encrypted_code=NULL,attempt_count=0 WHERE id=$1::uuid",
        [id],
      );
      await c.query("COMMIT");
      return header ? "header" : "sent";
    }
    const attempts = j.attempt_count + 1,
      retry = result.retryable === true && attempts < 8;
    const reason = /^[A-Z0-9_]{1,64}$/.test(result.code)
      ? result.code
      : "DELIVERY_FAILED";
    const delay = Math.min(300, Math.max(1, result.retryAfterSeconds ?? 30));
    await c.query(
      `UPDATE tt_automatic_receipt_codes SET status=$2,attempt_count=$3,last_error_code=$4,
      next_attempt_at=NOW()+($5::int*interval '1 second'),encrypted_code=CASE WHEN $2='failed' THEN NULL ELSE encrypted_code END
      WHERE id=$1::uuid`,
      [id, retry ? "pending" : "failed", attempts, reason, delay],
    );
    await c.query("COMMIT");
    return "failed";
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}

export async function processAutomaticReceiptCodes(
  pool: Pool,
  input: {
    channel: ReceiptChannel;
    transport: AutomaticReceiptTransport;
    deliveryEnabled: boolean;
    limit?: number;
  },
) {
  const result = { sent: 0, failed: 0, cancelled: 0 };
  if (!input.deliveryEnabled) return result;
  const jobs = await pool.query<{ id: string }>(
    `SELECT id::text FROM tt_automatic_receipt_codes
    WHERE channel=$1 AND status='pending' AND next_attempt_at<=NOW() ORDER BY created_at LIMIT $2`,
    [input.channel, input.limit ?? 20],
  );
  for (const job of jobs.rows) {
    let step = await deliverStep(pool, job.id, input.channel, input.transport);
    if (step === "header")
      step = await deliverStep(pool, job.id, input.channel, input.transport);
    if (step === "sent" || step === "failed" || step === "cancelled")
      result[step]++;
  }
  return result;
}

export async function handleAutomaticReceiptCallback(
  client: PoolClient,
  input: {
    payload: string;
    channel: ReceiptChannel;
    userId: bigint;
    chatId: bigint;
  },
): Promise<{ text: string }> {
  if (!isAutomaticReceiptCallback(input.payload))
    return { text: "Кнопка недействительна." };
  await (
    input.channel === "telegram"
      ? lockTanbotTelegramMessenger
      : lockTanbotMaxMessenger
  )(client, input.userId);
  const id = input.payload.slice(3);
  const ref = (
    await client.query<{ transfer_id: string }>(
      "SELECT transfer_id FROM tt_automatic_receipt_codes WHERE id=$1::uuid",
      [id],
    )
  ).rows[0];
  if (!ref) return { text: "Это приглашение устарело." };
  const t = (
    await client.query<Transfer>(
      "SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE",
      [ref.transfer_id],
    )
  ).rows[0];
  const j = (
    await client.query<Job>(
      "SELECT * FROM tt_automatic_receipt_codes WHERE id=$1::uuid FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (
    !j ||
    !open(t, j) ||
    input.channel !== j.channel ||
    input.userId.toString() !== j.messenger_user_id ||
    input.chatId.toString() !== j.messenger_chat_id ||
    !(await targetStillMatches(client, j))
  ) {
    return {
      text: "Эта кнопка устарела или недоступна. Новый код может запросить только текущий получатель в своём подключённом боте.",
    };
  }
  await client.query(
    `DELETE FROM tt_bot_receipt_code_entries WHERE channel=$1 AND messenger_user_id=$2 AND messenger_chat_id=$3`,
    [input.channel, input.userId.toString(), input.chatId.toString()],
  );
  if (j.status === "pending" && !j.code_hash)
    return { text: "Новый код уже поставлен в очередь и придёт в этот чат." };
  if (await codeStillValid(client, j)) {
    if (j.status === "sent")
      return {
        text: "Код в предыдущем сообщении ещё действует. Назовите его отправителю при получении предмета.",
      };
    if (j.status === "pending")
      return {
        text: "Код уже доставляется в этот чат. Пожалуйста, подождите.",
      };
  }
  if (j.generation >= 3)
    return {
      text: "Лимит обновлений кода исчерпан. Попросите отправителя обновить приглашение в «Моих передачах».",
    };
  if (
    j.code_expires_at &&
    Date.now() - (j.code_expires_at.getTime() - HANDOFF_CODE_TTL_MS) < 60_000
  )
    return {
      text: "Повторный запрос доступен через минуту после выдачи кода.",
    };
  await queueAutomaticReceiptRenewal(client, id);
  return {
    text: "Запрошен новый код. Он придёт отдельным сообщением в этот чат.",
  };
}
