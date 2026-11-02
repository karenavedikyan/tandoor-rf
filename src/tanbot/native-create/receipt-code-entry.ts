import type { PoolClient } from "pg";
import { buildNotificationTransferState } from "../../tan-tracker/notification-transfer-state";
import type { NativeCreateContext, NativeCreateReply } from "./engine";
import { assertNativeCreateContext, lockNativeCreateMessenger } from "./access-guard";
import { buildReceiptEntryCallback, type ReceiptEntryCallback } from "../receipt-entry-callback";
import { buildTrackStatusCallback } from "../track-status-callback";
import { parseHandoffCodePaste } from "../../tan-tracker/handoff-code-paste-parse";
import { verifyPendingReceiptCode, type LockedReceiptTransfer } from "../../tan-tracker/verify-pending-receipt-code";
import { HANDOFF_CODE_TTL_MS } from "../../tan-tracker/otp-config";
import { buildNativeMainMenuReply, parseNativeBotSlashCommand, isNativeMainMenuText,
  isNativeCreateMenuText, isNativeContinueDraftText } from "./main-menu";
import { buildNativeCreateCallback } from "./callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "./menu-sentinel";
import { removeTelegramReplyKeyboard } from "./keyboards";
import { formatReceiptConfirmation } from "../../tan-tracker/receipt-confirmation-copy";
import { buildExternalPendingInviteMessage } from "./invitation-handoff";
import { holderCompletionPermission, startNativeHolderAction, type HolderActionTransfer } from "./holder-actions";
import { holderTransferActionButtons } from "./holder-transfer-buttons";

type ReceiptTransfer = LockedReceiptTransfer & HolderActionTransfer & {
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
  return row.pending_party_id
    ? `Передача ${row.public_code}\n${textLine(row.item_title, 200)}\nОт: ${textLine(row.sender_name)}\nКому: ${textLine(row.recipient_name)}`
    : `Трек ${row.public_code}\n${textLine(row.item_title, 200)}\nВы текущий держатель. Трек ещё не завершён.`;
}
export async function currentParty(client: PoolClient, ctx: NativeCreateContext): Promise<string | null> {
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
function menuInlineRow(ctx: NativeCreateContext): Array<{ text: string; callback_data: string }> | Array<{ type: "callback"; text: string; payload: string }> {
  const payload = buildNativeCreateCallback("menu", NATIVE_MENU_DRAFT_HEX, 1)!;
  return ctx.channel === "telegram"
    ? [{ text: "Меню", callback_data: payload }]
    : [{ type: "callback" as const, text: "Меню", payload }];
}

function withCancel(ctx: NativeCreateContext, row: ReceiptTransfer, text: string): NativeCreateReply {
  const callback = buildReceiptEntryCallback("cancel", row.id, row.handoff_version)!;
  const retry = buildReceiptEntryCallback("retry", row.id, row.handoff_version)!;
  return ctx.channel === "telegram"
    ? { text, telegramInlineKeyboard: [
      [{ text: "Запросить код повторно", callback_data: retry }],
      [{ text: "Отменить ввод кода", callback_data: callback }],
    ] }
    : { text, maxInlineButtons: [
      [{ type: "callback", text: "Запросить код повторно", payload: retry }],
      [{ type: "callback", text: "Отменить ввод кода", payload: callback }],
    ] };
}

function transferDetailUi(
  ctx: NativeCreateContext,
  row: HolderActionTransfer,
  listPage = 0,
  withNavigation = true,
): Pick<NativeCreateReply, "telegramInlineKeyboard" | "maxInlineButtons"> {
  if (!row.pending_party_id) {
    const buttons = holderTransferActionButtons(row, row.holder_party_id);
    if (withNavigation) buttons.push({
      text: "К списку", data: buildReceiptEntryCallback("list", String(listPage), 1)!,
    });
    return ctx.channel === "telegram"
      ? { telegramInlineKeyboard: buttons.map(b => [{ text: b.text, callback_data: b.data }]) }
      : { maxInlineButtons: buttons.map(b => [{ type: "callback", text: b.text, payload: b.data }]) };
  }
  const codeCb = receiptEntryCallback(row.id, row.handoff_version)!;
  const inviteCb = buildReceiptEntryCallback("invite", row.id, row.handoff_version)!;
  const changeCb = buildReceiptEntryCallback("change", row.id, row.handoff_version)!;
  const obsoleteCb = buildReceiptEntryCallback("void", row.id, row.handoff_version)!;
  const listCb = buildReceiptEntryCallback("list", String(listPage), 1)!;
  if (ctx.channel === "telegram") {
    return {
      telegramInlineKeyboard: [
        [{ text: "Ввести код", callback_data: codeCb }],
        [{ text: "Запросить код повторно", callback_data: inviteCb }],
        ...(withNavigation ? [
          [{ text: "Изменить получателя", callback_data: changeCb }],
          [{ text: "Закрыть как неактуальный", callback_data: obsoleteCb }],
        ] : []),
        ...(withNavigation ? [
          [{ text: "К списку", callback_data: listCb }],
          menuInlineRow(ctx) as Array<{ text: string; callback_data: string }>,
        ] : []),
      ],
    };
  }
  return {
    maxInlineButtons: [
      [{ type: "callback", text: "Ввести код", payload: codeCb }],
      [{ type: "callback", text: "Запросить код повторно", payload: inviteCb }],
      ...(withNavigation ? [
        [{ type: "callback" as const, text: "Изменить получателя", payload: changeCb }],
        [{ type: "callback" as const, text: "Закрыть как неактуальный", payload: obsoleteCb }],
      ] : []),
      ...(withNavigation ? [
        [{ type: "callback" as const, text: "К списку", payload: listCb }],
        menuInlineRow(ctx) as Array<{ type: "callback"; text: string; payload: string }>,
      ] : []),
    ],
  };
}
async function loadTransfer(client: PoolClient, id: string, partyId: string): Promise<ReceiptTransfer | null> {
  return (await client.query<ReceiptTransfer>(
    `SELECT t.*,h.display_name AS sender_name,p.display_name AS recipient_name
     FROM tt_transfers t JOIN tt_parties h ON h.id=t.holder_party_id
     LEFT JOIN tt_parties p ON p.id=t.pending_party_id
     WHERE t.id=$1 AND t.holder_party_id=$2::uuid AND t.status IN ('waiting','active','delivered')
       AND t.deleted_at IS NULL AND t.general_archived_at IS NULL
     FOR UPDATE OF t`, [id, partyId])).rows[0] ?? null;
}
/** Current holder's active choices and read-only completed tracks, never another user's list. */
export async function appendReceiptEntryChoices(
  client: PoolClient, ctx: NativeCreateContext, reply: NativeCreateReply, onlyPublicCode?: string, page = 0,
  options: { omitSelectionHint?: boolean } = {},
): Promise<NativeCreateReply> {
  const partyId = await currentParty(client, ctx);
  if (!partyId) return reply;
  const rows = (await client.query<HolderActionTransfer>(
    `SELECT * FROM tt_transfers
     WHERE holder_party_id=$1::uuid
       AND status IN ('waiting','active','delivered','completed','obsolete') AND deleted_at IS NULL AND general_archived_at IS NULL
       AND ($2::text IS NULL OR (public_code=$2 AND status NOT IN ('completed','obsolete')))
     ORDER BY CASE WHEN status IN ('completed','obsolete') THEN 1 ELSE 0 END,created_at DESC,id DESC
     LIMIT 6 OFFSET $3`, [partyId, onlyPublicCode ?? null, page * 5])).rows;
  if (!rows.length) {
    const text = `${reply.text}\n\nПока нет передач, где вы текущий или последний держатель.`;
    const menuRow = ctx.channel === "telegram"
      ? [menuInlineRow(ctx) as Array<{ text: string; callback_data: string }>]
      : [menuInlineRow(ctx) as Array<{ type: "callback"; text: string; payload: string }>];
    if (ctx.channel === "telegram") {
      return {
        ...reply,
        text,
        replyMarkup: reply.replyMarkup?.remove_keyboard === true ? reply.replyMarkup : undefined,
        telegramInlineKeyboard: menuRow as Array<Array<{ text: string; callback_data: string }>>,
        maxInlineButtons: undefined,
      };
    }
    return {
      ...reply,
      text,
      replyMarkup: undefined,
      telegramInlineKeyboard: undefined,
      maxInlineButtons: menuRow as Array<Array<{ type: "callback"; text: string; payload: string }>>,
    };
  }
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
  if (onlyPublicCode && visible.length === 1) {
    const picked = visible[0]!;
    const detail = transferDetailUi(ctx, picked, page, false);
    return { ...reply, ...detail };
  }
  const text = options.omitSelectionHint
    ? reply.text
    : `${reply.text}\n\nВыберите передачу. Для активной доступны действия; завершённую или неактуальную можно только посмотреть.`;
  const choices = visible.map(r => ({
    text: `${r.public_code} · ${r.status === "obsolete" ? "Неактуален" : r.status === "completed" ? "Завершён" : r.pending_party_id ? "Ожидает получения" : "В работе"}`,
    data: r.status === "completed" || r.status === "obsolete"
      ? buildTrackStatusCallback({ action: "view", transferId: r.id })!
      : buildReceiptEntryCallback("pick", r.id, r.handoff_version)!,
  }));
  if (ctx.channel === "telegram") {
    const listRows = choices.map(r => [{ text: r.text, callback_data: r.data }]);
    const pagingRow = paging.length ? [paging.map((p) => ({ text: p.text, callback_data: p.data }))] : [];
    const menuRow = [menuInlineRow(ctx) as Array<{ text: string; callback_data: string }>];
    return {
      ...reply,
      text,
      replyMarkup: reply.replyMarkup?.remove_keyboard === true ? reply.replyMarkup : undefined,
      telegramInlineKeyboard: [...listRows, ...pagingRow, ...menuRow],
      maxInlineButtons: undefined,
    };
  }
  const listRows = choices.map(r => [{ type: "callback" as const, text: r.text, payload: r.data }]);
  const pagingRow = paging.length
    ? [paging.map((p) => ({ type: "callback" as const, text: p.text, payload: p.data }))]
    : [];
  const menuRow = [menuInlineRow(ctx) as Array<{ type: "callback"; text: string; payload: string }>];
  return {
    ...reply,
    text,
    maxInlineButtons: [...listRows, ...pagingRow, ...menuRow],
    telegramInlineKeyboard: undefined,
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
  if (parsed.action === "pick") {
    await clearReceiptEntry(client, ctx);
    const detail = transferDetailUi(ctx, row);
    return {
      text: `${contextText(row)}\n\nВыберите действие для этой передачи.${!row.pending_party_id && !holderCompletionPermission(row).ok ? "\nВы промежуточный держатель: для завершения передайте предмет конечному получателю." : ""}`,
      ...detail,
      replyMarkup: undefined,
    };
  }
  if (parsed.action === "forward" || parsed.action === "close" || parsed.action === "change" || parsed.action === "void") {
    await clearReceiptEntry(client, ctx);
    await clearReceiptEntry(client, ctx);
    return startNativeHolderAction(client, ctx, row, parsed.action === "forward" ? "forward"
      : parsed.action === "change" ? "replace" : parsed.action === "void" ? "obsolete" : "complete");
  }
  if (!row.pending_party_id) return { text: "У этой передачи сейчас нет ожидаемого получателя. Откройте её заново в «Моих передачах»." };
  let forwardInvitationText: string | undefined;
  if (parsed.action === "invite" || parsed.action === "retry") {
    if (!row.pending_party_id) return { text: "У этой передачи сейчас нет ожидаемого получателя." };
    const invitation = await buildExternalPendingInviteMessage(client, {
      transferId: row.id, pendingPartyId: row.pending_party_id, handoffVersion: row.handoff_version,
      channel: ctx.channel, allowUserParty: true,
    });
    if (!invitation) return { text: "Не удалось подготовить приглашение. Проверьте номер получателя." };
    if (parsed.action === "retry") {
      forwardInvitationText = invitation;
    } else {
      await clearReceiptEntry(client, ctx);
      const detail = transferDetailUi(ctx, row, 0, false);
      return {
        text: `Получите код у получателя для ${row.public_code}. Перешлите ему следующее сообщение: он получит код в боте и назовёт его вам. Используйте новое сообщение вместо прежней ссылки.`,
        forwardInvitationText: invitation,
        ...(ctx.channel === "telegram"
          ? { telegramInlineKeyboard: detail.telegramInlineKeyboard }
          : { maxInlineButtons: detail.maxInlineButtons }),
      };
    }
  }
  if (parsed.action !== "code" && parsed.action !== "retry") {
    return { text: "Эта кнопка устарела. Откройте «Мои передачи» и выберите актуальную передачу." };
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
  const reply = {
    ...withCancel(ctx, row, `Дождитесь кода от получателя.\n\n${contextText(row)}\n\nКогда получатель сообщит код, отправьте его сюда: 6 цифр или сообщение с кодом целиком.\nКод действует ${Math.round(HANDOFF_CODE_TTL_MS / 60_000)} минут с момента выдачи. Если срок истёк, нажмите «Запросить код повторно» и перешлите получателю новое сообщение.\nПередача будет подтверждена только после успешной проверки.${forwardInvitationText ? "\n\nПерешлите получателю следующее сообщение, чтобы он получил новый код. Ввод кода для этой передачи остаётся открыт." : ""}`),
    ...(forwardInvitationText ? { forwardInvitationText } : {}),
  };
  return ctx.channel === "telegram" ? { ...reply, replyMarkup: removeTelegramReplyKeyboard() } : reply;
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
  return buildNativeMainMenuReply(client, ctx, {
    prefix: formatReceiptConfirmation({
      publicCode: row.public_code, itemTitle: row.item_title,
      routeFromDisplayName: row.sender_name, routeToDisplayName: row.recipient_name,
      notificationState: await buildNotificationTransferState(client, row.id),
      audience: "sender",
    }),
    lock: false,
  });
}
