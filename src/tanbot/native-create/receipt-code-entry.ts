import type { PoolClient } from "pg";
import { buildNotificationTransferState, formatNotificationTransferState } from "../../tan-tracker/notification-transfer-state";
import type { NativeCreateContext, NativeCreateReply } from "./engine";
import { assertNativeCreateContext, lockNativeCreateMessenger } from "./access-guard";
import { buildReceiptEntryCallback, type ReceiptEntryCallback } from "../receipt-entry-callback";
import { parseHandoffCodePaste } from "../../tan-tracker/handoff-code-paste-parse";
import { verifyPendingReceiptCode, type LockedReceiptTransfer } from "../../tan-tracker/verify-pending-receipt-code";
import { HANDOFF_CODE_TTL_MS } from "../../tan-tracker/otp-config";
import { buildNativeMainMenuReply, parseNativeBotSlashCommand, isNativeMainMenuText,
  isNativeCreateMenuText, isNativeContinueDraftText, peekResumableNativeDraft } from "./main-menu";
import { buildMainMenuInline } from "./keyboards";
import { buildNativeCreateCallback } from "./callback-codec";

type ReceiptTransfer = LockedReceiptTransfer & {
  public_code: string; item_title: string; sender_name: string; recipient_name: string;
};
type Entry = {
  messenger_user_id: string; staff_user_id: string | null; person_id: string | null;
  party_id: string; pending_party_id: string; transfer_id: string; handoff_version: number; expires_at: Date;
};
export function receiptEntryCallback(transferId: string, handoffVersion: number): string | null {
  return buildReceiptEntryCallback("code", transferId, handoffVersion);
}
function textLine(value: string, max = 100): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}
function contextText(row: ReceiptTransfer): string {
  return `Передача ${row.public_code}\n${textLine(row.item_title, 200)}\nОт: ${textLine(row.sender_name)}\nКому: ${textLine(row.recipient_name)}`;
}
async function currentParty(client: PoolClient, ctx: NativeCreateContext): Promise<string | null> {
  try { await assertNativeCreateContext(client, ctx); } catch { return null; }
  if (ctx.isLinkedStaff && ctx.staffUserId) {
    const table = ctx.channel === "telegram" ? "tanbot_telegram_accounts" : "tanbot_max_accounts";
    const prefix = ctx.channel === "telegram" ? "telegram" : "max";
    const binding = await client.query(
      `SELECT 1 FROM ${table} WHERE user_id=$1::uuid AND ${prefix}_user_id=$2
       AND ${prefix}_chat_id=$3 AND stopped_at IS NULL`,
      [ctx.staffUserId, ctx.messengerUserId.toString(), ctx.messengerChatId]);
    if (!binding.rows.length) return null;
    return (await client.query<{ id: string }>(
      `SELECT id FROM tt_parties WHERE kind='user' AND user_id=$1::uuid`, [ctx.staffUserId])).rows[0]?.id ?? null;
  }
  if (!ctx.personId) return null;
  return (await client.query<{ party_id: string }>(
    `SELECT party_id FROM tt_external_persons WHERE id=$1::uuid`, [ctx.personId])).rows[0]?.party_id ?? null;
}
export async function clearReceiptEntry(client: PoolClient, ctx: NativeCreateContext): Promise<void> {
  await client.query(`DELETE FROM tt_bot_receipt_code_entries WHERE channel=$1 AND messenger_chat_id=$2`,
    [ctx.channel, ctx.messengerChatId]);
}
function withCancel(ctx: NativeCreateContext, row: ReceiptTransfer, text: string): NativeCreateReply {
  const callback = buildReceiptEntryCallback("cancel", row.id, row.handoff_version)!;
  return ctx.channel === "telegram"
    ? { text, telegramInlineKeyboard: [[{ text: "Отменить ввод кода", callback_data: callback }]] }
    : { text, maxInlineButtons: [[{ type: "callback", text: "Отменить ввод кода", payload: callback }]] };
}
async function loadTransfer(client: PoolClient, id: string, partyId: string): Promise<ReceiptTransfer | null> {
  return (await client.query<ReceiptTransfer>(
    `SELECT t.*,h.display_name AS sender_name,p.display_name AS recipient_name
     FROM tt_transfers t JOIN tt_parties h ON h.id=t.holder_party_id
     JOIN tt_parties p ON p.id=t.pending_party_id
     WHERE t.id=$1 AND t.holder_party_id=$2::uuid AND t.status IN ('waiting','active')
       AND t.deleted_at IS NULL AND t.general_archived_at IS NULL
     FOR UPDATE OF t`, [id, partyId])).rows[0] ?? null;
}
/** Explicit current-holder choices only, never another user's list or an inferred "last transfer". */
export async function appendReceiptEntryChoices(
  client: PoolClient, ctx: NativeCreateContext, reply: NativeCreateReply, onlyPublicCode?: string, page = 0,
  options: { omitSelectionHint?: boolean } = {},
): Promise<NativeCreateReply> {
  const partyId = await currentParty(client, ctx);
  if (!partyId) return reply;
  const rows = (await client.query<{ id: string; public_code: string; handoff_version: number }>(
    `SELECT id,public_code,handoff_version FROM tt_transfers
     WHERE holder_party_id=$1::uuid AND pending_party_id IS NOT NULL
       AND status IN ('waiting','active') AND deleted_at IS NULL AND general_archived_at IS NULL
       AND ($2::text IS NULL OR public_code=$2)
     ORDER BY created_at DESC,id DESC LIMIT 6 OFFSET $3`, [partyId, onlyPublicCode ?? null, page * 5])).rows;
  if (!rows.length) return reply;
  const hasNext = rows.length > 5;
  const visible = rows.slice(0,5);
  const paging: Array<{ text: string; data: string }> = [];
  if (!onlyPublicCode && page > 0) paging.push({
    text: "Предыдущие передачи",
    data: buildReceiptEntryCallback("list", String(page - 1), 1)!,
  });
  if (!onlyPublicCode && hasNext && page < 99999) paging.push({
    text: "Следующие передачи",
    data: buildReceiptEntryCallback("list", String(page + 1), 1)!,
  });
  const text = options.omitSelectionHint
    ? reply.text
    : `${reply.text}\n\nДля подтверждения в этом чате выберите передачу кнопкой «Ввести код».`;
  if (ctx.channel === "telegram") {
    // Telegram cannot attach both reply and inline keyboards in one message.
    // Keep the complete navigation inline when adding receipt buttons, not just the new action.
    const existing = reply.telegramInlineKeyboard ?? [];
    const hasMenu = existing.flat().some(b => b.text === "Меню" && !!b.callback_data);
    const footer = hasMenu ? [] : buildMainMenuInline("telegram").telegramInlineKeyboard ?? [];
    const resume = await peekResumableNativeDraft(client, ctx);
    const resumeCallback = resume
      ? buildNativeCreateCallback("menu_resume", resume.id, (resume.payload as { revision?: number }).revision ?? 1)
      : null;
    return {
      ...reply, text,
      telegramInlineKeyboard: [
        ...visible.map(r => [{ text: `Ввести код · ${r.public_code}`, callback_data: receiptEntryCallback(r.id, r.handoff_version)! }]),
        ...(paging.length ? [paging.map(p => ({ text: p.text, callback_data: p.data }))] : []),
        ...existing.map(row => row.map(b => "url" in b && typeof b.url === "string" && b.text === "Мои передачи"
          ? { ...b, text: "Открыть список в ЛК" } : b)),
        ...(resumeCallback ? [[{ text: "Продолжить оформление", callback_data: resumeCallback }]] : []),
        ...footer,
      ],
    };
  }
  return {
    ...reply, text,
    maxInlineButtons: [
      ...visible.map(r => [{ type: "callback" as const, text: `Ввести код · ${r.public_code}`, payload: receiptEntryCallback(r.id, r.handoff_version)! }]),
      ...(paging.length ? [paging.map(p => ({ type: "callback" as const, text: p.text, payload: p.data }))] : []),
      ...(reply.maxInlineButtons ?? []),
    ],
  };
}
export async function handleReceiptEntryCallback(
  client: PoolClient, ctx: NativeCreateContext, parsed: ReceiptEntryCallback,
): Promise<NativeCreateReply> {
  if (parsed.action === "receive") return { text: "Для получения кода откройте раздел «Получить код приёма»." };
  const partyId = await currentParty(client, ctx);
  if (!partyId) return { text: "Подтверждение доступно только текущему держателю в личном чате с подключённым профилем." };
  const id = parsed.transferId;
  if (parsed.action === "cancel") {
    const removed = await client.query(`DELETE FROM tt_bot_receipt_code_entries
      WHERE channel=$1 AND messenger_chat_id=$2 AND messenger_user_id=$3
        AND transfer_id=$4 AND handoff_version=$5 AND party_id=$6::uuid`,
    [ctx.channel, ctx.messengerChatId, ctx.messengerUserId.toString(), id, parsed.version, partyId]);
    if (!removed.rowCount) return { text: "Эта кнопка отмены устарела. Текущий ввод кода не изменён." };
    return buildNativeMainMenuReply(client, ctx, { prefix: "Ввод кода отменён. Передача не подтверждена.", lock: false });
  }
  const row = await loadTransfer(client, id, partyId);
  if (!row || row.handoff_version !== parsed.version) {
    // An unsuccessful explicit switch must not leave another transfer silently selected.
    await clearReceiptEntry(client, ctx);
    return { text: "Эта кнопка устарела или передача недоступна. Откройте «Мои передачи» и выберите актуальную передачу." };
  }
  await client.query(
    `INSERT INTO tt_bot_receipt_code_entries
     (channel,messenger_chat_id,messenger_user_id,staff_user_id,person_id,party_id,transfer_id,handoff_version,pending_party_id,expires_at)
     VALUES($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9::uuid,NOW()+INTERVAL '10 minutes')
     ON CONFLICT(channel,messenger_chat_id) DO UPDATE SET
       messenger_user_id=EXCLUDED.messenger_user_id,staff_user_id=EXCLUDED.staff_user_id,person_id=EXCLUDED.person_id,
       party_id=EXCLUDED.party_id,pending_party_id=EXCLUDED.pending_party_id,
       transfer_id=EXCLUDED.transfer_id,handoff_version=EXCLUDED.handoff_version,
       expires_at=EXCLUDED.expires_at`,
    [ctx.channel, ctx.messengerChatId, ctx.messengerUserId.toString(), ctx.isLinkedStaff ? ctx.staffUserId : null,
      ctx.isLinkedStaff ? null : ctx.personId, partyId, row.id, row.handoff_version, row.pending_party_id],
  );
  return withCancel(ctx, row, `${contextText(row)}\n\nПопросите у получателя код приёма и отправьте его сюда: 6 цифр или сообщение с кодом целиком. Код действует ${Math.round(HANDOFF_CODE_TTL_MS / 60_000)} минут с момента выдачи. Если он истёк, попросите получателя получить новый.\nПередача будет подтверждена только после успешной проверки.`);
}
export async function handleReceiptEntryText(
  client: PoolClient, ctx: NativeCreateContext, text: string,
): Promise<NativeCreateReply | null> {
  await lockNativeCreateMessenger(client, ctx);
  const trimmed = text.trim();
  const navigation = parseNativeBotSlashCommand(trimmed) || isNativeMainMenuText(trimmed)
    || isNativeCreateMenuText(trimmed) || isNativeContinueDraftText(trimmed)
    || ["мои передачи", "настройки", "получить код приёма", "получить код приема", "/status", "/stop", "/code"].includes(trimmed.toLowerCase());
  if (navigation) { await clearReceiptEntry(client, ctx); return null; }
  const entry = (await client.query<Entry>(
    `SELECT * FROM tt_bot_receipt_code_entries WHERE channel=$1 AND messenger_chat_id=$2 FOR UPDATE`,
    [ctx.channel, ctx.messengerChatId])).rows[0];
  const parsed = parseHandoffCodePaste(text);
  if (!entry) {
    return parsed.ok ? { text: "Сначала откройте «Мои передачи» и нажмите «Ввести код» у нужной передачи. Код не проверен, передача не подтверждена." } : null;
  }
  const partyId = await currentParty(client, ctx);
  const identityMatches = entry.messenger_user_id === ctx.messengerUserId.toString()
    && (ctx.isLinkedStaff
      ? entry.staff_user_id === ctx.staffUserId && entry.person_id === null
      : entry.person_id === ctx.personId && entry.staff_user_id === null);
  if (!partyId || partyId !== entry.party_id || !identityMatches || entry.expires_at.getTime() <= Date.now()) {
    await clearReceiptEntry(client, ctx);
    return { text: "Ввод кода завершён или доступ изменился. Откройте «Мои передачи» и заново выберите передачу. Передача не подтверждена." };
  }
  if (trimmed.toLowerCase() === "отмена") {
    await clearReceiptEntry(client, ctx);
    return buildNativeMainMenuReply(client, ctx, { prefix: "Ввод кода отменён. Передача не подтверждена.", lock: false });
  }
  const row = await loadTransfer(client, entry.transfer_id, partyId);
  if (!row || row.handoff_version !== entry.handoff_version || row.pending_party_id !== entry.pending_party_id) {
    await clearReceiptEntry(client, ctx);
    return { text: "Передача уже изменилась или недоступна. Код не применён. Выберите актуальную передачу в «Моих передачах»." };
  }
  if (!parsed.ok) {
    return withCancel(ctx, row, `${contextText(row)}\n\n${parsed.reason || "Отправьте 6 цифр или вставьте одно сообщение с кодом."}\nПередача не подтверждена.`);
  }
  const mentioned = [...text.matchAll(/\bTT-\d{4}-\d+\b/gi)].map(m => m[0].toUpperCase());
  if (mentioned.some(code => code !== row.public_code.toUpperCase())) {
    return withCancel(ctx, row, `${contextText(row)}\n\nВ сообщении указан другой трек. Пришлите код именно этой передачи. Передача не подтверждена.`);
  }
  const result = await verifyPendingReceiptCode(client, {
    row, code: parsed.code, actingPartyId: partyId, auditUserId: ctx.isLinkedStaff ? ctx.staffUserId : null,
    botReply: true,
  });
  if (!result.ok) return withCancel(ctx, row, `${contextText(row)}\n\n${result.message}\nПередача не подтверждена.`);
  await clearReceiptEntry(client, ctx);
  const status = formatNotificationTransferState(await buildNotificationTransferState(client, row.id));
  return buildNativeMainMenuReply(client, ctx, {
    prefix: `${contextText(row)}\n\n${status}\n\nКод проверен. Передача подтверждена, получатель стал текущим держателем. Теперь можно передать посылку.`,
    lock: false,
  });
}
