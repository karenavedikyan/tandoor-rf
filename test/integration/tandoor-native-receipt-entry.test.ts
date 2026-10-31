import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import type { Express } from "express";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv, createTestUser } from "../helpers/test-db";
import { getPool, resetPoolForTests, closePool } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { hashOtp } from "../../src/tan-tracker/phone-verification";
import { requireHandoffOtpPepper, HANDOFF_CODE_MAX_VERIFY_ATTEMPTS } from "../../src/tan-tracker/otp-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { buildReceiptEntryCallback, parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";
import { tryNativeCreateMaxCallback, tryNativeCreateTelegramCallback } from "../../src/tanbot/native-create/adapters";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; id: number; chat: number; party: string; user?: string };
type Button = { text: string; payload?: string; callback_data?: string; url?: string };
type Reply = { text: string; buttons: Button[] };
let app: Express, seq = 530000, originalFetch: typeof fetch, networkCalls = 0;
const db = getIntegrationDatabaseUrl();
const code = "345678";
const p = () => getPool()!;
async function actor(channel: Channel, staff = true): Promise<Actor> {
  const id = ++seq, chat = channel === "max" ? id + 100000 : id;
  if (staff) {
    const user = await createTestUser({ databaseUrl: db, email: `receipt-${id}@test.local`,
      password: "SyntheticPass123!", fullName: "Synthetic sender", role: "admin" });
    const party = await ensurePartyForUserOnWrite(p(), user.id, "Synthetic sender", null);
    const prefix = channel === "max" ? "max" : "telegram";
    await p().query(`INSERT INTO tanbot_${prefix}_accounts(user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled)
      VALUES($1,$2,$3,TRUE)`, [user.id, String(id), String(chat)]);
    return { channel, id, chat, party: party.id, user: user.id };
  }
  const phone = `+7999${String(id).padStart(7,"0")}`;
  const party = (await p().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external','Synthetic sender',$1) RETURNING id`, [phone])).rows[0].id;
  const person = randomUUID();
  await p().query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164)
    VALUES($1,$2,'Synthetic sender',$3)`, [person, party, phone]);
  await p().query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
    VALUES($1,$2,$3,$4)`, [person, channel, String(id), String(chat)]);
  return { channel, id, chat, party };
}
async function seed(a: Actor) {
  const id = `TT-2026-${++seq}`;
  const recipient = (await p().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external','Synthetic recipient',$1) RETURNING id`, [`+7999${String(seq).padStart(7,"0")}`])).rows[0].id;
  await p().query(`INSERT INTO tt_transfers
    (id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,final_recipient_party_id)
    VALUES($1,$1,'Synthetic receipt item','waiting',$2,$2,$3,$3)`, [id, a.party, recipient]);
  await p().query(`INSERT INTO tt_handoff_codes(transfer_id,handoff_version,pending_party_id,code_hash,expires_at)
    VALUES($1,1,$2,$3,NOW()+INTERVAL '30 minutes')`, [id, recipient, hashOtp(code, requireHandoffOtpPepper())]);
  return { id, recipient, callback: buildReceiptEntryCallback("code", id, 1)! };
}
async function send(a: Actor, text = "", callback?: string, fixedId?: number): Promise<Reply> {
  const id = fixedId ?? ++seq, replies: Reply[] = [];
  if (a.channel === "telegram") {
    const message = { message_id: id, chat: { id: a.chat, type: "private" } };
    const r = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send(callback ? { update_id: id, callback_query: { id: `receipt-${id}`, from: { id: a.id, is_bot: false },
        data: callback, message } } : { update_id: id, message: { ...message, from: { id: a.id, is_bot: false }, text } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cfg = loadTanbotTelegramStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredTelegramWebhookReplies(p(), cfg.config, async input => {
      if (input.method === "sendMessage") {
        const markup = input.body.reply_markup as { inline_keyboard?: Button[][]; keyboard?: Button[][] } | undefined;
        replies.push({ text: String(input.body.text), buttons: (markup?.inline_keyboard ?? markup?.keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: id } };
    }, { deliveryEnabled: true });
  } else {
    const message = { recipient: { chat_id: a.chat, chat_type: "dialog", user_id: a.id }, body: { mid: `receipt-${id}`, text } };
    const r = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send(callback ? { update_type: "message_callback", timestamp: id, message,
        callback: { callback_id: `receipt-${id}`, payload: callback, user: { user_id: a.id, is_bot: false } } }
        : { update_type: "message_created", timestamp: id, message: { ...message, sender: { user_id: a.id, is_bot: false } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cfg = loadTanbotMaxStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredMaxWebhookReplies(p(), cfg.config, async input => {
      replies.push({ text: input.text, buttons: (input.inlineButtons ?? []).flat() });
      return { ok: true, result: {} };
    }, { deliveryEnabled: true });
  }
  return replies.at(-1) ?? { text: "", buttons: [] };
}
async function state(id: string) {
  return (await p().query(`SELECT holder_party_id,pending_party_id,handoff_version,status,
    (SELECT COUNT(*)::int FROM tt_audit_log WHERE transfer_id=$1 AND action='code_verify_ok') AS successes,
    (SELECT verify_attempt_count FROM tt_handoff_codes WHERE transfer_id=$1 ORDER BY created_at DESC LIMIT 1) AS attempts
    FROM tt_transfers WHERE id=$1`, [id])).rows[0];
}
async function entries(a: Actor) {
  return (await p().query(`SELECT * FROM tt_bot_receipt_code_entries WHERE channel=$1 AND messenger_chat_id=$2`,
    [a.channel, String(a.chat)])).rows;
}
describe("native receipt confirmation via actual MAX and Telegram webhooks", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(db, "http://127.0.0.1:3000");
    Object.assign(process.env, {
      TT_OTP_PEPPER: "synthetic-native-receipt-pepper-min16", TT_EXTERNAL_MESSENGER_ENABLED: "true",
      TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-synthetic-token-0123456789", TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_bot",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-link-pepper-min16", TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-telegram-webhook-secret-min16",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_TOKEN_0123456789abcdef", TANBOT_MAX_BOT_USERNAME: "synthetic_bot",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-max-link-pepper-min16", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-max-webhook-secret-min16",
    });
    await prepareDatabase(db); await resetPoolForTests();
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { networkCalls++; throw new Error("Real network forbidden"); };
    app = (await import("../../src/server")).createApp();
  });
  after(async () => { globalThis.fetch = originalFetch; await closePool(); assert.equal(networkCalls, 0); });
  for (const channel of ["max", "telegram"] as const) {
    for (const staff of [true, false]) {
      it(`${channel}: ${staff ? "staff" : "verified external holder"} selects exact transfer and confirms pasted receipt once`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const menu = await send(a, "Мои передачи");
        assert.ok(menu.buttons.some(b => parseReceiptEntryCallback(b.payload ?? b.callback_data ?? "")?.transferId === t.id));
        const selected = await send(a, "", t.callback);
        assert.ok(selected.text.includes(t.id)); assert.match(selected.text, /Synthetic sender/);
        assert.match(selected.text, /Synthetic recipient/);
        assert.match(selected.text, /6 цифр|сообщение с кодом/);
        assert.equal((await state(t.id)).holder_party_id, a.party);
        const waiting = (await entries(a))[0]; assert.equal(waiting.transfer_id, t.id);
        assert.ok(!JSON.stringify(waiting).includes(code), "selected state stores no raw OTP");
        const messageId = ++seq;
        const done = await send(a, `Передача ${t.id}\nКод приёма: ${code}\nОт: Synthetic sender\nКому: Synthetic recipient`, undefined, messageId);
        assert.match(done.text, /Передача подтверждена/);
        assert.match(done.text, /Статус: Получение подтверждено\nОтветственный: Synthetic recipient/);
        assert.doesNotMatch(done.text, /Статус: Завершена|Ответственный: Synthetic sender/);
        const s = await state(t.id);
        assert.equal(s.holder_party_id, t.recipient); assert.equal(s.pending_party_id, null);
        assert.equal(s.handoff_version, 2); assert.equal(s.status, "delivered"); assert.equal(s.successes, 1);
        assert.equal((await entries(a)).length, 0);
        await send(a, code, undefined, messageId); // exact webhook duplicate
        const replay = await send(a, code);
        assert.match(replay.text, /Сначала.*Мои передачи/);
        assert.equal((await state(t.id)).successes, 1);
        assert.match((await send(a, "", t.callback)).text, /устарела|недоступна/);
      });
    }
    it(`${channel}: unscoped, ambiguous and foreign-track codes never count attempts or infer a transfer`, async () => {
      const a = await actor(channel), t = await seed(a);
      assert.match((await send(a, code)).text, /Сначала.*Мои передачи/);
      assert.equal((await state(t.id)).attempts, 0);
      await send(a, "", t.callback);
      await send(a, `Передача ${t.id}`);
      assert.match((await send(a, "Код: 111111\nКод: 222222")).text, /несколько/);
      assert.match((await send(a, `Передача TT-2026-999999\nКод: ${code}`)).text, /другой трек/);
      assert.equal((await state(t.id)).attempts, 0);
      assert.equal((await state(t.id)).holder_party_id, a.party);
    });
    it(`${channel}: failed attempts COMMIT, never reset by reopening and lock code at the same LK limit`, async () => {
      const a = await actor(channel), t = await seed(a);
      for (let attempt = 1; attempt <= HANDOFF_CODE_MAX_VERIFY_ATTEMPTS; attempt++) {
        await send(a, "", t.callback);
        const reply = await send(a, "111111");
        assert.match(reply.text, attempt === HANDOFF_CODE_MAX_VERIFY_ATTEMPTS ? /Превышено/ : /Неверный код/);
        const s = await state(t.id); assert.equal(s.attempts, attempt); assert.equal(s.holder_party_id, a.party);
      }
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      assert.ok((await p().query(`SELECT consumed_at FROM tt_handoff_codes WHERE transfer_id=$1`, [t.id])).rows[0].consumed_at);
      assert.equal((await p().query(`SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='code_verify_fail'`,
        [t.id])).rows[0].n, HANDOFF_CODE_MAX_VERIFY_ATTEMPTS);
      await p().query(`INSERT INTO tt_handoff_codes(transfer_id,handoff_version,pending_party_id,code_hash,expires_at)
        VALUES($1,1,$2,$3,NOW()+INTERVAL '30 minutes')`, [t.id, t.recipient, hashOtp("456789", requireHandoffOtpPepper())]);
      assert.match((await send(a, "45-67-89")).text, /Передача подтверждена/);
      assert.equal((await state(t.id)).successes, 1);
    });
    it(`${channel}: expiry, version, recipient, deletion, archive and status changes cannot be bypassed`, async () => {
      const a = await actor(channel);
      for (const change of ["entry-expired", "code-expired", "consumed", "version", "recipient", "holder", "deleted", "archived", "status"]) {
        const t = await seed(a); await send(a, "", t.callback);
        if (change === "entry-expired") await p().query(`UPDATE tt_bot_receipt_code_entries SET expires_at=NOW()-INTERVAL '1 second' WHERE transfer_id=$1`, [t.id]);
        if (change === "code-expired") await p().query(`UPDATE tt_handoff_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE transfer_id=$1`, [t.id]);
        if (change === "consumed") await p().query(`UPDATE tt_handoff_codes SET consumed_at=NOW() WHERE transfer_id=$1`, [t.id]);
        if (change === "version") await p().query(`UPDATE tt_transfers SET handoff_version=handoff_version+1 WHERE id=$1`, [t.id]);
        if (change === "holder") await p().query(`UPDATE tt_transfers SET holder_party_id=pending_party_id WHERE id=$1`, [t.id]);
        if (change === "recipient") {
          // Even a newly issued, accidentally equal code for a replaced recipient cannot reuse the old selection.
          await p().query(`UPDATE tt_transfers SET pending_party_id=holder_party_id WHERE id=$1`, [t.id]);
          await p().query(`UPDATE tt_handoff_codes SET pending_party_id=$2 WHERE transfer_id=$1`, [t.id, a.party]);
        }
        if (change === "deleted") await p().query(`UPDATE tt_transfers SET deleted_at=NOW() WHERE id=$1`, [t.id]);
        if (change === "archived") await p().query(`UPDATE tt_transfers SET general_archived_at=NOW() WHERE id=$1`, [t.id]);
        if (change === "status") await p().query(`UPDATE tt_transfers SET status='completed' WHERE id=$1`, [t.id]);
        await send(a, code);
        const s = await state(t.id);
        assert.equal(s.holder_party_id, change === "holder" ? t.recipient : a.party, change);
        assert.equal(s.successes, 0, change);
      }
    });
    it(`${channel}: foreign actor, revoked binding, disabled user and nonprivate dialog expose no transfer data`, async () => {
      const a = await actor(channel), other = await actor(channel), t = await seed(a);
      const denied = await send(other, "", t.callback);
      assert.doesNotMatch(denied.text, /Synthetic receipt item|Synthetic sender|Synthetic recipient/);
      assert.equal((await entries(other)).length, 0);
      await send(a, "", t.callback);
      await p().query(`UPDATE users SET status='disabled' WHERE id=$1`, [a.user]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      await p().query(`UPDATE users SET status='active' WHERE id=$1`, [a.user]);
      await send(a, "", t.callback);
      const prefix = channel === "max" ? "max" : "telegram";
      await p().query(`UPDATE tanbot_${prefix}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      await p().query(`UPDATE tanbot_${prefix}_accounts SET stopped_at=NULL WHERE user_id=$1`, [a.user]);
      await send(a, "", t.callback);
      await p().query(`UPDATE tanbot_${prefix}_accounts SET ${prefix}_user_id=$2 WHERE user_id=$1`, [a.user, String(a.id + 9000000)]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      await p().query(`UPDATE tanbot_${prefix}_accounts SET ${prefix}_user_id=$2 WHERE user_id=$1`, [a.user, String(a.id)]);
      const client = await p().connect();
      try {
        await client.query("BEGIN");
        const r = channel === "max"
          ? await tryNativeCreateMaxCallback(client, { chatId: BigInt(a.chat), maxUserId: BigInt(a.id), payload: t.callback, recipientChatType: "chat" })
          : await tryNativeCreateTelegramCallback(client, { chatId: BigInt(a.chat), telegramUserId: BigInt(a.id), data: t.callback, privateDialogOk: false });
        assert.doesNotMatch(r?.text ?? "", /Synthetic receipt item|Synthetic sender|Synthetic recipient/);
        await client.query("COMMIT");
      } finally { client.release(); }
    });
    it(`${channel}: switching transfers is explicit; stale cancel cannot cancel a newer selection`, async () => {
      const a = await actor(channel), one = await seed(a), two = await seed(a);
      const first = await send(a, "", one.callback);
      const cancel = first.buttons.find(b => /Отменить ввод/.test(b.text))!;
      await send(a, "", two.callback);
      assert.match((await send(a, "", cancel.payload ?? cancel.callback_data)).text, /устарела/);
      assert.equal((await entries(a))[0].transfer_id, two.id);
      const done = await send(a, code);
      assert.match(done.text, /Передача подтверждена/);
      assert.equal((await state(two.id)).successes, 1);
      assert.equal((await state(one.id)).successes, 0);
      await send(a, "", one.callback);
      await send(a, "", two.callback); // delivered transfer: failed selection must not keep One selected
      assert.equal((await entries(a)).length, 0);
      assert.match((await send(a, code)).text, /Сначала.*Мои передачи/);
      assert.equal((await state(one.id)).successes, 0);
    });
    it(`${channel}: concurrent correct-code webhook updates produce one handoff, one success audit`, async () => {
      const a = await actor(channel), t = await seed(a);
      await send(a, "", t.callback);
      // Competing synthetic webhook requests exercise transaction locks, not external services.
      await Promise.all([send(a, code), send(a, code)]);
      const s = await state(t.id);
      assert.equal(s.successes, 1); assert.equal(s.handoff_version, 2); assert.equal(s.holder_party_id, t.recipient);
      assert.equal((await p().query(`SELECT COUNT(*)::int AS n FROM tt_transfer_timeline
        WHERE transfer_id=$1 AND note='Подтверждено одноразовым кодом'`, [t.id])).rows[0].n, 1);
    });
    it(`${channel}: removed external verification cannot reuse an active code-entry selection`, async () => {
      const a = await actor(channel, false), t = await seed(a);
      await send(a, "", t.callback);
      await p().query(`DELETE FROM tt_external_person_verifications WHERE channel=$1 AND messenger_user_id=$2`,
        [channel, String(a.id)]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      assert.equal((await state(t.id)).holder_party_id, a.party);
    });
    it(`${channel}: cancel and menu clear code selection without changing a creation draft`, async () => {
      const a = await actor(channel), t = await seed(a);
      await send(a, "Оформить передачу"); await send(a, "Unrelated unfinished item");
      const snapshot = async () => (await p().query(`SELECT id,step,payload,updated_at FROM tt_external_request_drafts
        WHERE payload->>'staffUserId'=$1`, [a.user])).rows;
      const before = await snapshot(); assert.equal(before.length, 1);
      for (const control of ["Отмена", "Меню", "/start", "Мои передачи", "/code"]) {
        await send(a, "", t.callback); await send(a, control);
        assert.equal((await entries(a)).length, 0, control);
        assert.deepEqual(await snapshot(), before, control);
      }
      assert.equal((await state(t.id)).successes, 0);
    });
    it(`${channel}: paged holder-only code choices keep older transfers accessible without a website`, async () => {
      const a = await actor(channel), other = await actor(channel);
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) ids.push((await seed(a)).id);
      const foreign = await seed(other);
      const first = await send(a, "Мои передачи");
      const choices = first.buttons.filter(b => /Ввести код/.test(b.text));
      assert.equal(choices.length, 5);
      const next = first.buttons.find(b => /Следующие передачи/.test(b.text))!;
      assert.ok(next);
      const second = await send(a, "", next.payload ?? next.callback_data);
      const rest = second.buttons.filter(b => /Ввести код/.test(b.text));
      assert.equal(rest.length, 2);
      const shown = [...choices, ...rest].map(b => parseReceiptEntryCallback(b.payload ?? b.callback_data ?? "")!.transferId);
      assert.deepEqual([...shown].sort(), ids.sort()); assert.ok(!shown.includes(foreign.id));
    });
  }
  it("MAX selection never authorizes code input in Telegram, even for the same linked staff holder", async () => {
    const max = await actor("max");
    const tg: Actor = { ...max, channel: "telegram", id: ++seq, chat: seq };
    await p().query(`INSERT INTO tanbot_telegram_accounts(user_id,telegram_user_id,telegram_chat_id,notifications_enabled)
      VALUES($1,$2,$2,TRUE)`, [max.user, String(tg.id)]);
    const one = await seed(max), two = await seed(max);
    await send(max, "", one.callback);
    assert.match((await send(tg, code)).text, /Сначала/);
    assert.equal((await state(one.id)).successes, 0);
    await send(tg, "", two.callback);
    await send(max, code); await send(tg, code);
    assert.equal((await state(one.id)).successes, 1);
    assert.equal((await state(two.id)).successes, 1);
  });
});
