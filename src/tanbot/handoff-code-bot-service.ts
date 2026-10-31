import type { PoolClient } from "pg";
import { generateHandoffCodeForPendingParty } from "../tan-tracker/handoff-code-generate";
import {
  buildNotificationRouteSnapshot,
  formatTransferContextHeader,
} from "../tan-tracker/staff-notification-route";
import { ensurePartyForUserOnWrite } from "../tan-tracker/repository";
import { tanTrackerNavAllowed } from "../tan-tracker/scope";
import { findAccountByMaxUserId } from "../tanbot-max/link-repository";
import { findAccountByTelegramUserId } from "../tanbot-telegram/link-repository";
import { isTanbotHandoffCodePilotEnabled } from "./handoff-code-pilot-config";
import { isTanbotMaxEnabled } from "../tanbot-max/config";
import { isTanbotTelegramEnabled } from "../tanbot-telegram/config";

export type BotChannel = "telegram" | "max";

export type PendingTransferRow = {
  id: string;
  publicCode: string;
  itemTitle: string;
};

const CALLBACK_PREFIX = "hc:";
export const HANDOFF_CALLBACK_GEN = `${CALLBACK_PREFIX}gen:`;
export const HANDOFF_CALLBACK_MENU = `${CALLBACK_PREFIX}menu`;

export type ParsedHandoffGenCallback = { publicCode: string; handoffVersion: number | null };

export function buildHandoffGenCallback(publicCode: string, handoffVersion?: number): string {
  const code = publicCode.trim().slice(0, 32);
  if (handoffVersion != null && Number.isSafeInteger(handoffVersion) && handoffVersion > 0) {
    return `${HANDOFF_CALLBACK_GEN}${code}:${handoffVersion}`.slice(0, 64);
  }
  return `${HANDOFF_CALLBACK_GEN}${code}`.slice(0, 64);
}

export function parseHandoffGenCallbackDetail(payload: string): ParsedHandoffGenCallback | null {
  if (!payload.startsWith(HANDOFF_CALLBACK_GEN)) return null;
  const rest = payload.slice(HANDOFF_CALLBACK_GEN.length).trim();
  if (!rest) return null;
  const lastColon = rest.lastIndexOf(":");
  if (lastColon >= 0) {
    const hvStr = rest.slice(lastColon + 1);
    const hv = Number(hvStr);
    if (Number.isSafeInteger(hv) && hv > 0 && hvStr === String(hv)) {
      const pub = rest.slice(0, lastColon);
      if (pub && pub.length <= 32 && pub === pub.trim() && !pub.includes(":")) {
        return { publicCode: pub, handoffVersion: hv };
      }
    }
    return null;
  }
  return { publicCode: rest.slice(0, 32), handoffVersion: null };
}

export function parseHandoffGenCallback(payload: string): string | null {
  return parseHandoffGenCallbackDetail(payload)?.publicCode ?? null;
}

export async function resolveStaffUserIdForBotChannel(
  client: PoolClient,
  channel: BotChannel,
  externalUserId: bigint,
): Promise<string | null> {
  if (channel === "telegram") {
    const row = await findAccountByTelegramUserId(client, externalUserId);
    return row?.user_id ?? null;
  }
  const row = await findAccountByMaxUserId(client, externalUserId);
  return row?.user_id ?? null;
}

export async function loadStaffUserRow(client: PoolClient, userId: string) {
  const res = await client.query<{ id: string; status: string; role: string; full_name: string; phone: string | null }>(
    `SELECT id::text, status, role, full_name, phone FROM users WHERE id = $1::uuid`,
    [userId],
  );
  return res.rows[0];
}

export async function assertHandoffCodeBotAccess(
  client: PoolClient,
  channel: BotChannel,
  userId: string,
): Promise<{ ok: true; partyId: string } | { ok: false; message: string }> {
  if (!isTanbotHandoffCodePilotEnabled()) {
    return { ok: false, message: "Пилот кодов приёма отключён." };
  }
  if (channel === "telegram" && !isTanbotTelegramEnabled()) {
    return { ok: false, message: "Telegram отключён." };
  }
  if (channel === "max" && !isTanbotMaxEnabled()) {
    return { ok: false, message: "MAX отключён." };
  }

  const user = await loadStaffUserRow(client, userId);
  if (!user || user.status !== "active" || !tanTrackerNavAllowed(user.role)) {
    return { ok: false, message: "Аккаунт недоступен." };
  }

  const account =
    channel === "telegram"
      ? await client.query<{ notifications_enabled: boolean; stopped_at: Date | null }>(
          `SELECT notifications_enabled, stopped_at FROM tanbot_telegram_accounts WHERE user_id = $1::uuid`,
          [userId],
        )
      : await client.query<{ notifications_enabled: boolean; stopped_at: Date | null }>(
          `SELECT notifications_enabled, stopped_at FROM tanbot_max_accounts WHERE user_id = $1::uuid`,
          [userId],
        );
  const acc = account.rows[0];
  if (!acc || acc.stopped_at) {
    return { ok: false, message: "Канал не подключён к личному кабинету." };
  }
  if (!acc.notifications_enabled) {
    return { ok: false, message: "Включите уведомления канала в личном кабинете." };
  }

  const party = await ensurePartyForUserOnWrite(client, user.id, user.full_name, user.phone);
  return { ok: true, partyId: party.id };
}

export async function listPendingTransfersForParty(
  client: PoolClient,
  partyId: string,
): Promise<PendingTransferRow[]> {
  const res = await client.query<PendingTransferRow>(
    `SELECT id, public_code AS "publicCode", item_title AS "itemTitle"
     FROM tt_transfers
     WHERE pending_party_id = $1::uuid
       AND status IN ('waiting', 'active')
     ORDER BY public_code ASC
     LIMIT 10`,
    [partyId],
  );
  return res.rows;
}

export function formatPendingTransfersMessage(transfers: PendingTransferRow[]): string {
  if (!transfers.length) {
    return "Нет передач, где вы сейчас ожидающий получатель.";
  }
  if (transfers.length === 1) {
    const t = transfers[0]!;
    return `Передача ${t.publicCode}: ${t.itemTitle}\nНажмите «Получить код».`;
  }
  const lines = transfers.map((t) => `• ${t.publicCode}: ${t.itemTitle}`);
  return `Выберите передачу:\n${lines.join("\n")}`;
}

export function formatIssuedCodeMessage(input: {
  publicCode: string;
  itemTitle: string;
  expiresAt: number;
  replacedPrevious: boolean;
  routeFromDisplayName?: string | null;
  routeToDisplayName?: string | null;
}): string {
  const until = new Date(input.expiresAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const replaced = input.replacedPrevious
    ? "\nПрежний код больше не действует."
    : "";
  const ctx = formatTransferContextHeader({
    publicCode: input.publicCode,
    itemTitle: input.itemTitle,
    routeFromDisplayName: input.routeFromDisplayName,
    routeToDisplayName: input.routeToDisplayName,
  });
  return (
    `${ctx}\n\n` +
    `Код приёма: следующим сообщением шесть цифр для копирования.\n` +
    `Действует до: ${until} (МСК).` +
    `${replaced}\n` +
    `Сообщите код передающему для ввода в Тан-трекере. Это не SMS-код входа.`
  );
}

export async function issueHandoffCodeViaBot(
  client: PoolClient,
  input: {
    channel: BotChannel;
    userId: string;
    partyId: string;
    transferPublicCode: string;
    expectedHandoffVersion?: number | null;
  },
): Promise<
  | { ok: true; message: string; code: string }
  | { ok: false; message: string }
> {
  const transferRow = await client.query<{
    id: string;
    handoff_version: number;
    pending_party_id: string | null;
    holder_party_id: string | null;
    status: string;
  }>(
    `SELECT id, handoff_version, pending_party_id::text, holder_party_id::text, status FROM tt_transfers WHERE public_code = $1 LIMIT 1 FOR UPDATE`,
    [input.transferPublicCode],
  );
  const transfer = transferRow.rows[0];
  if (!transfer) {
    return { ok: false, message: "Передача не найдена." };
  }
  if (!transfer.pending_party_id || transfer.pending_party_id !== input.partyId) {
    return { ok: false, message: "Вы не являетесь ожидающим получателем этой передачи." };
  }
  if (transfer.status === "completed") {
    return { ok: false, message: "Передача уже завершена." };
  }
  if (
    input.expectedHandoffVersion != null &&
    transfer.handoff_version !== input.expectedHandoffVersion
  ) {
    return {
      ok: false,
      message: "Передача обновилась. Откройте актуальное уведомление или раздел передач.",
    };
  }

  const hadActive = await client.query(
    `SELECT 1 FROM tt_handoff_codes hc
     JOIN tt_transfers t ON t.id = hc.transfer_id
     WHERE t.public_code = $1 AND hc.consumed_at IS NULL AND hc.expires_at > NOW()
     LIMIT 1`,
    [input.transferPublicCode],
  );

  const gen = await generateHandoffCodeForPendingParty(client, {
    transferIdOrCode: input.transferPublicCode,
    pendingPartyId: input.partyId,
    auditUserId: input.userId,
    auditPartyId: input.partyId,
    auditAction: input.channel === "telegram" ? "code_generate_telegram" : "code_generate_max",
  });
  if (!gen.ok) {
    return { ok: false, message: gen.message };
  }
  const route = await buildNotificationRouteSnapshot(
    client,
    transfer.holder_party_id,
    transfer.pending_party_id,
  );
  return {
    ok: true,
    code: gen.code,
    message: formatIssuedCodeMessage({
      publicCode: gen.publicCode,
      itemTitle: gen.itemTitle,
      expiresAt: gen.expiresAt,
      replacedPrevious: (hadActive.rowCount ?? 0) > 0,
      routeFromDisplayName: route.routeFromDisplayName,
      routeToDisplayName: route.routeToDisplayName,
    }),
  };
}
