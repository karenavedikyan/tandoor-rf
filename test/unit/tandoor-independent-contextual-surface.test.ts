import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { buildNativeCompactMenuReply, nativeCompletionMenuReply } from "../../src/tanbot/native-create/main-menu";
import { nativeReplyToTelegram, nativeTelegramReplyExtra } from "../../src/tanbot/native-create/adapters";
import { menuReplyKeyboard, buildStepUi } from "../../src/tanbot/native-create/keyboards";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import { mockTelegramReplyDeliveryPool } from "../helpers/mock-telegram-reply-pool";
import type { NativeCreateContext } from "../../src/tanbot/native-create/engine";
import type { TanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { withMaxMainMenuButton } from "../../src/tanbot-max/main-menu-button";
import { appendReceiptEntryChoices } from "../../src/tanbot/native-create/receipt-code-entry";
import { automaticReceiptSenderGuidance } from "../../src/tan-tracker/automatic-receipt-codes";
import { parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";

const ctx: NativeCreateContext = {
  channel: "telegram", messengerUserId: 910001n, messengerChatId: "910001",
  privateDialogOk: true, isLinkedStaff: false, staffUserId: null, personId: null,
};
const config = {
  deliveryEnabled: true, botToken: "123456789:SYNTH_COMPUTER_ONLY",
  requestTimeoutMs: 1000, maxResponseBytes: 4096,
} as TanbotTelegramStage2Config;
const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as PoolClient;

for (const channel of ["max", "telegram"] as const) {
  test(`Computer: ${channel} post-create shows exactly two transfer-bound actions and updated guidance`, async () => {
    const context = { ...ctx, channel, personId: "person" };
    const db = { query: async (sql: string) => ({
      rows: sql.includes("FROM tt_external_persons") ? [{ party_id: "25d12a69-23b4-4098-a2f9-92b4cd5e1021" }]
        : [{ id: "TT-2026-019", public_code: "TT-2026-019", handoff_version: 3 }],
    }) } as unknown as PoolClient;
    const base = await nativeCompletionMenuReply(db, context, automaticReceiptSenderGuidance("TT-2026-019"));
    const reply = await appendReceiptEntryChoices(db, context, base, "TT-2026-019");
    const buttons = channel === "max"
      ? withMaxMainMenuButton(reply.maxInlineButtons).flat()
      : reply.telegramInlineKeyboard!.flat();
    assert.deepEqual(buttons.map(b => b.text), ["Ввести код", "Получить код у получателя"]);
    const actions = buttons.map(b => parseReceiptEntryCallback("payload" in b ? b.payload : b.callback_data));
    assert.deepEqual(actions.map(a => a?.action), ["code", "invite"]);
    assert.ok(actions.every(a => a?.transferId === "TT-2026-019" && a.version === 3));
    assert.ok(reply.text.includes("нажмите «Получить код у получателя»"));
    assert.ok(!reply.text.includes("Обновить приглашение"));
    if (channel === "telegram") {
      const wire = nativeReplyToTelegram(reply);
      assert.equal(wire.replyKeyboardClear, true);
      assert.equal(wire.replyKeyboardRestore, undefined);
    }
  });
}

for (const populated of [false, true]) {
  test(`Computer: Telegram ${populated ? "populated" : "empty"} list preserves keyboard removal and only contextual buttons`, async () => {
    const db = { query: async (sql: string) => ({
      rows: sql.includes("FROM tt_external_persons") ? [{ party_id: "25d12a69-23b4-4098-a2f9-92b4cd5e1021" }]
        : populated ? [{ id: "c354b17b-f068-4c2a-9d7b-48c39e2b65c1", public_code: "TT-2026-001", handoff_version: 1 }] : [],
    }) } as unknown as PoolClient;
    const reply = await appendReceiptEntryChoices(db, { ...ctx, personId: "person" }, {
      text: "Мои передачи", replyMarkup: { remove_keyboard: true },
    });
    const packed = nativeReplyToTelegram(reply);
    assert.equal(packed.replyKeyboardClear, true);
    assert.equal(packed.replyKeyboardRestore, undefined);
    assert.ok(reply.telegramInlineKeyboard?.flat().some(b => b.text === "Меню"));
    assert.ok(!reply.telegramInlineKeyboard?.flat().some(b => b.text === "Создать передачу"));
  });
}

test("Computer: Telegram compact menu must not retain or restore home reply buttons", async () => {
  const native = await buildNativeCompactMenuReply(client, ctx, { lock: false });
  const reply = nativeReplyToTelegram(native);
  const extra = nativeTelegramReplyExtra(reply, {
    messengerChatId: ctx.messengerChatId, messengerUserId: ctx.messengerUserId.toString(),
    actor: "external", channel: "telegram",
  });
  const pool = mockTelegramReplyDeliveryPool({
    updateId: 910001, replyText: reply.text, replyExtra: extra,
  });
  let keyboard: any = menuReplyKeyboard();
  const sent: Record<string, any>[] = [];
  const transport = async (input: any) => {
    if (input.method === "sendMessage") {
      const payload = input.body;
      sent.push(payload);
      const markup = payload.reply_markup;
      if (markup?.remove_keyboard) keyboard = undefined;
      if (markup?.keyboard) keyboard = markup;
    }
    return { ok: true as const, result: {} };
  };
  await deliverTelegramWebhookReply(pool, config, transport, 910001, {
    ...reply, chatId: ctx.messengerUserId, replyExtra: extra,
  });
  const inline = sent.flatMap(p => p.reply_markup?.inline_keyboard?.flat() ?? []);
  assert.ok(inline.some(b => b.text === "Настройки"), "actual inline actions must be delivered");
  const retained = keyboard?.keyboard?.flat().map((b: any) => b.text) ?? [];
  assert.ok(!retained.includes("Создать передачу"), `home actions still visible: ${retained}`);
  assert.ok(!retained.includes("Мои передачи"), `home actions still visible: ${retained}`);
  const count = sent.length;
  await deliverTelegramWebhookReply(pool, config, transport, 910001, {
    ...reply, chatId: ctx.messengerUserId, replyExtra: extra,
  });
  assert.equal(sent.length, count, "duplicate webhook must not repeat successful keyboard or primary deliveries");
});

for (const channel of ["max", "telegram"] as const) {
  for (const kind of ["nav", "photo", "comment", "due", "recipient", "edit", "summary"] as const) {
    test(`Computer: ${channel} ${kind} has contextual actions and one menu exit`, () => {
      const ui = buildStepUi(channel, "c354b17b-f068-4c2a-9d7b-48c39e2b65c1", 7, kind, {
        editFields: [{ label: "Предмет", arg: "item" }],
      });
      const rows = channel === "max" ? withMaxMainMenuButton(ui.maxInlineButtons) : ui.telegramInlineKeyboard!;
      const labels = rows.flat().map(b => b.text);
      assert.equal(labels.filter(t => t === "Меню" || t === "Главное меню").length, 1);
      assert.ok(!labels.includes("Настройки"));
      assert.ok(!labels.includes("Мои передачи"));
      assert.ok(!labels.includes("Получить код приёма"));
      if (kind !== "summary") assert.ok(!labels.includes("Создать передачу"));
    });
  }
}
