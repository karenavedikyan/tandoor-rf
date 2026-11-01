import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { buildMaxSendMessagePayload } from "../../src/tanbot-max/delivery-transport";
import { NATIVE_SENDER_HANDOFF_GUIDANCE as SENDER_HANDOFF_GUIDANCE } from "../../src/tan-tracker/sender-handoff-guidance";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; id: number; chatId: number; staffId?: string };
type Button = { text: string; payload?: string; callback_data?: string; request_contact?: boolean };
type Reply = { text: string; buttons: Button[]; markup?: Record<string, unknown>; copyCode?: string };
type Input = { text?: string; callback?: string; start?: boolean; file?: boolean; optional?: boolean; group?: boolean;
  contact?: { phone_number: string; first_name: string; user_id: number };
  expectCode?: boolean;
  /** External native create: primary + forwardable invitation (not OTP). */
  expectInvitation?: boolean;
};
const databaseUrl = getIntegrationDatabaseUrl();
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 6700000;
let realFetch: typeof fetch;
let unexpected = 0;
const PDF = Buffer.from("%PDF-1.7\nSynthetic menu draft preservation fixture\n%%EOF\n");

before(async () => {
  setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
  Object.assign(process.env, {
    TT_ATTACHMENTS_BACKEND: "postgres", TT_EXTERNAL_MESSENGER_ENABLED: "true", TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TT_OTP_PEPPER: "synthetic-unified-menu-otp-pepper-min16",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:SYNTH_MENU_TEST_TOKEN", TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_menu_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-menu-telegram-pepper", TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-menu-telegram-secret",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
    TANBOT_MAX_BOT_TOKEN: "SYNTH_MENU_MAX_TOKEN", TANBOT_MAX_BOT_USERNAME: "synthetic_menu_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-menu-max-pepper", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-menu-max-secret",
  });
  await prepareDatabase(databaseUrl); await resetPoolForTests();
  const target = await createTestUser({ databaseUrl, email: "menu-target@test.local", password: "StrongPass123!",
    fullName: "Private Menu Directory Target", role: "manager" });
  await ensurePartyForUserOnWrite(getPool()!, target.id, "Private Menu Directory Target", "+79995550707");
  await getPool()!.query("UPDATE users SET phone='+79995550707',accepts_external_tt_intake=TRUE WHERE id=$1", [target.id]);
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.telegram.org" && url.pathname.endsWith("/getFile")) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/menu-fixture.pdf" } }));
    }
    if (url.hostname === "synthetic.oneme.ru" || (url.hostname === "api.telegram.org" && url.pathname.includes("/file/bot"))) {
      assert.equal(init?.redirect, "error");
      return new Response(PDF, { headers: { "content-type": "application/pdf" } });
    }
    unexpected++;
    throw new Error("No real network permitted in independent bot menu acceptance");
  };
  app = (await import("../../src/server")).createApp();
});
after(async () => { globalThis.fetch = realFetch; await closePool(); assert.equal(unexpected, 0); });

async function actor(channel: Channel, role: "staff" | "external" | "unknown"): Promise<Actor> {
  const id = ++seq, chatId = channel === "max" ? id + 100000 : id;
  if (role === "staff") {
    const user = await createTestUser({ databaseUrl, email: `menu-${id}@test.local`, password: "StrongPass123!",
      fullName: `Synthetic Menu Sender ${id}`, role: "admin" });
    await ensurePartyForUserOnWrite(getPool()!, user.id, `Synthetic Menu Sender ${id}`, null);
    await getPool()!.query(`INSERT INTO tanbot_${channel}_accounts(user_id,${channel}_user_id,${channel}_chat_id,notifications_enabled)
      VALUES($1,$2,$3,TRUE)`, [user.id, String(id), String(chatId)]);
    return { channel, id, chatId, staffId: user.id };
  }
  if (role === "external") {
    const partyId = randomUUID(), personId = randomUUID(), phone = `+7997${String(id).padStart(7, "0")}`;
    await getPool()!.query("INSERT INTO tt_parties(id,kind,display_name,phone_e164) VALUES($1,'external','Synthetic Menu External',$2)", [partyId, phone]);
    await getPool()!.query("INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,'Synthetic Menu External',$3)", [personId, partyId, phone]);
    await getPool()!.query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
      VALUES($1,$2,$3,$4)`, [personId, channel, String(id), String(chatId)]);
  }
  return { channel, id, chatId };
}
async function drain(a: Actor): Promise<Reply[]> {
  const replies: Reply[] = [];
  if (a.channel === "max") {
    const cfg = loadTanbotMaxStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredMaxWebhookReplies(getPool()!, cfg.config, async p => {
      assert.equal(p.userId, BigInt(a.id), "MAX recipient is actual user ID, not dialog ID");
      const body = buildMaxSendMessagePayload(p);
      const attachments = body.attachments as { type?: string }[] | undefined;
      if (!attachments?.some(x => ["file", "image", "video"].includes(x.type ?? ""))) {
        replies.push({ text: p.text, buttons: p.inlineButtons?.flat() ?? [] });
      }
      return { ok: true, result: { message: { body: { mid: `menu-result-${seq}` } } } };
    }, { deliveryEnabled: true });
  } else {
    const cfg = loadTanbotTelegramStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredTelegramWebhookReplies(getPool()!, cfg.config, async p => {
      if (p.method === "answerCallbackQuery") return { ok: true, result: true };
      assert.equal(String(p.body.chat_id), String(a.id));
      if (p.method === "sendMessage") {
        const markup = p.body.reply_markup as Record<string, unknown> | undefined;
        assert.ok(!(markup?.inline_keyboard && markup?.keyboard), "Telegram supports one keyboard type per message");
        replies.push({ text: String(p.body.text), markup,
          buttons: ((markup?.inline_keyboard ?? markup?.keyboard ?? []) as Button[][]).flat() });
      }
      return { ok: true, result: { message_id: seq } };
    }, { deliveryEnabled: true });
  }
  return replies;
}
async function send(a: Actor, input: Input): Promise<Reply> {
  const id = ++seq;
  if (a.channel === "max") {
    const body: Record<string, unknown> = { mid: `menu-${id}`, text: input.text ?? "" };
    if (input.file) body.attachments = [{ type: "file", filename: "menu-fixture.pdf", size: PDF.length,
      payload: { url: "https://synthetic.oneme.ru/files/menu-fixture.pdf", token: "synthetic-menu-file-token" } }];
    const message = { sender: { user_id: a.id, is_bot: false },
      recipient: { chat_id: a.chatId, chat_type: input.group ? "chat" : "dialog" }, body };
    const raw = input.start
      ? { update_type: "bot_started", timestamp: id, chat_id: a.chatId, user: { user_id: a.id, is_bot: false } }
      : input.callback
        ? { update_type: "message_callback", timestamp: id, message,
            callback: { callback_id: `menu-cb-${id}`, payload: input.callback, user: { user_id: a.id, is_bot: false } } }
        : { update_type: "message_created", timestamp: id, message };
    const r = await request(app).post("/api/tanbot-max/webhook").set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!).send(raw);
    assert.equal(r.status, 200);
  } else {
    const message: Record<string, unknown> = { message_id: id, chat: { id: a.id, type: input.group ? "group" : "private" },
      from: { id: a.id, is_bot: false }, text: input.start ? "/start" : input.text ?? "" };
    if (input.file) message.document = { file_id: "menu-fixture", file_unique_id: "menu-unique", file_size: PDF.length,
      file_name: "menu-fixture.pdf", mime_type: "application/pdf" };
    if (input.contact) { delete message.text; message.contact = input.contact; }
    const raw = input.callback
      ? { update_id: id, callback_query: { id: `menu-cb-${id}`, from: { id: a.id, is_bot: false }, data: input.callback, message } }
      : { update_id: id, message };
    const r = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!).send(raw);
    assert.equal(r.status, 200);
  }
  const replies = await drain(a);
  if (input.optional && !replies.length) return { text: "", buttons: [] };
  assert.ok(!(input.expectCode && input.expectInvitation), "code follow-up and invitation are distinct second messages");
  const expectedReplies = input.expectCode || input.expectInvitation ? 2 : 1;
  assert.equal(
    replies.length,
    expectedReplies,
    input.expectInvitation
      ? "external create sends primary then clean invitation"
      : "only explicit code issuance sends a copy-only follow-up",
  );
  if (input.expectCode) {
    assert.match(replies[1]!.text, /^\d{6}$/u);
    assert.equal(replies[1]!.buttons.length, 0, "copy-only code must remain free of navigation");
  }
  if (input.expectInvitation) {
    const invite = replies[1]!;
    assert.match(invite.text, /Посмотреть передачу/u);
    const urls = invite.text.match(/https?:\/\/[^\s)]+/g) ?? [];
    assert.equal(urls.length, 1, invite.text);
    assert.doesNotMatch(invite.text, /^\d{6}$/m);
    assert.equal(invite.buttons.length, 0, "forwardable invitation must not carry navigation buttons");
  }
  if (a.channel === "max") {
    assert.equal(replies[0]!.buttons.filter(b => b.text === "Главное меню").length, 1);
    assert.equal(replies[0]!.buttons.at(-1)?.text, "Главное меню", "one navigation footer in primary delivery");
    assert.ok(!replies[0]!.buttons.some(b => b.text === "Меню"), "no duplicate legacy menu button");
  }
  for (const b of replies[0]!.buttons) {
    const callback = b.callback_data ?? b.payload;
    if (callback) assert.ok(Buffer.byteLength(callback, "utf8") <= 64);
  }
  return { ...replies[0]!, ...(input.expectCode ? { copyCode: replies[1]!.text } : {}) };
}
function button(r: Reply, pattern: RegExp): Button {
  const found = r.buttons.find(b => pattern.test(b.text));
  assert.ok(found, `${pattern} not present: ${JSON.stringify(r)}`);
  return found;
}
async function click(a: Actor, r: Reply, pattern: RegExp): Promise<Reply> {
  const b = button(r, pattern), callback = b.callback_data ?? b.payload;
  return send(a, callback ? { callback } : { text: b.text });
}
function main(a: Actor, r: Reply, resume: boolean) {
  button(r, /^Оформить передачу$/u); button(r, /^Мои передачи$/u);
  button(r, /^Получить код приёма$/u); button(r, /^Настройки$/u);
  assert.equal(r.buttons.some(b => /^Продолжить оформление$/u.test(b.text)), resume);
  assert.doesNotMatch(JSON.stringify(r), /Private Menu Directory Target|79995550707|external-person\/session|person_session=/u);
  if (a.channel === "telegram") {
    assert.ok(Array.isArray(r.markup?.keyboard), "main menu must actually send reply keyboard, not drop it for inline");
    assert.equal(r.markup?.is_persistent, true);
    assert.notEqual(r.markup?.one_time_keyboard, true);
  }
}
async function draft(a: Actor) {
  const actorKey = a.staffId ? "staff" : "ext";
  const r = await getPool()!.query(`SELECT * FROM tt_external_request_drafts
    WHERE channel=$1 AND messenger_chat_id=$2 AND confirmed_transfer_id IS NULL ORDER BY updated_at DESC LIMIT 1`,
    [a.channel, `native:${actorKey}:${a.channel}:${a.chatId}`]);
  return r.rows[0] as { id: string; step: string; payload: Record<string, unknown> } | undefined;
}
async function counts(includeSessions = true) {
  const tables = ["tt_transfers", "tt_handoff_codes", "tt_transfer_invitations", "tt_audit_log",
    "tanbot_notification_outbox", "tt_external_person_message_outbox",
    "tt_parties", "tt_external_persons", "tt_external_person_verifications", "tt_external_request_drafts",
    ...(includeSessions ? ["tt_external_person_sessions"] : [])];
  const result: Record<string, number> = {};
  for (const table of tables) result[table] = Number((await getPool()!.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  return result;
}
async function partyFor(a: Actor): Promise<string> {
  if (a.staffId) return (await getPool()!.query("SELECT id FROM tt_parties WHERE user_id=$1", [a.staffId])).rows[0].id;
  return (await getPool()!.query(`SELECT p.party_id FROM tt_external_persons p
    JOIN tt_external_person_verifications v ON v.person_id=p.id
    WHERE v.channel=$1 AND v.messenger_user_id=$2`, [a.channel, String(a.id)])).rows[0].party_id;
}
async function preference(a: Actor) {
  if (a.staffId) return (await getPool()!.query(`SELECT notifications_enabled,stopped_at FROM tanbot_${a.channel}_accounts WHERE user_id=$1`,
    [a.staffId])).rows[0];
  return (await getPool()!.query(`SELECT notifications_enabled FROM tt_external_person_verifications
    WHERE channel=$1 AND messenger_user_id=$2`, [a.channel, String(a.id)])).rows[0];
}
for (const channel of ["max", "telegram"] as const) {
  for (const role of ["staff", "external"] as const) {
    it(`${channel} ${role}: settings confirmation, reversible notifications, profile and draft retained`, async () => {
      const a = await actor(channel, role), other = await actor(channel, role);
      await send(a, { text: "Оформить передачу" });
      await send(a, { text: "Не потерять черновик из настроек" });
      const frozen = await snapshot(a), beforeCounts = await counts();
      let r = await send(a, { text: "Настройки" });
      assert.match(r.text, /Уведомления: включены/u);
      r = await click(a, r, /^Отключить уведомления$/u);
      assert.match(r.text, /Отключить уведомления\?/u);
      assert.equal((await preference(a)).notifications_enabled, true, "asking never disables");
      r = await click(a, r, /^Оставить как есть$/u);
      assert.equal((await preference(a)).notifications_enabled, true);
      r = await click(a, r, /^Отключить уведомления$/u);
      r = await click(a, r, /^Да, отключить уведомления$/u);
      assert.match(r.text, /Подключение к боту сохранено/u);
      assert.equal((await preference(a)).notifications_enabled, false);
      assert.equal((await preference(other)).notifications_enabled, true);
      if (a.staffId) assert.equal((await preference(a)).stopped_at, null);
      r = await click(a, r, /^Включить уведомления$/u);
      assert.equal((await preference(a)).notifications_enabled, true);
      assert.deepEqual(await snapshot(a), frozen);
      assert.deepEqual(await counts(), beforeCounts, "preferences never generate OTPs, sessions or business state");
      r = await click(a, r, /^(?:Главное меню|Меню)$/u); main(a, r, true);
    });
    it(`${channel} ${role}: incoming list is private, explicit version-bound code comes in two messages`, async () => {
      const a = await actor(channel, role), other = await actor(channel, role);
      const holder = await partyFor(other), pending = await partyFor(a);
      const id = `TT-2026-${++seq}`;
      await getPool()!.query(`INSERT INTO tt_transfers(id,public_code,item_title,status,
        creator_party_id,holder_party_id,pending_party_id,final_recipient_party_id)
        VALUES($1,$1,'Уникальные документы получателя','waiting',$2,$2,$3,$3)`, [id, holder, pending]);
      const beforeCodes = (await getPool()!.query("SELECT count(*) FROM tt_handoff_codes WHERE transfer_id=$1", [id])).rows[0].count;
      let r = await send(a, { text: "Получить код приёма" });
      assert.match(r.text, new RegExp(id));
      assert.equal((await getPool()!.query("SELECT count(*) FROM tt_handoff_codes WHERE transfer_id=$1", [id])).rows[0].count, beforeCodes);
      const b = button(r, new RegExp(`Получить код · ${id}`)), payload = b.payload ?? b.callback_data!;
      const foreign = await send(other, { callback: payload });
      assert.doesNotMatch(foreign.text, /Уникальные документы получателя|Код приёма: \d{6}/u);
      const foreignList = await send(other, { text: "Получить код приёма" });
      assert.doesNotMatch(foreignList.text, new RegExp(id));
      const issued = await send(a, { callback: payload, expectCode: true });
      assert.match(issued.text, new RegExp(`Код приёма: ${issued.copyCode}`));
      assert.match(issued.text, /От:|От кого:/u);
      assert.match(issued.text, /Кому:/u);
      await getPool()!.query("UPDATE tt_transfers SET handoff_version=handoff_version+1 WHERE id=$1", [id]);
      r = await send(a, { callback: payload });
      assert.match(r.text, /устарела|недоступна/u);
      assert.equal((await getPool()!.query("SELECT count(*)::int AS n FROM tt_handoff_codes WHERE transfer_id=$1", [id])).rows[0].n, 1);
    });
  }
  it(`${channel}: unknown and group callers cannot use settings or issue codes`, async () => {
    const unknown = await actor(channel, "unknown"), known = await actor(channel, "staff");
    const beforeCounts = await counts();
    for (const text of ["Настройки", "Получить код приёма"]) {
      const r = await send(unknown, { text });
      assert.match(r.text, /Подтвердите свой номер/u);
      const group = await send(known, { text, group: true, optional: true });
      assert.doesNotMatch(group.text, /Уведомления:|Код приёма: \d{6}/u);
    }
    assert.deepEqual(await counts(), beforeCounts);
  });
}
for (const role of ["staff", "external"] as const) {
  it(`telegram ${role}: obsolete contact keyboard replaced, no new verification or session`, async () => {
    const a = await actor("telegram", role), beforeCounts = await counts();
    const r = await send(a, { contact: { phone_number: "+79995550999", first_name: "Свой контакт", user_id: a.id } });
    main(a, r, false);
    assert.ok(!r.buttons.some(b => b.request_contact));
    assert.doesNotMatch(r.text, /Контакт не принят/u);
    assert.deepEqual(await counts(), beforeCounts);
  });
}
async function snapshot(a: Actor) {
  const d = await draft(a);
  return { draft: d, files: d ? (await getPool()!.query(
    "SELECT * FROM tt_external_request_draft_files WHERE draft_id=$1 ORDER BY id", [d.id])).rows : [] };
}
async function chooseRecipient(a: Actor, r: Reply) {
  if (a.staffId) {
    r = await send(a, { text: "Private Menu Directory Target" });
    r = await click(a, r, /Private Menu Directory Target/u);
  } else {
    r = await send(a, { text: "+79995550707" });
    r = await send(a, { text: "Получатель меню" });
    for (let i = 0; i < 3 && (await draft(a))?.step !== "due"; i++) r = await click(a, r, /оставить имя|^далее$/iu);
  }
  assert.equal((await draft(a))?.step, "due");
  return click(a, r, /без срока/iu);
}

for (const channel of ["max", "telegram"] as const) {
  for (const role of ["staff", "external", "unknown"] as const) {
    it(`${channel} ${role}: Start opens usable menu without creating identity, draft, session or business state`, async () => {
      const a = await actor(channel, role), beforeCounts = await counts();
      const r = await send(a, { start: true }); main(a, r, false);
      assert.deepEqual(await counts(), beforeCounts);
      assert.equal(await draft(a), undefined);
      if (role === "unknown") {
        const reply = await click(a, r, /^Оформить передачу$/u);
        assert.match(reply.text, /телефон|контакт|номер/iu);
        if (channel === "telegram") assert.ok(reply.buttons.some(b => b.request_contact === true));
        assert.deepEqual(await counts(), beforeCounts, "asking for verified own contact is not identity creation");
      }
    });
  }
  for (const role of ["staff", "external"] as const) {
    it(`${channel} ${role}: rebound draft ownership is checked again before Menu or Continue`, async () => {
      const a = await actor(channel, role);
      await send(a, { text: "Создать передачу" });
      const r = await send(a, { text: "Приватный предмет потерявшего доступ владельца" });
      const d = await draft(a); assert.ok(d);
      if (a.staffId) {
        await getPool()!.query(`UPDATE tanbot_${channel}_accounts SET ${channel}_chat_id=$1 WHERE user_id=$2`,
          [String(a.chatId + 123), a.staffId]);
      } else {
        await getPool()!.query(`UPDATE tt_external_request_drafts SET person_id=
          (SELECT id FROM tt_external_persons WHERE id<>person_id LIMIT 1) WHERE id=$1`, [d.id]);
      }
      const frozen = await snapshot(a), beforeCounts = await counts();
      for (const input of [{ text: "Меню" }, { text: "Продолжить оформление" },
        { callback: button(r, /^(?:Главное меню|Меню)$/u).payload ?? button(r, /^(?:Главное меню|Меню)$/u).callback_data }]) {
        const reply = await send(a, { ...input, optional: true });
        assert.ok(!reply.buttons.some(b => /^Продолжить оформление$/u.test(b.text)));
        assert.doesNotMatch(reply.text, /Приватный предмет потерявшего доступ владельца/u);
        assert.deepEqual(await snapshot(a), frozen); assert.deepEqual(await counts(), beforeCounts);
      }
    });
    it(`${channel} ${role}: Menu and Start preserve files, revision and exact step; Continue resumes; cancel removes Continue`, async () => {
      const a = await actor(channel, role);
      let r = await send(a, { start: true });
      r = await click(a, r, /^Оформить передачу$/u);
      assert.equal((await draft(a))?.step, "item");
      r = await send(a, { text: "Не потерять документы меню" });
      r = await send(a, { file: true }); assert.equal((await snapshot(a)).files.length, 1);
      const oldWizardMenu = button(r, /^(?:Главное меню|Меню)$/u);
      const frozen = await snapshot(a), beforeCounts = await counts();
      r = await click(a, r, /^(?:Главное меню|Меню)$/u); main(a, r, true);
      assert.deepEqual(await snapshot(a), frozen); assert.deepEqual(await counts(), beforeCounts);
      r = await send(a, { start: true }); main(a, r, true);
      assert.deepEqual(await snapshot(a), frozen); assert.deepEqual(await counts(), beforeCounts);
      for (const command of ["/start", "/menu", "Меню"]) {
        r = await send(a, { text: command }); main(a, r, true);
        assert.deepEqual(await snapshot(a), frozen); assert.deepEqual(await counts(), beforeCounts);
      }
      const oldResume = button(r, /^Продолжить оформление$/u);
      r = await click(a, r, /^Продолжить оформление$/u);
      assert.equal((await draft(a))?.step, "photo"); assert.match(r.text, /1\s*\/\s*5/u);
      assert.deepEqual(await snapshot(a), frozen);
      r = await click(a, r, /^Далее$/u);
      const comment = await snapshot(a);
      r = await send(a, { text: "Меню" }); main(a, r, true);
      assert.deepEqual(await snapshot(a), comment, "Menu must not become comment text");
      r = await click(a, r, /^Продолжить оформление$/u);
      r = await send(a, { text: "Сохранённый комментарий" });
      const recipient = await snapshot(a);
      r = await send(a, { text: "/start" }); main(a, r, true);
      assert.deepEqual(await snapshot(a), recipient, "Start must not become recipient search/phone");
      r = await send(a, { callback: oldWizardMenu.callback_data ?? oldWizardMenu.payload });
      main(a, r, true);
      assert.deepEqual(await snapshot(a), recipient, "old Menu remains pure and usable after wizard revision changed");
      r = await send(a, oldResume.callback_data ?? oldResume.payload
        ? { callback: oldResume.callback_data ?? oldResume.payload } : { text: oldResume.text });
      button(r, /^Отмена$/u);
      assert.deepEqual(await snapshot(a), recipient, "old Continue renders current owned step, not an old revision");
      r = await send(a, { text: "Меню" }); main(a, r, true);
      const nonSessionCounts = await counts(false);
      r = await click(a, r, /^Мои передачи$/u);
      assert.deepEqual(await snapshot(a), recipient);
      assert.deepEqual(await counts(false), nonSessionCounts);
      r = await click(a, r, /^(?:Главное меню|Меню)$/u); main(a, r, true);
      r = await click(a, r, /^Продолжить оформление$/u);
      r = await click(a, r, /^Отмена$/u); main(a, r, false);
      assert.equal(await draft(a), undefined);
      const afterCancel = await counts();
      r = await send(a, oldResume.callback_data ?? oldResume.payload
        ? { callback: oldResume.callback_data ?? oldResume.payload } : { text: oldResume.text });
      assert.equal(await draft(a), undefined, "stale resume never recreates discarded draft");
      assert.deepEqual(await counts(), afterCancel);
      assert.doesNotMatch(r.text, /Не потерять документы меню|Сохранённый комментарий/u);
    });
    it(`${channel} ${role}: summary uses explicit Create, Menu is pure, confirmation removes draft resume`, async () => {
      const a = await actor(channel, role);
      let r = await send(a, { text: "Создать передачу" }); // legacy alias remains supported
      r = await send(a, { text: "Финальное действие не запускается из меню" });
      r = await click(a, r, /пропустить/iu);
      r = await click(a, r, /пропустить/iu);
      r = await chooseRecipient(a, r);
      assert.equal((await draft(a))?.step, "summary");
      button(r, /^Создать передачу$/u);
      const frozen = await snapshot(a), beforeCounts = await counts();
      r = await click(a, r, /^(?:Главное меню|Меню)$/u); main(a, r, true);
      assert.deepEqual(await snapshot(a), frozen); assert.deepEqual(await counts(), beforeCounts);
      r = await click(a, r, /^Продолжить оформление$/u);
      if (a.staffId) {
        r = await click(a, r, /^Создать передачу$/u);
        assert.ok(r.text.includes(SENDER_HANDOFF_GUIDANCE), "creator is told to ask recipient for code and enter it before physical handoff");
      } else {
        const createBtn = button(r, /^Создать передачу$/u);
        r = await send(a, { callback: createBtn.callback_data ?? createBtn.payload, expectInvitation: true });
      }
      assert.equal(await draft(a), undefined);
      r = await click(a, r, /^(?:Главное меню|Меню)$/u); main(a, r, false);
      const confirmedCounts = await counts();
      r = await send(a, { start: true }); main(a, r, false);
      assert.deepEqual(await counts(), confirmedCounts);
    });
  }
  it(`${channel}: disabled staff cannot recover a draft through plain Start or Menu`, async () => {
    const a = await actor(channel, "staff");
    await send(a, { text: "Создать передачу" });
    await send(a, { text: "Приватный предмет отключённого сотрудника" });
    await getPool()!.query("UPDATE users SET status='disabled' WHERE id=$1", [a.staffId]);
    const frozen = await snapshot(a), beforeCounts = await counts();
    for (const input of [{ start: true }, { text: "Меню" }, { text: "Продолжить оформление" }]) {
      const r = await send(a, { ...input, optional: true });
      assert.ok(!r.buttons.some(b => /^Продолжить оформление$/u.test(b.text)));
      assert.doesNotMatch(r.text, /Приватный предмет отключённого сотрудника/u);
      assert.deepEqual(await snapshot(a), frozen); assert.deepEqual(await counts(), beforeCounts);
    }
  });
  it(`${channel}: group messages cannot expose or mutate private draft through menu commands`, async () => {
    const a = await actor(channel, "staff");
    await send(a, { text: "Создать передачу" });
    await send(a, { text: "Приватный предмет личного диалога" });
    const frozen = await snapshot(a), beforeCounts = await counts();
    for (const text of ["/menu", "Меню", "Продолжить оформление"]) {
      const r = await send(a, { text, group: true, optional: true });
      assert.ok(!r.buttons.some(b => /^Продолжить оформление$/u.test(b.text)));
      assert.doesNotMatch(r.text, /Приватный предмет личного диалога/u);
      assert.deepEqual(await snapshot(a), frozen); assert.deepEqual(await counts(), beforeCounts);
    }
  });
}
