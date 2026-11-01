import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; id: number; chatId: number; staffId?: string };
type Button = { text: string; payload?: string; callback_data?: string };
type Reply = { text: string; buttons: Button[] };
type Input = { text?: string; callback?: string; phone?: string; cardName?: string;
  signed?: boolean; optional?: boolean; chatType?: string };
const db = getIntegrationDatabaseUrl();
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 810000;
let originalFetch: typeof fetch;
let forbiddenNetwork = 0;
let targetId: string, targetPartyId: string;
const privateName = "Иван Петров";
const privatePhone = "+79995550101";
const absentPhone = "+79995550199";

before(async () => {
  setIntegrationEnv(db, "http://127.0.0.1:3000");
  Object.assign(process.env, {
    TT_EXTERNAL_MESSENGER_ENABLED: "true", TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-unified-synthetic-test-token",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_unified_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-unified-telegram-pepper",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-unified-telegram-secret",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "false", TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_UNIFIED_MAX_TOKEN",
    TANBOT_MAX_BOT_USERNAME: "synthetic_unified_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-unified-max-pepper",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-unified-max-secret",
  });
  await prepareDatabase(db); await resetPoolForTests();
  for (let i = 0; i < 9; i++) {
    const name = i === 0 ? privateName : i === 1 ? "Без Карточки" : `Поиск Тестовый ${i}`;
    const user = await createTestUser({ databaseUrl: db, email: `unified-target-${i}@test.local`,
      password: "StrongPass123!", fullName: name, role: "manager" });
    const phone = i === 0 ? privatePhone : `+7999555020${i}`;
    await getPool()!.query("UPDATE users SET phone=$2, accepts_external_tt_intake=TRUE WHERE id=$1", [user.id, phone]);
    if (i === 1) continue;
    const party = await ensurePartyForUserOnWrite(getPool()!, user.id, name, phone);
    if (i === 0) { targetId = user.id; targetPartyId = party.id; }
  }
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { forbiddenNetwork++; throw new Error("No real network in unified-recipient QA"); };
  const { createApp } = await import("../../src/server"); app = createApp();
});
after(async () => { globalThis.fetch = originalFetch; await closePool(); assert.equal(forbiddenNetwork, 0); });

async function actor(channel: Channel, staff = true): Promise<Actor> {
  const id = ++seq, chatId = channel === "max" ? id + 100000 : id;
  if (staff) {
    const u = await createTestUser({ databaseUrl: db, email: `unified-sender-${id}@test.local`,
      password: "StrongPass123!", fullName: `Отправитель ${id}`, role: "admin" });
    await ensurePartyForUserOnWrite(getPool()!, u.id, `Отправитель ${id}`, null);
    await getPool()!.query(`INSERT INTO tanbot_${channel}_accounts
      (user_id,${channel}_user_id,${channel}_chat_id,notifications_enabled) VALUES($1,$2,$3,true)`,
    [u.id, String(id), String(chatId)]);
    return { channel, id, chatId, staffId: u.id };
  }
  const phone = `+7999${String(id).padStart(7, "0")}`;
  const partyId = (await getPool()!.query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external','Synthetic Unified Sender',$1) RETURNING id`, [phone])).rows[0].id;
  const personId = randomUUID();
  await getPool()!.query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164)
    VALUES($1,$2,'Synthetic Unified Sender',$3)`, [personId, partyId, phone]);
  await getPool()!.query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
    VALUES($1,$2,$3,$4)`, [personId, channel, String(id), String(chatId)]);
  return { channel, id, chatId };
}
async function send(a: Actor, input: Input): Promise<Reply> {
  const id = ++seq, out: Reply[] = [];
  if (a.channel === "max") {
    const vcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${input.cardName ?? ""}\r\nTEL:${input.phone ?? ""}\r\nEND:VCARD\r\n`;
    const proof = input.signed ? { hash: createHmac("sha256", process.env.TANBOT_MAX_BOT_TOKEN!).update(vcf).digest("hex"),
      max_info: { user_id: a.id } } : {};
    const message = { sender: { user_id: a.id, is_bot: false },
      recipient: { chat_id: a.chatId, chat_type: input.chatType ?? "dialog", user_id: 999000 },
      body: { mid: `unified-${id}`, ...(input.phone ? { attachments: [
        { type: "contact", payload: { vcf_info: vcf, ...proof } },
      ] } : { text: input.text ?? "" }) } };
    const raw = input.callback ? { update_type: "message_callback", timestamp: id, message,
      callback: { callback_id: `unified-cb-${id}`, payload: input.callback, user: { user_id: a.id, is_bot: false } } }
      : { update_type: "message_created", timestamp: id, message };
    const result = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!).send(raw);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const c = loadTanbotMaxStage2Config(); assert.ok(c.ok);
    await processUndeliveredMaxWebhookReplies(getPool()!, c.config, async p => {
      assert.equal(p.userId, BigInt(a.id), "reply targets actual MAX user, not chat/contact ID");
      out.push({ text: p.text, buttons: p.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `unified-reply-${id}` } } } };
    }, { deliveryEnabled: true });
  } else {
    const message = { message_id: id, from: { id: a.id, is_bot: false },
      chat: { id: a.chatId, type: input.chatType ?? "private" },
      ...(input.phone ? { contact: { user_id: 777001, first_name: input.cardName ?? "", phone_number: input.phone } }
        : { text: input.text ?? "" }) };
    const raw = input.callback ? { update_id: id, callback_query: {
      id: `unified-cb-${id}`, data: input.callback, from: message.from, message,
    } } : { update_id: id, message };
    const result = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!).send(raw);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const c = loadTanbotTelegramStage2Config(); assert.ok(c.ok);
    await processUndeliveredTelegramWebhookReplies(getPool()!, c.config, async p => {
      if (p.method === "sendMessage") {
        assert.equal(String(p.body.chat_id), String(a.id));
        const m = p.body.reply_markup as { inline_keyboard?: Button[][]; keyboard?: Button[][] } | undefined;
        out.push({ text: String(p.body.text), buttons: (m?.inline_keyboard ?? m?.keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: id } };
    }, { deliveryEnabled: true });
  }
  if (!input.optional) assert.ok(out.length, "input must not disappear without usable reply");
  return out.at(-1) ?? { text: "", buttons: [] };
}
function button(r: Reply, pattern: RegExp) {
  const b = r.buttons.find(b => pattern.test(b.text));
  assert.ok(b, `Missing ${pattern}: ${JSON.stringify(r)}`);
  const data = b.payload ?? b.callback_data; assert.ok(data); assert.ok(Buffer.byteLength(data) <= 64); return data;
}
async function draft(a: Actor) {
  const key = `native:${a.staffId ? "staff" : "ext"}:${a.channel}:${a.chatId}`;
  const row = (await getPool()!.query(`SELECT id,step,payload,confirmed_transfer_id FROM tt_external_request_drafts
    WHERE messenger_chat_id=$1 ORDER BY created_at DESC LIMIT 1`, [key])).rows[0];
  assert.ok(row); return row;
}
async function counts() {
  return (await getPool()!.query(`SELECT
    (SELECT count(*) FROM tt_parties)::int parties,
    (SELECT count(*) FROM tt_transfers)::int transfers,
    (SELECT count(*) FROM tt_handoff_codes)::int codes,
    (SELECT count(*) FROM tt_transfer_invitations)::int invitations,
    (SELECT count(*) FROM tt_external_person_verifications)::int verifications,
    (SELECT count(*) FROM tt_external_persons)::int persons,
    (SELECT count(*) FROM tt_audit_log)::int audit,
    (SELECT count(*) FROM tanbot_notification_outbox)::int notices,
    (SELECT count(*) FROM tt_external_person_message_outbox)::int external_notices`)).rows[0];
}
async function start(a: Actor) {
  await send(a, { text: "Создать передачу" });
  let r = await send(a, { text: `Synthetic unified item ${a.id}` });
  r = await send(a, { callback: button(r, /пропустить/iu) });
  return send(a, { callback: button(r, /пропустить/iu) });
}
function staffPrompt(r: Reply) {
  assert.match(r.text, /им[яени]/iu); assert.match(r.text, /фамили/iu);
  assert.match(r.text, /телефон/iu); assert.match(r.text, /контакт/iu);
  assert.doesNotMatch(r.buttons.map(b => b.text).join("\n"), /внешний|внутренний|Петров|Тестовый|Без Карточки/iu);
}
function noPrivateData(r: Reply) {
  assert.doesNotMatch(JSON.stringify(r), /Иван Петров|Без Карточки|Поиск Тестовый|79995550|9995550/iu);
}
async function advanceToDue(a: Actor, r: Reply) {
  for (let i = 0; i < 3 && (await draft(a)).step !== "due"; i++) {
    r = await send(a, { callback: button(r, /оставить имя|^далее$/iu) });
  }
  assert.equal((await draft(a)).step, "due"); return r;
}
async function create(a: Actor, r: Reply, expectedName?: string) {
  r = await send(a, { callback: button(r, /без срока/iu) });
  if (expectedName) assert.ok(r.text.includes(expectedName), "summary preserves user-provided recipient name");
  if (!a.staffId) assert.doesNotMatch(JSON.stringify(r), /Иван Петров|Поиск Тестовый|Без Карточки/u);
  const callback = button(r, /^Создать передачу$/u);
  assert.equal(r.buttons[0].text, "Создать передачу", "existing full-width primary action stays first");
  await send(a, { callback });
  const id = (await draft(a)).confirmed_transfer_id; assert.ok(id); return id;
}

for (const channel of ["max", "telegram"] as const) {
  it(`${channel}: one intuitive input finds surname/reversed-name/phone/card, fresh choice creates exact staff target`, async () => {
    const a = await actor(channel), before = await counts(); staffPrompt(await start(a));
    let r = await send(a, { text: "пЕтРоВ" });
    const stalePick = button(r, /Иван Петров/u);
    r = await send(a, { text: "Петров Иван" }); button(r, /Иван Петров/u);
    r = await send(a, { text: "8 (999) 555-01-01" }); button(r, /Иван Петров/u);
    r = await send(a, { phone: privatePhone, cardName: "Не менять чужое имя", signed: true });
    const currentPick = button(r, /Иван Петров/u);
    await send(a, { callback: stalePick });
    assert.equal((await draft(a)).step, "recipient", "old query cannot select stale result");
    assert.deepEqual(await counts(), before, "lookup/card never proves identity or materializes a party");
    r = await send(a, { callback: currentPick });
    assert.equal((await draft(a)).step, "due");
    const id = await create(a, r);
    const transfer = (await getPool()!.query("SELECT pending_party_id FROM tt_transfers WHERE id=$1", [id])).rows[0];
    assert.equal(transfer.pending_party_id, targetPartyId);
    assert.equal((await getPool()!.query("SELECT full_name FROM users WHERE id=$1", [targetId])).rows[0].full_name, privateName);
  });
  it(`${channel}: unknown number asks name, known own external phone reuses record without extra classification`, async () => {
    const a = await actor(channel); staffPrompt(await start(a));
    const phone = `+7998${String(++seq).padStart(7, "0")}`, before = await counts();
    let r = await send(a, { text: phone }); assert.match(r.text, /имя/iu);
    r = await send(a, { text: "Новый Адресат" }); r = await advanceToDue(a, r);
    assert.deepEqual(await counts(), before, "new recipient not written before Create");
    const id = await create(a, r);
    const party = (await getPool()!.query(`SELECT p.id,p.display_name,p.phone_e164 FROM tt_parties p
      JOIN tt_transfers t ON t.pending_party_id=p.id WHERE t.id=$1`, [id])).rows[0];
    assert.equal(party.display_name, "Новый Адресат"); assert.equal(party.phone_e164, phone);
    await start(a);
    r = await send(a, { phone, cardName: "Другое имя из телефона", signed: true });
    r = await send(a, { callback: button(r, /Новый Адресат/u) });
    const beforeSecond = await counts(), id2 = await create(a, r);
    assert.equal((await getPool()!.query("SELECT pending_party_id FROM tt_transfers WHERE id=$1", [id2])).rows[0].pending_party_id, party.id);
    assert.equal((await counts()).parties, beforeSecond.parties, "known phone must not make duplicate external party");
    assert.equal((await getPool()!.query("SELECT display_name FROM tt_parties WHERE id=$1", [party.id])).rows[0].display_name, "Новый Адресат");
  });
  it(`${channel}: internal library includes eligible users without materializing their party until explicit Create`, async () => {
    const a = await actor(channel);
    const name = `Новый Сотрудник ${++seq}`;
    const u = await createTestUser({ databaseUrl: db, email: `unmaterialized-${++seq}@test.local`,
      password: "StrongPass123!", fullName: name, role: "manager" });
    const before = await counts();
    staffPrompt(await start(a));
    assert.equal((await getPool()!.query("SELECT id FROM tt_parties WHERE user_id=$1", [u.id])).rowCount, 0);
    let r = await send(a, { text: name });
    r = await send(a, { callback: button(r, new RegExp(name, "u")) });
    assert.deepEqual(await counts(), before);
    const id = await create(a, r);
    const target = (await getPool()!.query(`SELECT p.user_id FROM tt_parties p JOIN tt_transfers t
      ON t.pending_party_id=p.id WHERE t.id=$1`, [id])).rows[0];
    assert.equal(target.user_id, u.id);
    const phone = `+7996${String(++seq).padStart(7, "0")}`;
    await getPool()!.query("UPDATE users SET phone=NULL WHERE id=$1", [u.id]);
    await getPool()!.query("UPDATE tt_parties SET phone_e164=$2 WHERE user_id=$1", [u.id, phone]);
    staffPrompt(await start(a));
    const prior = await counts();
    r = await send(a, { text: phone });
    r = await send(a, { callback: button(r, new RegExp(name, "u")) });
    assert.deepEqual(await counts(), prior, "party-phone fallback is lookup, not a new external identity");
    const second = await create(a, r);
    assert.equal((await getPool()!.query(`SELECT p.user_id FROM tt_parties p JOIN tt_transfers t
      ON t.pending_party_id=p.id WHERE t.id=$1`, [second])).rows[0].user_id, u.id);
  });
  it(`${channel}: staff pagination is query-bound and target eligibility is rechecked on selection`, async () => {
    const a = await actor(channel); staffPrompt(await start(a));
    let r = await send(a, { text: "Поиск" });
    assert.ok(r.buttons.filter(b => /Поиск Тестовый/u.test(b.text)).length <= 5);
    const first = button(r, /Поиск Тестовый/u);
    r = await send(a, { callback: button(r, /впер|следующ|дальше|Стр\. ▶/iu) });
    assert.ok(r.buttons.some(b => /Поиск Тестовый/u.test(b.text)));
    r = await send(a, { text: "Петров" });
    await send(a, { callback: first }); assert.equal((await draft(a)).step, "recipient");
    const pick = button(r, /Иван Петров/u);
    await getPool()!.query("UPDATE users SET status='disabled' WHERE id=$1", [targetId]);
    try {
      await send(a, { callback: pick }); assert.notEqual((await draft(a)).step, "due");
      assert.equal((await draft(a)).confirmed_transfer_id, null);
    } finally { await getPool()!.query("UPDATE users SET status='active' WHERE id=$1", [targetId]); }
  });
  it(`${channel}: staff recipient disabled after selection cannot be created from a stale summary`, async () => {
    const a = await actor(channel, true);
    await start(a);
    let r = await send(a, { text: privatePhone });
    r = await send(a, { callback: button(r, /Иван Петров/u) });
    r = await send(a, { callback: button(r, /без срока/iu) });
    const before = await counts();
    await getPool()!.query("UPDATE users SET status='disabled' WHERE id=$1", [targetId]);
    try {
      r = await send(a, { callback: button(r, /^Создать передачу$/u) });
      assert.equal((await draft(a)).confirmed_transfer_id, null);
      assert.deepEqual(await counts(), before, "Create must revalidate recipient eligibility after a prior valid choice");
    } finally { await getPool()!.query("UPDATE users SET status='active' WHERE id=$1", [targetId]); }
  });
  it(`${channel}: external sender cannot search/probe internal directory or use forged staff picker`, async () => {
    const a = await actor(channel, false); noPrivateData(await start(a)); const before = await counts();
    let r = await send(a, { text: "Петров" });
    assert.ok(!r.buttons.some(b => /Петров|Тестовый/u.test(b.text)));
    assert.doesNotMatch(r.text, /Иван Петров/u, "partial name query must not disclose full internal name");
    assert.doesNotMatch(JSON.stringify(r), /79995550|9995550/u);
    const d = await draft(a);
    // Existing external drafts from the prior release may contain a cached internal list.
    await getPool()!.query(`UPDATE tt_external_request_drafts
      SET payload=jsonb_set(payload,'{eligibleRecipients}',$2::jsonb) WHERE id=$1`,
    [d.id, JSON.stringify([{ userId: targetId, fullName: privateName }])]);
    const forged = buildNativeCreateCallback("recipient", d.id, d.payload.revision, "0"); assert.ok(forged);
    noPrivateData(await send(a, { callback: forged }));
    assert.equal((await draft(a)).step, "recipient", "cannot enumerate cached internal choices via forged callback");
    assert.deepEqual(await counts(), before);
  });
  it(`${channel}: external known/unknown number replies do not reveal staff existence; allowed intake still creates canonically`, async () => {
    const known = await actor(channel, false), unknown = await actor(channel, false);
    await start(known); await start(unknown);
    const before = await counts();
    const a = await send(known, { text: privatePhone });
    const b = await send(unknown, { text: absentPhone });
    assert.doesNotMatch(JSON.stringify(a), /Иван Петров|Тестовый|Без Карточки/u);
    assert.doesNotMatch(JSON.stringify(b), /Иван Петров|Тестовый|Без Карточки/u);
    const sanitize = (s: string) => s.replace(/\+?[\d ()-]{10,}/gu, "<phone>");
    assert.equal(sanitize(a.text), sanitize(b.text), "no number-existence oracle before explicit Create");
    assert.equal((await draft(known)).step, (await draft(unknown)).step);
    let r = await send(known, { text: "Указанное мной имя" });
    r = await advanceToDue(known, r);
    assert.deepEqual(await counts(), before);
    const id = await create(known, r, "Указанное мной имя");
    assert.equal((await getPool()!.query("SELECT pending_party_id FROM tt_transfers WHERE id=$1", [id])).rows[0].pending_party_id, targetPartyId);
  });
  it(`${channel}: external unknown phone creates transfer to new external recipient at explicit Create`, async () => {
    const a = await actor(channel, false);
    await start(a);
    const partiesBefore = (await counts()).parties;
    let r = await send(a, { text: absentPhone });
    r = await send(a, { text: "Имя из моей записи" });
    r = await advanceToDue(a, r);
    assert.ok(r.text.includes("Имя из моей записи"));
    const id = await create(a, r, "Имя из моей записи");
    const transfer = (await getPool()!.query(
      `SELECT t.holder_party_id::text,t.pending_party_id::text,t.creator_party_id::text,
              p.display_name,p.phone_e164,p.created_by_user_id::text
       FROM tt_transfers t JOIN tt_parties p ON p.id=t.pending_party_id WHERE t.id=$1`, [id])).rows[0];
    const senderParty = (await getPool()!.query(`SELECT ep.party_id::text FROM tt_external_persons ep
      JOIN tt_external_person_verifications v ON v.person_id=ep.id
      WHERE v.messenger_user_id=$1 AND v.channel=$2`, [String(a.id), channel])).rows[0].party_id;
    assert.equal(transfer.holder_party_id, senderParty);
    assert.equal(transfer.creator_party_id, senderParty);
    assert.equal(transfer.display_name, "Имя из моей записи");
    assert.equal(transfer.phone_e164, absentPhone);
    assert.equal(transfer.created_by_user_id, null);
    assert.equal((await counts()).parties, partiesBefore + 1, "one canonical external party at confirm only");
    assert.doesNotMatch(JSON.stringify(r), /Иван Петров|Поиск Тестовый|Без Карточки/u);
  });
  it(`${channel}: legacy external summary never renders a cached private staff display name`, async () => {
    const a = await actor(channel, false);
    await start(a);
    let r = await send(a, { text: privatePhone });
    r = await send(a, { text: "Введённое мной имя" });
    r = await advanceToDue(a, r);
    r = await send(a, { callback: button(r, /без срока/iu) });
    const d = await draft(a), before = await counts();
    await getPool()!.query(`UPDATE tt_external_request_drafts
      SET payload=jsonb_set(payload - 'externalRecipientDisplayName','{recipientDisplayName}',to_jsonb($2::text))
      WHERE id=$1`, [d.id, "Иван Петров"]);
    r = await send(a, { text: "Создать передачу" });
    assert.doesNotMatch(JSON.stringify(r), /Иван Петров|Поиск Тестовый|Без Карточки/u);
    assert.deepEqual(await counts(), before);
  });
  it(`${channel}: external recipient cards are private DATA, preserve suggested name and match canonical party-phone fallback`, async () => {
    const known = await actor(channel, false), unknown = await actor(channel, false);
    await start(known); await start(unknown);
    await getPool()!.query("UPDATE users SET phone=NULL WHERE id=$1", [targetId]);
    try {
      const before = await counts(), name = "Имя из отправленного контакта";
      let r = await send(known, { phone: privatePhone, cardName: name, signed: true });
      const other = await send(unknown, { phone: absentPhone, cardName: name, signed: true });
      const sanitize = (s: string) => s.replace(/\+?[\d ()-]{10,}/gu, "<phone>");
      assert.equal(sanitize(r.text), sanitize(other.text), "contact input must not reveal whether staff phone exists");
      assert.equal((await draft(known)).step, (await draft(unknown)).step);
      assert.doesNotMatch(JSON.stringify(r), /Иван Петров|Поиск Тестовый|Без Карточки/u);
      assert.doesNotMatch(JSON.stringify(other), /Иван Петров|Поиск Тестовый|Без Карточки/u);
      r = await advanceToDue(known, r);
      assert.deepEqual(await counts(), before, "recipient card is data, never identity proof or early canonical write");
      const id = await create(known, r, name);
      assert.equal((await getPool()!.query("SELECT pending_party_id FROM tt_transfers WHERE id=$1", [id])).rows[0].pending_party_id, targetPartyId);
    } finally {
      await getPool()!.query("UPDATE users SET phone=$2 WHERE id=$1", [targetId, privatePhone]);
    }
  });
  it(`${channel}: group, foreign chat and revoked staff binding cannot read internal search results`, async () => {
    const a = await actor(channel); staffPrompt(await start(a)); const before = await counts();
    noPrivateData(await send(a, { text: "Петров", chatType: channel === "max" ? "chat" : "group", optional: true }));
    noPrivateData(await send({ ...a, chatId: a.chatId + 900000 }, { text: "Петров", optional: true }));
    await getPool()!.query(`UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.staffId]);
    noPrivateData(await send(a, { text: "Петров", optional: true }));
    assert.deepEqual(await counts(), before);
  });
  it(`${channel}: staff phone lookup does not reveal another creator's inaccessible external contact`, async () => {
    const owner = await actor(channel), a = await actor(channel);
    const phone = `+7997${String(++seq).padStart(7, "0")}`;
    await getPool()!.query(`INSERT INTO tt_parties(kind,display_name,phone_e164,created_by_user_id)
      VALUES('external','Чужой Тайный Контакт',$1,$2)`, [phone, owner.staffId]);
    staffPrompt(await start(a)); const before = await counts();
    for (const input of [{ text: phone }, { phone, cardName: "Своё имя из контактов" }]) {
      const r = await send(a, input);
      assert.doesNotMatch(JSON.stringify(r), /Чужой Тайный Контакт/u);
    }
    assert.deepEqual(await counts(), before);
  });
}
