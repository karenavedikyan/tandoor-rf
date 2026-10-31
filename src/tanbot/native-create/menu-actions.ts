import type { PoolClient } from "pg";
import type { NativeCreateContext, NativeCreateReply } from "./engine";
import { assertNativeCreateContext } from "./access-guard";
import { buildNativeCreateCallback, type NativeCreateCallbackAction } from "./callback-codec";
import { buildReceiptEntryCallback, type ReceiptEntryCallback } from "../receipt-entry-callback";
import { NATIVE_MENU_DRAFT_HEX } from "./menu-sentinel";
import { nativeVerifiedContactRequiredReply } from "./main-menu";
import { isTanbotHandoffCodePilotEnabled } from "../handoff-code-pilot-config";
import { issueHandoffCodeViaBot } from "../handoff-code-bot-service";
import { clearReceiptEntry } from "./receipt-code-entry";
import { isExternalMessengerFeatureEnabled } from "../../tan-tracker/external-messenger/config";
import {
  lockSessionByTelegramChat, lockSessionByMaxChat, assertSessionTransferStillOpen,
} from "../../tan-tracker/external-messenger/session-service";

type Binding = { notifications_enabled: boolean; party_id: string | null };
type Choice = { text: string; data: string };
function menuButton(action: NativeCreateCallbackAction, text: string, arg?: string): Choice {
  return { text, data: buildNativeCreateCallback(action, NATIVE_MENU_DRAFT_HEX, 1, arg)! };
}
function withButtons(ctx: NativeCreateContext, text: string, buttons: Choice[], copyOnlyCode?: string): NativeCreateReply {
  const rows = [...buttons, menuButton("menu", "Меню")];
  return {
    text, copyOnlyCode,
    ...(ctx.channel === "telegram"
      ? { telegramInlineKeyboard: rows.map(b => [{ text: b.text, callback_data: b.data }]) }
      : { maxInlineButtons: rows.map(b => [{ type: "callback" as const, text: b.text, payload: b.data }]) }),
  };
}
/** Resolve fresh, active caller binding, including BOTH messenger user and dialog IDs. */
async function binding(client: PoolClient, ctx: NativeCreateContext): Promise<Binding | null> {
  try { await assertNativeCreateContext(client, ctx); } catch { return null; }
  if (ctx.isLinkedStaff) {
    const table = ctx.channel === "telegram" ? "tanbot_telegram_accounts" : "tanbot_max_accounts";
    const prefix = ctx.channel === "telegram" ? "telegram" : "max";
    return (await client.query<Binding>(
      `SELECT a.notifications_enabled,p.id AS party_id FROM ${table} a
       LEFT JOIN tt_parties p ON p.user_id=a.user_id AND p.kind='user'
       WHERE a.user_id=$1::uuid AND a.${prefix}_user_id=$2 AND a.${prefix}_chat_id=$3
         AND a.stopped_at IS NULL FOR UPDATE OF a`,
      [ctx.staffUserId, ctx.messengerUserId.toString(), ctx.messengerChatId])).rows[0] ?? null;
  }
  return (await client.query<Binding>(
    `SELECT v.notifications_enabled,p.party_id FROM tt_external_person_verifications v
     JOIN tt_external_persons p ON p.id=v.person_id
     WHERE v.person_id=$1::uuid AND v.channel=$2 AND v.messenger_user_id=$3 AND v.messenger_chat_id=$4
     FOR UPDATE OF v`,
    [ctx.personId, ctx.channel, ctx.messengerUserId.toString(), ctx.messengerChatId])).rows[0] ?? null;
}
function unavailable(ctx: NativeCreateContext): NativeCreateReply {
  if (!ctx.isLinkedStaff && !ctx.personId && ctx.privateDialogOk) {
    return nativeVerifiedContactRequiredReply(ctx, "Подтвердите свой номер телефона, чтобы открыть этот раздел.");
  }
  return withButtons(ctx, "Раздел недоступен. Проверьте подключение профиля и откройте меню заново.", []);
}

/** Invitation proof is NOT a global profile. Never provision or rebind an identity from menu navigation. */
async function invitationHelp(client: PoolClient, ctx: NativeCreateContext, settings: boolean): Promise<NativeCreateReply | null> {
  if (!ctx.privateDialogOk || ctx.isLinkedStaff || ctx.personId || !isExternalMessengerFeatureEnabled()) return null;
  const session = ctx.channel === "telegram"
    ? await lockSessionByTelegramChat(client, BigInt(ctx.messengerChatId))
    : await lockSessionByMaxChat(client, BigInt(ctx.messengerChatId));
  const boundUser = session && (ctx.channel === "telegram" ? session.bound_telegram_user_id : session.bound_max_user_id);
  if (!session || !session.phone_verified_at || session.channel !== ctx.channel || boundUser !== ctx.messengerUserId.toString() ||
      session.expires_at.getTime() <= Date.now() || !(await assertSessionTransferStillOpen(client, session)).ok) return null;
  if (settings) return withButtons(ctx,
    "Настройки\n\nВаш номер подтверждён для получения по приглашению. После подтверждения приёма передачи здесь появятся настройки уведомлений вашего профиля.", []);
  const transfer = (await client.query<{ public_code: string; item_title: string }>(
    "SELECT public_code,item_title FROM tt_transfers WHERE id=$1", [session.transfer_id])).rows[0];
  if (!transfer) return null;
  return withButtons(ctx,
    `Код приёма · ${transfer.public_code}\n${transfer.item_title.replace(/\s+/g, " ").slice(0, 200)}\n\n` +
    (session.code_issued_at
      ? "Код уже запрашивался в этом чате после подтверждения номера. Найдите сообщение с шестью цифрами и сообщите код отправителю.\n\nЕсли сообщения нет или код истёк, попросите отправителя обновить приглашение."
      : "Вернитесь к исходному приглашению и подтвердите свой номер кнопкой в сообщении бота, чтобы получить код."),
    []);
}

/** Notifications are a preference, NOT /stop: do not revoke sessions or disconnect the account. */
export async function settingsReply(
  client: PoolClient, ctx: NativeCreateContext, action = "menu_settings",
): Promise<NativeCreateReply> {
  const current = await binding(client, ctx);
  if (!current) return await invitationHelp(client, ctx, true) ?? unavailable(ctx);
  if (action === "notify_ask_off") {
    return withButtons(ctx,
      "Отключить уведомления?\n\nНовые сообщения о передачах перестанут приходить в этот бот. Вы сможете пользоваться меню и включить уведомления обратно в настройках.",
      [menuButton("notify_off", "Да, отключить уведомления"), menuButton("menu_settings", "Оставить как есть")]);
  }
  let prefix = "";
  if (action === "notify_off" || action === "notify_on") {
    const enabled = action === "notify_on";
    if (ctx.isLinkedStaff) {
      const table = ctx.channel === "telegram" ? "tanbot_telegram_accounts" : "tanbot_max_accounts";
      const column = ctx.channel === "telegram" ? "telegram" : "max";
      await client.query(
        `UPDATE ${table} SET notifications_enabled=$4 WHERE user_id=$1::uuid
         AND ${column}_user_id=$2 AND ${column}_chat_id=$3 AND stopped_at IS NULL`,
        [ctx.staffUserId, ctx.messengerUserId.toString(), ctx.messengerChatId, enabled]);
    } else {
      await client.query(
        `UPDATE tt_external_person_verifications SET notifications_enabled=$5,
           opted_out_at=CASE WHEN $5 THEN NULL ELSE NOW() END
         WHERE person_id=$1::uuid AND channel=$2 AND messenger_user_id=$3 AND messenger_chat_id=$4`,
        [ctx.personId, ctx.channel, ctx.messengerUserId.toString(), ctx.messengerChatId, enabled]);
    }
    current.notifications_enabled = enabled;
    prefix = enabled ? "Уведомления включены.\n\n" : "Уведомления отключены. Подключение к боту сохранено.\n\n";
  }
  return withButtons(ctx,
    `${prefix}Настройки\n\nПрофиль: ${ctx.isLinkedStaff ? "сотрудник Тандор" : "номер подтверждён"}.\n` +
    `Уведомления: ${current.notifications_enabled ? "включены" : "выключены"}.\n\n` +
    "Как работает передача\nПолучатель получает код приёма и сообщает его отправителю. Отправитель выбирает передачу, нажимает «Ввести код» и дожидается подтверждения. Только после этого передаёт посылку.",
    [current.notifications_enabled
      ? menuButton("notify_ask_off", "Отключить уведомления")
      : menuButton("notify_on", "Включить уведомления")]);
}

/** Listing never generates an OTP. Issuance requires an explicit, version-bound recipient choice. */
export async function receiveCodeReply(
  client: PoolClient, ctx: NativeCreateContext, selection?: ReceiptEntryCallback, page = 0,
): Promise<NativeCreateReply> {
  const current = await binding(client, ctx);
  if (!current) return await invitationHelp(client, ctx, false) ?? unavailable(ctx);
  await clearReceiptEntry(client, ctx);
  if (!isTanbotHandoffCodePilotEnabled()) {
    return withButtons(ctx, "Получение кодов в боте временно недоступно.", []);
  }
  if (!current.party_id) return withButtons(ctx, "Пока нет передач, ожидающих вашего приёма.", []);
  if (selection) {
    const transfer = (await client.query<{ public_code: string; handoff_version: number }>(
      `SELECT public_code,handoff_version FROM tt_transfers
       WHERE id=$1 AND pending_party_id=$2::uuid AND status IN ('waiting','active')
         AND deleted_at IS NULL AND general_archived_at IS NULL FOR UPDATE`,
      [selection.transferId, current.party_id])).rows[0];
    if (!transfer || transfer.handoff_version !== selection.version) {
      return withButtons(ctx, "Эта кнопка устарела или передача уже недоступна. Откройте актуальный список.",
        [menuButton("menu_receive", "Получить код приёма")]);
    }
    const issued = await issueHandoffCodeViaBot(client, {
      channel: ctx.channel, userId: ctx.isLinkedStaff ? ctx.staffUserId : null,
      partyId: current.party_id, transferPublicCode: transfer.public_code, expectedHandoffVersion: selection.version,
    });
    return withButtons(ctx, issued.message, [], issued.ok ? issued.code : undefined);
  }
  const rows = (await client.query<{ id: string; public_code: string; item_title: string; handoff_version: number }>(
    `SELECT id,public_code,item_title,handoff_version FROM tt_transfers
     WHERE pending_party_id=$1::uuid AND status IN ('waiting','active')
       AND deleted_at IS NULL AND general_archived_at IS NULL
     ORDER BY created_at DESC,id DESC LIMIT 6 OFFSET $2`, [current.party_id, page * 5])).rows;
  const buttons = rows.slice(0, 5).flatMap(row => {
    const data = buildReceiptEntryCallback("receive", row.id, row.handoff_version);
    return data ? [{ text: `Получить код · ${row.public_code}`, data }] : [];
  });
  if (page > 0) buttons.push(menuButton("menu_receive", "Назад к предыдущим передачам", String(page - 1)));
  if (rows.length > 5 && page < 99999) buttons.push(menuButton("menu_receive", "Следующие передачи", String(page + 1)));
  const text = rows.length
    ? "Получить код приёма\n\nВыберите входящую передачу. Код сообщите отправителю перед получением посылки.\n\n" +
      rows.slice(0, 5).map(r => `${r.public_code} · ${r.item_title.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")
    : "Пока нет передач, ожидающих вашего приёма. Когда вас укажут получателем, передача появится здесь.";
  return withButtons(ctx, text, buttons);
}
