import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import type { Express } from "express";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv, createTestUser } from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { getPool, resetPoolForTests, closePool } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { hashOtp } from "../../src/tan-tracker/phone-verification";
import { requireHandoffOtpPepper, HANDOFF_CODE_MAX_VERIFY_ATTEMPTS } from "../../src/tan-tracker/otp-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { buildReceiptEntryCallback, parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";
import { buildTrackStatusCallback } from "../../src/tanbot/track-status-callback";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../../src/tanbot/native-create/menu-sentinel";
import { trackStatusReply } from "../../src/tanbot/native-create/track-status";
import { withTransaction } from "../../src/access/db";
import { TELEGRAM_KEYBOARD_AUX_TEXT } from "../../src/tanbot/native-create/telegram-reply-markup";
import { tryNativeCreateMaxCallback, tryNativeCreateTelegramCallback } from "../../src/tanbot/native-create/adapters";
import { mintExternalMessengerSession, bindSessionMessengerChat, type ExternalMessengerSessionRow } from "../../src/tan-tracker/external-messenger/session-service";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; id: number; chat: number; party: string; user?: string };
type Button = { text: string; payload?: string; callback_data?: string; url?: string };
type Reply = { text: string; buttons: Button[]; messages?: Reply[] };
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
  return {
    id,
    recipient,
    pick: buildReceiptEntryCallback("pick", id, 1)!,
    callback: buildReceiptEntryCallback("code", id, 1)!,
  };
}
async function seedReceived(a: Actor, finalHolder = true) {
  const t = await seed(a);
  await p().query(`UPDATE tt_transfers SET creator_party_id=$2, pending_party_id=NULL,
    final_recipient_party_id=$3, status='delivered', first_custody_at=NOW() WHERE id=$1`,
    [t.id, t.recipient, finalHolder ? a.party : t.recipient]);
  return t;
}
function button(reply: Reply, text: string): string {
  const b = reply.buttons.find(b => b.text === text);
  assert.ok(b, `Missing ${text}: ${JSON.stringify(reply)}`);
  return b.payload ?? b.callback_data!;
}
async function selectForwardRecipient(a: Actor, initial: Reply) {
  assert.match(initial.text, /Передать дальше/);
  const phone = `+7988${String(++seq).padStart(7, "0")}`;
  let reply = await send(a, phone);
  for (let i = 0; i < 4 && !reply.buttons.some(b => b.text === "Передать дальше"); i++) {
    const next = reply.buttons.find(b => b.text === "Далее");
    reply = next ? await send(a, "", next.payload ?? next.callback_data)
      : await send(a, "Synthetic next recipient");
  }
  assert.match(reply.text, /Продолжится этот же трек/);
  assert.doesNotMatch(reply.text, /Создать передачу|Выберите срок/);
  return { summary: reply, phone };
}
async function pickTransferAndEnterCode(a: Actor, t: { id: string; pick: string }): Promise<Reply> {
  const menu = await send(a, "Мои передачи");
  assert.ok(menu.buttons.some(b => (b.payload ?? b.callback_data) === t.pick));
  const detail = await send(a, "", t.pick);
  assert.match(detail.text, new RegExp(t.id));
  assert.equal((await entries(a)).length, 0, "pick must not create receipt code entry");
  const codeBtn = detail.buttons.find(b => /Ввести код/u.test(b.text));
  assert.ok(codeBtn, JSON.stringify(detail));
  return send(a, "", codeBtn!.payload ?? codeBtn!.callback_data!);
}
async function send(a: Actor, text = "", callback?: string, fixedId?: number, privateDialog = true): Promise<Reply> {
  const id = fixedId ?? ++seq, replies: Reply[] = [];
  if (a.channel === "telegram") {
    const message = { message_id: id, chat: { id: a.chat, type: privateDialog ? "private" : "group" } };
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
    const message = { recipient: { chat_id: a.chat, chat_type: privateDialog ? "dialog" : "chat", user_id: a.id }, body: { mid: `receipt-${id}`, text } };
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
  const visible =
    a.channel === "telegram"
      ? replies.filter(r => r.text !== TELEGRAM_KEYBOARD_AUX_TEXT)
      : replies;
  return { ...(visible.at(-1) ?? { text: "", buttons: [] }), messages: visible };
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
const statusView = (id: string) => buildTrackStatusCallback({ action: "view", transferId: id })!;
async function statusBusinessSnapshot(id: string) {
  return (await p().query(`SELECT jsonb_build_object(
    'transfer',(SELECT to_jsonb(t) FROM tt_transfers t WHERE id=$1),
    'codes',(SELECT count(*) FROM tt_handoff_codes WHERE transfer_id=$1),
    'automatic',(SELECT count(*) FROM tt_automatic_receipt_codes WHERE transfer_id=$1),
    'invitations',(SELECT count(*) FROM tt_transfer_invitations WHERE transfer_id=$1),
    'timeline',(SELECT count(*) FROM tt_transfer_timeline WHERE transfer_id=$1),
    'audit',(SELECT count(*) FROM tt_audit_log WHERE transfer_id=$1),
    'drafts',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM tt_external_request_drafts d),
    'externalOutbox',(SELECT count(*) FROM tt_external_person_message_outbox)
  ) AS snapshot`, [id])).rows[0].snapshot;
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
      it(`${channel}: ${staff ? "staff" : "external"} status is fresh, read-only and follows the holder only after OTP`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=$1", [a.user]);
        const before = await statusBusinessSnapshot(t.id);
        const list = await send(a, "", buildNativeCreateCallback("menu_status", NATIVE_MENU_DRAFT_HEX, 1)!);
        assert.ok(list.buttons.some(b => (b.payload ?? b.callback_data) === statusView(t.id)));
        const card = await send(a, "", statusView(t.id));
        assert.match(card.text, /Текущий держатель: Synthetic sender/);
        assert.match(card.text, /Следующий получатель: Synthetic recipient/);
        assert.match(card.text, /Ожидает подтверждения получения/);
        assert.doesNotMatch(card.text, /Телефон|\+7999|345678|tt_hat=|est=/);
        const search = await send(a, `Статус ${t.id}`);
        assert.match(search.text, /Текущий держатель: Synthetic sender/);
        assert.deepEqual(await statusBusinessSnapshot(t.id), before);
        await pickTransferAndEnterCode(a, t);
        await send(a, code);
        const afterOtp = await statusBusinessSnapshot(t.id);
        const refreshed = await send(a, "", button(card, "Обновить статус"));
        assert.match(refreshed.text, /Текущий держатель: Synthetic recipient/);
        assert.match(refreshed.text, /Получение подтверждено. Трек открыт/);
        assert.doesNotMatch(refreshed.text, /Следующий получатель|Статус: Завершён/);
        assert.deepEqual(await statusBusinessSnapshot(t.id), afterOtp);
      });
      it(`${channel}: ${staff ? "staff" : "external"} status rechecks visibility, deletion, private chat and live profile binding`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=ANY($1::uuid[])", [[a.user, foreign.user]]);
        const t = await seed(a), other = await seed(foreign);
        const absent = await send(a, "", statusView("TT-2026-999999999999"));
        const denied = await send(a, "", statusView(other.id));
        assert.equal(denied.text, absent.text);
        assert.doesNotMatch(denied.text, new RegExp(other.id));
        const group = await send(a, "", statusView(t.id), undefined, false);
        assert.doesNotMatch(group.text, /Текущий держатель|Synthetic sender/);
        await p().query("UPDATE tt_transfers SET creator_party_id=$2,holder_party_id=$2,pending_party_id=NULL,final_recipient_party_id=$2 WHERE id=$1", [t.id, foreign.party]);
        assert.equal((await send(a, "", statusView(t.id))).text, absent.text);
        const deleted = await seed(a);
        await p().query("UPDATE tt_transfers SET deleted_at=NOW() WHERE id=$1", [deleted.id]);
        assert.equal((await send(a, `Статус ${deleted.id}`)).text, absent.text);
        const bound = await seed(a);
        if (staff) await p().query(`UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
        else await p().query(`DELETE FROM tt_external_person_verifications WHERE person_id=(SELECT id FROM tt_external_persons WHERE party_id=$1)`, [a.party]);
        const revoked = await send(a, "", statusView(bound.id));
        assert.doesNotMatch(revoked.text, /Текущий держатель|Synthetic sender/);
      });
      it(`${channel}: ${staff ? "staff" : "external"} status respects canonical historical-only visibility`, async () => {
        const a = await actor(channel, staff), owner = await actor(channel, false), t = await seed(owner);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=$1", [a.user]);
        await p().query(`INSERT INTO tt_transfer_timeline(transfer_id,from_party_id,to_party_id,note)
          VALUES($1,$2,$3,'Назначен следующий получатель')`, [t.id, a.party, owner.party]);
        const auditOnly = await send(a, "", statusView(t.id));
        assert.match(auditOnly.text, /не найден или недоступен/);
        await p().query(`UPDATE tt_transfer_timeline SET note='Получение подтверждено' WHERE transfer_id=$1`, [t.id]);
        const historical = await send(a, "", statusView(t.id));
        if (staff) assert.match(historical.text, /Текущий держатель: Synthetic sender/);
        else assert.match(historical.text, /не найден или недоступен/);
      });
      it(`${channel}: ${staff ? "staff" : "external"} status handles completion/archive, pending/final access, paging, drafts and code-input navigation`, async () => {
        const a = await actor(channel, staff), owner = await actor(channel, false);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=$1", [a.user]);
        for (const column of ["pending_party_id", "final_recipient_party_id"]) {
          const t = await seed(owner);
          await p().query(`UPDATE tt_transfers SET ${column}=$2 WHERE id=$1`, [t.id, a.party]);
          assert.match((await send(a, "", statusView(t.id))).text, /Текущий держатель: Synthetic sender/);
        }
        const t = await seed(a);
        await p().query("UPDATE tt_transfers SET status='completed',pending_party_id=NULL,completed_at=NOW(),general_archived_at=NOW() WHERE id=$1", [t.id]);
        const completed = await send(a, "", statusView(t.id));
        assert.match(completed.text, /Статус: Завершён/);
        assert.match(completed.text, /Последний держатель: Synthetic sender/);
        assert.match(completed.text, /в общем архиве/);
        const ready = await seed(a);
        await p().query("UPDATE tt_transfers SET pending_party_id=NULL,status='active' WHERE id=$1", [ready.id]);
        assert.match((await send(a, "", statusView(ready.id))).text, /Первое получение пока не подтверждено/);
        for (let i = 0; i < 6; i++) await seed(a);
        const first = await send(a, "Статус трека");
        const next = await send(a, "", button(first, "Следующие"));
        assert.match(next.text, /Страница 2 из/);
        assert.ok(next.buttons.some(b => b.text === "Предыдущие"));
        await send(a, "Создать передачу");
        const before = await statusBusinessSnapshot(t.id);
        await send(a, `Статус ${t.id}`);
        assert.deepEqual(await statusBusinessSnapshot(t.id), before, "read must preserve a creation draft");
        const waiting = await seed(a);
        await send(a, "", waiting.callback);
        const beforeRead = await statusBusinessSnapshot(waiting.id);
        await send(a, `Статус ${waiting.id}`);
        assert.equal((await entries(a)).length, 0);
        assert.deepEqual(await statusBusinessSnapshot(waiting.id), beforeRead, "status navigation must not attempt OTP verification");
      });
      it(`${channel}: ${staff ? "staff" : "external"} received track is listed, forwarded without duplication, and custody changes only by OTP`, async () => {
        const a = await actor(channel, staff), t = await seedReceived(a);
        const count = (await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n;
        const list = await send(a, "Мои передачи");
        assert.ok(list.buttons.some(b => (b.payload ?? b.callback_data) === t.pick));
        const detail = await send(a, "", t.pick);
        assert.ok(detail.buttons.some(b => b.text === "Передать дальше"));
        assert.ok(detail.buttons.some(b => b.text === "Завершить трек"));
        assert.ok(!detail.buttons.some(b => b.text === "Ввести код"));
        const start = await send(a, "", button(detail, "Передать дальше"));
        const { summary, phone } = await selectForwardRecipient(a, start);
        assert.equal((await state(t.id)).pending_party_id, null);
        const confirm = button(summary, "Передать дальше");
        const attempts = await Promise.all([send(a, "", confirm), send(a, "", confirm)]);
        const done = attempts.find(r => /назначен следующий получатель/.test(r.messages?.[0]?.text ?? r.text))!;
        assert.ok(done, "one concurrent confirmation succeeds");
        assert.match(done.messages?.[0]?.text ?? done.text, /назначен следующий получатель/);
        const pending = await state(t.id);
        assert.equal(pending.holder_party_id, a.party);
        assert.ok(pending.pending_party_id);
        assert.equal(pending.handoff_version, 2);
        assert.equal(pending.status, "waiting");
        assert.equal((await p().query("SELECT phone_e164 FROM tt_parties WHERE id=$1",
          [pending.pending_party_id])).rows[0].phone_e164, phone);
        assert.equal((await p().query("SELECT final_recipient_party_id FROM tt_transfers WHERE id=$1",
          [t.id])).rows[0].final_recipient_party_id, a.party);
        await send(a, "", confirm);
        assert.equal((await state(t.id)).handoff_version, 2, "confirmation replay is inert");
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n, count);
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='holder_pending_change'",
          [t.id])).rows[0].n, 1);
        await p().query(`INSERT INTO tt_handoff_codes(transfer_id,handoff_version,pending_party_id,code_hash,expires_at)
          VALUES($1,2,$2,$3,NOW()+INTERVAL '10 minutes')`, [t.id, pending.pending_party_id, hashOtp(code, requireHandoffOtpPepper())]);
        await send(a, "", buildReceiptEntryCallback("code", t.id, 2)!);
        await send(a, code);
        assert.equal((await state(t.id)).holder_party_id, pending.pending_party_id);
        assert.notEqual((await state(t.id)).status, "completed");
        assert.match((await send(a, "", buildReceiptEntryCallback("close", t.id, 3)!)).text, /недоступна|устарела/);
      });
      it(`${channel}: ${staff ? "staff" : "external"} completion requires a bound confirmation, cancellation/replay are safe`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seedReceived(a);
        const close = buildReceiptEntryCallback("close", t.id, 1)!;
        assert.match((await send(foreign, "", close)).text, /недоступна|устарела/);
        let prompt = await send(a, "", close);
        assert.match(prompt.text, /Подтвердите, что задача выполнена/);
        assert.equal((await state(t.id)).status, "delivered", "opening prompt must not close");
        const cancelledConfirm = button(prompt, "Да, завершить трек");
        await send(a, "", button(prompt, "Отмена"));
        await send(a, "", cancelledConfirm);
        assert.equal((await state(t.id)).status, "delivered");
        prompt = await send(a, "", close);
        const confirm = button(prompt, "Да, завершить трек");
        await send(foreign, "", confirm);
        assert.equal((await state(t.id)).status, "delivered", "foreign confirmation is inert");
        const attempts = await Promise.all([send(a, "", confirm), send(a, "", confirm)]);
        const result = attempts.find(r => /Трек .* завершён/.test(r.text))!;
        assert.ok(result, "one concurrent confirmation succeeds");
        assert.match(result.text, /Трек .* завершён/);
        assert.equal((await state(t.id)).status, "completed");
        await send(a, "", confirm);
        await send(a, "", close);
        const audits = await p().query("SELECT actor_user_id,acting_party_id FROM tt_audit_log WHERE transfer_id=$1 AND action='legacy_complete'", [t.id]);
        assert.equal(audits.rowCount, 1);
        assert.equal(audits.rows[0].acting_party_id, a.party);
        assert.equal(audits.rows[0].actor_user_id, a.user ?? null);
        assert.ok(!(await send(a, "Мои передачи")).buttons.some(b => (b.payload ?? b.callback_data) === t.pick));
      });
      it(`${channel}: ${staff ? "staff" : "external"} intermediate holder cannot close; pending/archived/deleted/stale actions are inert`, async () => {
        const a = await actor(channel, staff), intermediate = await seedReceived(a, false);
        const detail = await send(a, "", intermediate.pick);
        assert.ok(!detail.buttons.some(b => b.text === "Завершить трек"));
        assert.match((await send(a, "", buildReceiptEntryCallback("close", intermediate.id, 1)!)).text, /Промежуточный держатель/);
        for (const update of [
          "general_archived_at=NOW()", "deleted_at=NOW()", "handoff_version=2",
          "holder_party_id=creator_party_id", "pending_party_id=creator_party_id,status='waiting'",
          "status='completed'", "row_version=row_version+1",
        ]) {
          const t = await seedReceived(a);
          const prompt = await send(a, "", buildReceiptEntryCallback("close", t.id, 1)!);
          const confirm = button(prompt, "Да, завершить трек");
          await p().query(`UPDATE tt_transfers SET ${update} WHERE id=$1`, [t.id]);
          await send(a, "", confirm);
          assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='legacy_complete'", [t.id])).rows[0].n, 0);
          await send(a, "", button(prompt, "Отмена"));
        }
      });
      it(`${channel}: ${staff ? "staff" : "external"} forwarding preserves an existing draft and rejects stale confirmation`, async () => {
        const a = await actor(channel, staff), t = await seedReceived(a);
        await send(a, "Создать передачу");
        const drafts = await p().query("SELECT id,payload FROM tt_external_request_drafts WHERE confirmed_transfer_id IS NULL ORDER BY created_at DESC LIMIT 1");
        const denied = await send(a, "", buildReceiptEntryCallback("forward", t.id, 1)!);
        assert.match(denied.text, /незаконченный черновик/);
        assert.deepEqual((await p().query("SELECT id,payload FROM tt_external_request_drafts WHERE id=$1", [drafts.rows[0].id])).rows, drafts.rows);
        await p().query("DELETE FROM tt_external_request_drafts WHERE id=$1", [drafts.rows[0].id]);
        const start = await send(a, "", buildReceiptEntryCallback("forward", t.id, 1)!);
        const { summary } = await selectForwardRecipient(a, start);
        await p().query("UPDATE tt_transfers SET row_version=row_version+1 WHERE id=$1", [t.id]);
        await send(a, "", button(summary, "Передать дальше"));
        assert.equal((await state(t.id)).pending_party_id, null);
        assert.equal((await state(t.id)).holder_party_id, a.party);
      });
      it(`${channel}: ${staff ? "staff" : "external"} forward callback and confirmation cannot bypass privacy, identity or current custody`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seedReceived(a);
        const forward = buildReceiptEntryCallback("forward", t.id, 1)!;
        await send(foreign, "", forward);
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_external_request_drafts WHERE payload->'holderAction'->>'transferId'=$1", [t.id])).rows[0].n, 0);
        const start = await send(a, "", forward);
        const { summary } = await selectForwardRecipient(a, start);
        await send(foreign, "", button(summary, "Передать дальше"));
        assert.equal((await state(t.id)).pending_party_id, null);
        await send(a, "", button(summary, "Передать дальше"), { privateDialog: false });
        assert.equal((await state(t.id)).pending_party_id, null);
        await send(a, "", button(summary, "Отмена"));
        for (const update of [
          "general_archived_at=NOW()", "deleted_at=NOW()", "handoff_version=2",
          "holder_party_id=creator_party_id", "pending_party_id=creator_party_id,status='waiting'", "status='completed'",
        ]) {
          const stale = await seedReceived(a);
          const prompt = await send(a, "", buildReceiptEntryCallback("forward", stale.id, 1)!);
          const { summary: saved } = await selectForwardRecipient(a, prompt);
          await p().query(`UPDATE tt_transfers SET ${update} WHERE id=$1`, [stale.id]);
          await send(a, "", button(saved, "Передать дальше"));
          assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='holder_pending_change'", [stale.id])).rows[0].n, 0);
          await send(a, "", button(saved, "Отмена"));
        }
        const bound = await seedReceived(a);
        const { summary: saved } = await selectForwardRecipient(a,
          await send(a, "", buildReceiptEntryCallback("forward", bound.id, 1)!));
        if (staff) {
          const table = channel === "max" ? "tanbot_max_accounts" : "tanbot_telegram_accounts";
          await p().query(`UPDATE ${table} SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
        } else {
          await p().query(`DELETE FROM tt_external_person_verifications
            WHERE person_id=(SELECT id FROM tt_external_persons WHERE party_id=$1)`, [a.party]);
        }
        await send(a, "", button(saved, "Передать дальше"));
        assert.equal((await state(bound.id)).pending_party_id, null);
      });
      if (!staff) it(`${channel}: external forwards to an existing staff participant by phone without widening holder permissions`, async () => {
        const a = await actor(channel, false), creator = await actor(channel, true), other = await actor(channel, true);
        const t = await seedReceived(a);
        const creatorPhone = `+7977${String(++seq).padStart(7, "0")}`;
        const otherPhone = `+7977${String(++seq).padStart(7, "0")}`;
        await p().query("UPDATE users SET phone=$2 WHERE id=$1", [creator.user, creatorPhone]);
        await p().query("UPDATE users SET phone=$2 WHERE id=$1", [other.user, otherPhone]);
        await p().query("UPDATE tt_transfers SET creator_party_id=$2 WHERE id=$1", [t.id, creator.party]);
        let start = await send(a, "", buildReceiptEntryCallback("forward", t.id, 1)!);
        assert.match(start.text, /Передать дальше/);
        let reply = await send(a, otherPhone);
        reply = await send(a, "Synthetic other");
        await send(a, "", button(reply, "Передать дальше"));
        assert.equal((await state(t.id)).pending_party_id, null, "unknown staff on staff-created route remains forbidden");
        await send(a, "", button(reply, "Отмена"));
        start = await send(a, "", buildReceiptEntryCallback("forward", t.id, 1)!);
        reply = await send(a, creatorPhone);
        reply = await send(a, "Synthetic creator");
        await send(a, "", button(reply, "Передать дальше"));
        assert.equal((await state(t.id)).pending_party_id, creator.party);
        assert.equal((await state(t.id)).holder_party_id, a.party);
      });
      it(`${channel}: ${staff ? "staff" : "external"} holder refreshes invitation without creating a new track; foreign and stale callbacks cannot`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seed(a);
        const other = await seed(a);
        await send(a, "", other.callback);
        const callback = buildReceiptEntryCallback("invite", t.id, 1)!;
        const before = (await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n;
        const event = ++seq;
        const response = await send(a, "", callback, event);
        assert.match(response.text, /Получить код в MAX/);
        assert.match(response.text, /Получить код в Telegram/);
        assert.doesNotMatch(response.text, /\/tan-tracker\/recipient/);
        assert.equal((await p().query(`SELECT * FROM tt_bot_receipt_code_entries
          WHERE channel=$1 AND messenger_chat_id=$2`, [channel, String(a.chat)])).rowCount, 0);
        assert.ok(response.messages?.[0]?.buttons.some(b => (b.callback_data ?? b.payload) === t.callback));
        const sessions = () => p().query("SELECT id,superseded_at FROM tt_external_messenger_sessions WHERE transfer_id=$1", [t.id]);
        assert.equal((await sessions()).rowCount, 1);
        await send(a, "", callback, event);
        assert.equal((await sessions()).rowCount, 1, "webhook retry must not mint a second invitation");
        await send(a, "", callback);
        assert.equal((await sessions()).rowCount, 2);
        assert.equal((await sessions()).rows.filter(r => !r.superseded_at).length, 1);
        const rejected = await send(foreign, "", callback);
        assert.match(rejected.text, /устарела|недоступна/);
        assert.equal((await sessions()).rowCount, 2);
        await p().query("UPDATE tt_transfers SET handoff_version=2 WHERE id=$1", [t.id]);
        assert.match((await send(a, "", callback)).text, /устарела/);
        assert.equal((await sessions()).rowCount, 2);
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n, before);
        assert.equal((await p().query("SELECT consumed_at FROM tt_handoff_codes WHERE transfer_id=$1", [t.id])).rows[0].consumed_at, null);
      });
      it(`${channel}: ${staff ? "staff" : "external"} retries expired code without leaving input or confirming custody`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seed(a);
        const first = await send(a, "", t.callback);
        const retry = first.buttons.find(b => b.text === "Запросить код повторно")!;
        const callback = retry.payload ?? retry.callback_data;
        assert.ok(callback);
        await p().query(`UPDATE tt_handoff_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE transfer_id=$1`, [t.id]);
        const expired = await send(a, code);
        assert.match(expired.text, /Срок кода истёк/);
        assert.ok(expired.buttons.some(b => (b.payload ?? b.callback_data) === callback));
        assert.doesNotMatch(expired.text, /ГОТОВО ✅/);
        const event = ++seq;
        const response = await send(a, "", callback, event);
        assert.match(response.messages![0].text, /^Дождитесь кода от получателя\./);
        assert.deepEqual(response.messages![0].buttons.map(b => b.text), ["Запросить код повторно", "Отменить ввод кода"]);
        assert.match(response.messages![0].text, /Перешлите получателю следующее сообщение/);
        assert.match(response.text, /Получить код в MAX|Получить код в Telegram/);
        assert.equal((await entries(a))[0].transfer_id, t.id, "input stays on this transfer");
        const sessions = () => p().query(`SELECT id FROM tt_external_messenger_sessions WHERE transfer_id=$1`, [t.id]);
        assert.equal((await sessions()).rowCount, 1);
        await send(a, "", callback, event);
        assert.equal((await sessions()).rowCount, 1, "duplicate webhook cannot mint twice");
        assert.match((await send(foreign, "", callback)).text, /устарела|недоступна/);
        assert.equal((await sessions()).rowCount, 1);
        const after = await state(t.id);
        assert.equal(after.holder_party_id, a.party);
        assert.equal(after.successes, 0);
        assert.equal((await p().query(`SELECT COUNT(*)::int AS n FROM tt_handoff_codes WHERE transfer_id=$1 AND consumed_at IS NULL`, [t.id])).rows[0].n, 0, "sender retry does not issue OTP");
        await p().query(`UPDATE tt_transfers SET handoff_version=2 WHERE id=$1`, [t.id]);
        assert.match((await send(a, "", callback)).text, /устарела/);
        assert.equal((await sessions()).rowCount, 1);
      });
      it(`${channel}: ${staff ? "staff" : "verified external holder"} list pick code OTP confirms once`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const selected = await pickTransferAndEnterCode(a, t);
        assert.ok(selected.text.includes(t.id)); assert.match(selected.text, /Synthetic sender/);
        assert.match(selected.text, /Synthetic recipient/);
        assert.match(selected.text, /^Дождитесь кода от получателя\./);
        assert.deepEqual(selected.buttons.map(b => b.text), ["Запросить код повторно", "Отменить ввод кода"]);
        assert.match(selected.text, /6 цифр|сообщение с кодом/);
        assert.equal((await state(t.id)).holder_party_id, a.party);
        const waiting = (await entries(a))[0]; assert.equal(waiting.transfer_id, t.id);
        assert.ok(!JSON.stringify(waiting).includes(code), "selected state stores no raw OTP");
        const messageId = ++seq;
        const done = await send(a, `Передача ${t.id}\nКод приёма: ${code}\nОт: Synthetic sender\nКому: Synthetic recipient`, undefined, messageId);
        assert.match(done.text, /^ГОТОВО ✅\n\nВы передали/);
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
        await pickTransferAndEnterCode(a, t);
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
      assert.match((await send(a, "45-67-89")).text, /^ГОТОВО ✅\n\nВы передали/);
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
      assert.match(done.text, /^ГОТОВО ✅\n\nВы передали/);
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
    it(`${channel}: sender can enter the issued OTP after the invite is opened in another bot`, async () => {
      const a = await actor(channel), t = await seed(a);
      await send(a, "", t.callback);
      const previous = process.env.TT_EXTERNAL_MESSENGER_ENABLED;
      process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
      const client = await p().connect();
      try {
        await client.query("BEGIN");
        const minted = await mintExternalMessengerSession(client, {
          transferId: t.id, pendingPartyId: t.recipient, handoffVersion: 1,
        });
        assert.ok(minted);
        const session = (await client.query<ExternalMessengerSessionRow>(
          "SELECT * FROM tt_external_messenger_sessions WHERE id=$1::uuid", [minted.sessionId],
        )).rows[0];
        await bindSessionMessengerChat(client, session, channel === "max" ? "telegram" : "max", BigInt(++seq), BigInt(seq));
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally {
        client.release();
        if (previous === undefined) delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
        else process.env.TT_EXTERNAL_MESSENGER_ENABLED = previous;
      }
      const done = await send(a, code);
      assert.match(done.text, /^ГОТОВО ✅\n\nВы передали/);
      assert.equal((await state(t.id)).successes, 1);
    });
    it(`${channel}: paged holder-only code choices keep older transfers accessible without a website`, async () => {
      const a = await actor(channel), other = await actor(channel);
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) ids.push((await seed(a)).id);
      const foreign = await seed(other);
      const first = await send(a, "Мои передачи");
      const choices = first.buttons.filter(b => /^TT-/u.test(b.text));
      assert.equal(choices.length, 5);
      const next = first.buttons.find(b => /Следующие передачи/.test(b.text))!;
      assert.ok(next);
      const second = await send(a, "", next.payload ?? next.callback_data);
      const rest = second.buttons.filter(b => /^TT-/u.test(b.text));
      assert.equal(rest.length, 2);
      const shown = [...choices, ...rest].map(b => parseReceiptEntryCallback(b.payload ?? b.callback_data ?? "")!.transferId);
      assert.deepEqual([...shown].sort(), ids.sort()); assert.ok(!shown.includes(foreign.id));
    });
    for (const role of ["rop", "regional_manager"]) {
      it(`${channel}: ${role} status uses the canonical 1C team scope and rechecks membership`, async () => {
        const leader = await actor(channel, true), member = await actor(channel, true), outsider = await actor(channel, true);
        await p().query("UPDATE users SET role=$2 WHERE id=$1", [leader.user, role]);
        await p().query("UPDATE users SET role='manager' WHERE id=ANY($1::uuid[])", [[member.user, outsider.user]]);
        const leaderGuid = randomUUID(), memberGuid = randomUUID(), teamGuid = randomUUID();
        await p().query(`INSERT INTO onec_wholesale_employee_roster(guid_manager,name_manager,post,raw_json)
          VALUES($1,'Synthetic leader','Manager','{}'),($2,'Synthetic member','Manager','{}')`, [leaderGuid, memberGuid]);
        await p().query(`INSERT INTO onec_wholesale_team_groups(guid_team,name_team,guid_team_leader,name_team_leader)
          VALUES($1,'Synthetic status team',$2,'Synthetic leader')`, [teamGuid, leaderGuid]);
        await p().query(`INSERT INTO onec_wholesale_employee_team_memberships(guid_team,guid_manager,name_team)
          VALUES($1,$2,'Synthetic status team')`, [teamGuid, memberGuid]);
        await linkUserToEmployee({ databaseUrl: getIntegrationDatabaseUrl(), userId: leader.user!, employeeId: leaderGuid, confirmedByUserId: outsider.user! });
        await linkUserToEmployee({ databaseUrl: getIntegrationDatabaseUrl(), userId: member.user!, employeeId: memberGuid, confirmedByUserId: outsider.user! });
        const visible = await seed(member), hidden = await seed(outsider);
        const list = await send(leader, "Статус трека");
        assert.ok(list.buttons.some(b => (b.payload ?? b.callback_data) === statusView(visible.id)));
        assert.ok(!list.buttons.some(b => (b.payload ?? b.callback_data) === statusView(hidden.id)));
        assert.match((await send(leader, "", statusView(visible.id))).text, /Текущий держатель: Synthetic sender/);
        assert.match((await send(leader, "", statusView(hidden.id))).text, /не найден или недоступен/);
        // Pool max is five. Every reader already holds a connection; a nested acquisition could starve all readers.
        const concurrent = await Promise.all(Array.from({ length: 6 }, () => withTransaction(client =>
          trackStatusReply(client, {
            channel, messengerUserId: BigInt(leader.id), messengerChatId: String(leader.chat),
            privateDialogOk: true, isLinkedStaff: true, staffUserId: leader.user!, personId: null,
          }, { action: "view", transferId: visible.id }))));
        for (const reply of concurrent) assert.match(reply.text, /Текущий держатель: Synthetic sender/);
        await p().query("DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_team=$1", [teamGuid]);
        assert.match((await send(leader, "", statusView(visible.id))).text, /не найден или недоступен/);
      });
    }
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
