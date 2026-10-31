import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { createHmac } from "node:crypto";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; userId: string; partyId: string; id: number; chatId: number };
type Button = { text: string; callback_data?: string; payload?: string };
type Reply = { text: string; buttons: Button[] };
type Card = { name?: string; phone?: string; vcf?: string; signedOwn?: boolean };
const db = getIntegrationDatabaseUrl();
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 910000;
let realFetch: typeof fetch;
let forbiddenFetches = 0;

before(async () => {
  setIntegrationEnv(db, "http://127.0.0.1:3000");
  Object.assign(process.env, {
    TT_OTP_PEPPER: "independent-contact-otp-pepper",
    TT_EXTERNAL_MESSENGER_ENABLED: "true", TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-synthetic-test-token-0123456789",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_test_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-link-pepper-min16",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-telegram-webhook-secret-min16",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "false",
    TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_TEST_TOKEN_0123456789abcdef",
    TANBOT_MAX_BOT_USERNAME: "synthetic_test_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-max-link-pepper-min16",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-max-webhook-secret-min16",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  const receiver = await createTestUser({ databaseUrl: db, email: "contact-target@test.local",
    password: "StrongPass123!", fullName: "Synthetic Contact Staff Target", role: "manager" });
  await ensurePartyForUserOnWrite(getPool()!, receiver.id, "Synthetic Contact Staff Target", null);
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => { forbiddenFetches++; throw new Error("No real network in recipient-card QA"); };
  const { createApp } = await import("../../src/server");
  app = createApp();
});
after(async () => { globalThis.fetch = realFetch; await closePool(); assert.equal(forbiddenFetches, 0); });

async function actor(channel: Channel): Promise<Actor> {
  const id = ++seq;
  const chatId = channel === "max" ? id + 100000 : id;
  const user = await createTestUser({ databaseUrl: db, email: `contact-${id}@test.local`,
    password: "StrongPass123!", fullName: "Synthetic Contact Sender", role: "admin" });
  const party = await ensurePartyForUserOnWrite(getPool()!, user.id, "Synthetic Contact Sender", null);
  const prefix = channel === "max" ? "max" : "telegram";
  await getPool()!.query(`INSERT INTO tanbot_${prefix}_accounts
    (user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled) VALUES($1,$2,$3,true)`,
    [user.id, String(id), String(chatId)]);
  return { channel, id, chatId, userId: user.id, partyId: party.id };
}

async function send(a: Actor, input: { text?: string; callback?: string; card?: Card; updateId?: number;
  chatType?: string | null; optionalReply?: boolean }): Promise<Reply> {
  const id = input.updateId ?? ++seq;
  const replies: Reply[] = [];
  if (a.channel === "telegram") {
    const message = { message_id: id, chat: { id: a.chatId, type: input.chatType === undefined ? "private" : input.chatType },
      from: { id: a.id, is_bot: false, first_name: "Actual Sender Name" },
      ...(input.card ? { contact: { first_name: input.card.name ?? "", phone_number: input.card.phone ?? "",
        user_id: 777001, vcard: input.card.vcf } } : { text: input.text ?? "" }) };
    const raw = input.callback ? { update_id: id, callback_query: { id: `contact-${id}`, data: input.callback,
      from: message.from, message } } : { update_id: id, message };
    const response = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!).send(raw);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const config = loadTanbotTelegramStage2Config(); assert.ok(config.ok);
    await processUndeliveredTelegramWebhookReplies(getPool()!, config.config, async p => {
      if (p.method === "sendMessage") {
        assert.equal(String(p.body.chat_id), String(a.id));
        const markup = p.body.reply_markup as { inline_keyboard?: Button[][]; keyboard?: Button[][] } | undefined;
        replies.push({ text: String(p.body.text), buttons: (markup?.inline_keyboard ?? markup?.keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: id } };
    }, { deliveryEnabled: true });
  } else {
    const cardVcf = input.card?.vcf ?? `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${input.card?.name ?? ""}\r\nTEL;TYPE=cell:${input.card?.phone ?? ""}\r\nEND:VCARD\r\n`;
    const proof = input.card?.signedOwn ? {
      hash: createHmac("sha256", process.env.TANBOT_MAX_BOT_TOKEN!).update(cardVcf, "utf8").digest("hex"),
      max_info: { user_id: a.id },
    } : {};
    const message = { sender: { user_id: a.id, is_bot: false, first_name: "Actual Sender Name" },
      recipient: { chat_id: a.chatId, chat_type: input.chatType === undefined ? "dialog" : input.chatType, user_id: 999000 },
      body: { mid: `contact-${id}`, ...(input.card ? { attachments: [{ type: "contact", payload: {
        vcf_info: cardVcf, ...proof,
      } }] } : { text: input.text ?? "" }) } };
    const raw = input.callback ? { update_type: "message_callback", timestamp: id, message,
      callback: { callback_id: `contact-${id}`, payload: input.callback, user: { user_id: a.id, is_bot: false } } }
      : { update_type: "message_created", timestamp: id, message };
    const response = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!).send(raw);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const config = loadTanbotMaxStage2Config(); assert.ok(config.ok);
    await processUndeliveredMaxWebhookReplies(getPool()!, config.config, async p => {
      assert.equal(p.userId, BigInt(a.id), "MAX reply goes to real sender, not contact user");
      replies.push({ text: p.text, buttons: p.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `contact-reply-${id}` } } } };
    }, { deliveryEnabled: true });
  }
  if (!input.optionalReply) assert.ok(replies.length, "webhook must persist a useful reply");
  return replies.at(-1) ?? { text: "", buttons: [] };
}
function button(r: Reply, regex: RegExp) {
  const b = r.buttons.find(b => regex.test(b.text));
  assert.ok(b, `Missing ${regex} in ${JSON.stringify(r)}`);
  const value = b.callback_data ?? b.payload; assert.ok(value); return value;
}
async function startExternal(a: Actor) {
  let r = await send(a, { text: "Создать передачу" });
  r = await send(a, { text: `Synthetic card item ${a.id}` });
  r = await send(a, { callback: button(r, /Пропустить/i) });
  r = await send(a, { callback: button(r, /Пропустить/i) });
  return send(a, { callback: button(r, /Внешний получатель/i) });
}
async function draft(a: Actor) {
  const row = (await getPool()!.query(`SELECT id,step,payload FROM tt_external_request_drafts
    WHERE payload->>'staffUserId'=$1 AND confirmed_transfer_id IS NULL ORDER BY created_at DESC LIMIT 1`, [a.userId])).rows[0];
  assert.ok(row); return row;
}
async function privacyCounts() {
  return (await getPool()!.query(`SELECT
    (SELECT count(*) FROM tt_external_person_verifications)::int verified,
    (SELECT count(*) FROM tt_external_persons)::int persons,
    (SELECT count(*) FROM tt_transfers)::int transfers,
    (SELECT count(*) FROM tt_handoff_codes)::int codes,
    (SELECT count(*) FROM tt_transfer_invitations)::int invitations,
    (SELECT count(*) FROM tt_audit_log)::int transfer_audit,
    (SELECT count(*) FROM tanbot_notification_outbox)::int staff_notices,
    (SELECT count(*) FROM tt_external_person_message_outbox)::int external_notices`)).rows[0];
}

for (const channel of ["max", "telegram"] as const) {
  it(`${channel}: independent name-first card preserves manual name and canonical create target, no identity proof`, async () => {
    const a = await actor(channel);
    await startExternal(a);
    await send(a, { text: "Моё название получателя" });
    const before = await privacyCounts();
    // Separate senders use separate external recipients: cross-creator reuse is governed by existing eligibility.
    const expectedPhone = channel === "max" ? "+79991112233" : "+79991112234";
    let r = await send(a, { card: { name: "Чужое имя в контактах",
      phone: channel === "max" ? "8 (999) 111-22-33" : "8 (999) 111-22-34" } });
    let d = await draft(a);
    assert.deepEqual(d.payload.recipientExternal, { name: "Моё название получателя", phone: expectedPhone });
    assert.deepEqual(await privacyCounts(), before, "contact only fills draft, never verifies or creates identities/transfers");
    assert.ok(!JSON.stringify(d).includes("BEGIN:VCARD"));
    if (d.step === "recipient_ext_phone") {
      assert.match(r.text, /Моё название получателя/);
      r = await send(a, { callback: button(r, /Далее/i) });
      d = await draft(a);
    }
    assert.equal(d.step, "due");
    r = await send(a, { callback: button(r, /Без срока/i) });
    assert.match(r.text, /Моё название получателя/);
    assert.ok(r.text.replace(/\D/g, "").includes(expectedPhone.slice(1)), "summary must display selected phone");
    const created = await send(a, { callback: button(r, /^Создать$/i) });
    assert.match(created.text, /Передача создана/, `explicit create failed: ${created.text}`);
    const rows = (await getPool()!.query(`SELECT t.id,p.display_name,p.phone_e164
      FROM tt_transfers t JOIN tt_parties p ON p.id=t.pending_party_id WHERE t.creator_party_id=$1`, [a.partyId])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].display_name, "Моё название получателя");
    assert.equal(rows[0].phone_e164, expectedPhone);
    assert.equal((await privacyCounts()).verified, before.verified, "explicit create is still not recipient identity verification");
  });
  it(`${channel}: independent contact-first supports rename, malformed card preserves good draft, and replay is inert`, async () => {
    const a = await actor(channel);
    await startExternal(a);
    const before = await privacyCounts();
    const updateId = ++seq;
    const card = { name: "Имя из карточки", phone: "+7 999 222-33-44" };
    let r = await send(a, { card, updateId });
    const d = await draft(a);
    assert.equal(d.payload.recipientExternal.phone, "+79992223344");
    assert.equal(d.payload.recipientExternal.name, "Имя из карточки");
    assert.ok(r.buttons.some(b => /имя|оставить|использовать|подтвердить/i.test(b.text)),
      "contact-first must offer explicit use/rename choice, not silently skip name review");
    assert.deepEqual(await privacyCounts(), before);
    await send(a, { card, updateId, optionalReply: true });
    assert.deepEqual(await draft(a), d, "same provider update cannot advance draft twice");
    r = await send(a, { text: "Имя написано мной" });
    let renamed = await draft(a);
    assert.equal(renamed.payload.recipientExternal.name, "Имя написано мной");
    assert.equal(renamed.payload.recipientExternal.phone, "+79992223344");
    if (renamed.step === "recipient_ext_phone") {
      r = await send(a, { callback: button(r, /Далее/i) });
      renamed = await draft(a);
    }
    assert.equal(renamed.step, "due");
    await send(a, { card: { phone: "invalid", name: "Should not replace" }, optionalReply: true });
    assert.deepEqual(await draft(a), renamed, "card outside eligible step leaves the selected recipient untouched");
    assert.deepEqual(await privacyCounts(), before);
    await send(a, { callback: button(r, /Без срока/i) });
  });
  it(`${channel}: independent card cannot mutate draft from group, missing private context, foreign chat or revoked staff`, async () => {
    const a = await actor(channel);
    await startExternal(a);
    const before = await draft(a);
    const identities = await privacyCounts();
    const card = { name: "Чужой контакт", phone: "+79993334455" };
    for (const chatType of [channel === "max" ? "chat" : "group", null]) {
      await send(a, { card, chatType, optionalReply: true });
      assert.deepEqual(await draft(a), before);
    }
    await send({ ...a, chatId: a.chatId + 111111 }, { card, optionalReply: true });
    assert.deepEqual(await draft(a), before);
    await getPool()!.query("UPDATE users SET role='analyst' WHERE id=$1", [a.userId]);
    await send(a, { card, optionalReply: true });
    assert.deepEqual(await draft(a), before);
    assert.deepEqual(await privacyCounts(), identities);
  });
  it(`${channel}: independent nameless contact retains number until manual name and rejects invalid replacement`, async () => {
    const a = await actor(channel);
    await startExternal(a);
    await send(a, { card: { phone: "+79994445566" } });
    let d = await draft(a);
    assert.equal(d.step, "recipient_ext_name");
    assert.equal(d.payload.recipientExternal.phone, "+79994445566");
    await send(a, { card: { name: "Неверный номер", phone: "+1 212 555 0100" }, optionalReply: true });
    assert.deepEqual(await draft(a), d, "unsupported number must not overwrite prior good phone");
    let r = await send(a, { text: "Получатель без имени в карточке" });
    d = await draft(a);
    if (d.step === "recipient_ext_phone") {
      r = await send(a, { callback: button(r, /Далее/i) });
      d = await draft(a);
    }
    assert.equal(d.step, "due");
    assert.deepEqual(d.payload.recipientExternal, { name: "Получатель без имени в карточке", phone: "+79994445566" });
  });
  it(`${channel}: independent keep contact name then edit to staff never creates for old external phone`, async () => {
    const a = await actor(channel);
    await startExternal(a);
    let r = await send(a, { card: { name: "Сохранить имя карточки", phone: "+79996667788" } });
    r = await send(a, { callback: button(r, /оставить|использовать|подтвердить/iu) });
    if ((await draft(a)).step === "recipient_ext_phone") r = await send(a, { callback: button(r, /Далее/i) });
    assert.equal((await draft(a)).step, "due");
    r = await send(a, { callback: button(r, /Без срока/i) });
    r = await send(a, { callback: button(r, /Изменить/i) });
    r = await send(a, { callback: button(r, /Получатель/i) });
    for (let page = 0; page < 20 && !r.buttons.some(b => /Synthetic Contact Staff Target/.test(b.text)); page++) {
      r = await send(a, { callback: button(r, /Стр\. ▶/) });
    }
    r = await send(a, { callback: button(r, /Synthetic Contact Staff Target/) });
    assert.equal((await draft(a)).payload.recipientExternal, undefined,
      "selecting a staff recipient clears old external target");
    assert.match(r.text, /Synthetic Contact Staff Target/);
    assert.doesNotMatch(r.text, /Сохранить имя карточки|79996667788/);
    await send(a, { callback: button(r, /^Создать$/i) });
    const rows = (await getPool()!.query(`SELECT p.kind,p.display_name FROM tt_transfers t
      JOIN tt_parties p ON p.id=t.pending_party_id WHERE t.creator_party_id=$1`, [a.partyId])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "user");
    assert.equal(rows[0].display_name, "Synthetic Contact Staff Target");
  });
  it(`${channel}: independent oversized contact preserves prior good recipient and emits no business side effects`, async () => {
    const a = await actor(channel);
    await startExternal(a);
    await send(a, { card: { name: "Уже выбранный контакт", phone: "+79993332211" } });
    const before = await draft(a);
    const identities = await privacyCounts();
    for (const card of [
      { name: "Не подменять", phone: "+79990001122", vcf: "X".repeat(16385) },
      { name: "Не подменять", phone: "+79990001122" + " ".repeat(20000) },
    ]) {
      const r = await send(a, { card });
      assert.match(r.text, /слишком больш|другой|вручную/i);
      assert.deepEqual(await draft(a), before);
      assert.deepEqual(await privacyCounts(), identities);
    }
  });
}

it("max: independent folded/escaped VCF and ambiguous multiple phones never silently pick wrong number", async () => {
  const a = await actor("max");
  await startExternal(a);
  const before = await draft(a);
  const r = await send(a, { card: { vcf: "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Несколько номеров\r\nTEL:+79991111111\r\nTEL:+79992222222\r\nEND:VCARD" } });
  const after = await draft(a);
  assert.deepEqual(after.payload.recipientExternal, before.payload.recipientExternal,
    "multiple distinct numbers must not silently set a guessed first TEL");
  assert.equal(after.payload.recipientExternal?.phone, undefined);
  assert.match(r.text, /несколько|один|выбер|номер/iu);
  await send(a, { card: { vcf: "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Сложное имя\\r\\nTEL;TYPE=cell:tel:+7-999-\\r\\n 555-66-77\\r\\nEND:VCARD\\r\\n" } });
  const d = await draft(a);
  assert.equal(d.payload.recipientExternal.phone, "+79995556677");
  assert.equal(d.payload.recipientExternal.name, "Сложное имя");
  assert.ok(!JSON.stringify(d).includes("BEGIN:VCARD"));
});

it("max: independent signed own-card inside recipient wizard stays data-only and preserves native response", async () => {
  const a = await actor("max");
  await startExternal(a);
  const before = await privacyCounts();
  const r = await send(a, { card: { signedOwn: true, name: "Свой контакт как получатель", phone: "+79997778899" } });
  assert.match(r.text, /Свой контакт как получатель/);
  assert.ok(r.buttons.some(b => /Оставить имя/i.test(b.text)), "native reply must not be replaced by own-proof fallback");
  assert.deepEqual((await draft(a)).payload.recipientExternal, { name: "Свой контакт как получатель", phone: "+79997778899" });
  assert.deepEqual(await privacyCounts(), before);
});

it("telegram: independent conflicting primary and vcard phones cannot silently change recipient", async () => {
  const a = await actor("telegram");
  await startExternal(a);
  const before = await draft(a);
  const identities = await privacyCounts();
  const r = await send(a, { card: { name: "Два разных номера", phone: "+79991113344",
    vcf: "BEGIN:VCARD\nFN:Два разных номера\nTEL:+79995556677\nEND:VCARD" } });
  assert.match(r.text, /несколько|один/i);
  assert.deepEqual(await draft(a), before);
  assert.deepEqual(await privacyCounts(), identities);
});
