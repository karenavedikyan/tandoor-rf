import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { readAttachmentBytes } from "../../src/tan-tracker/attachments";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; id: number; chatId: number; staffId?: string; partyId: string };
type Button = { text: string; callback_data?: string; payload?: string };
type Reply = { text: string; buttons: Button[] };
type Input = {
  text?: string; callback?: string; photos?: string[]; id?: number; timestamp?: number;
  caption?: string | null; chatType?: string; optionalReply?: boolean;
};
const db = getIntegrationDatabaseUrl();
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 970000;
let realFetch: typeof fetch;
let unexpectedFetches = 0;
const fetches: string[] = [];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x50, 0x48, 0x4f, 0x54, 0x4f]);
const bytesFor = (key: string) => Buffer.concat([JPEG, Buffer.from(key)]);

before(async () => {
  setIntegrationEnv(db, "http://127.0.0.1:3000");
  Object.assign(process.env, {
    TT_ATTACHMENTS_BACKEND: "postgres",
    TT_EXTERNAL_MESSENGER_ENABLED: "true", TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-synthetic-photo-test-token",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_photo_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-photo-pepper",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-telegram-photo-secret",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "false", TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_PHOTO_TEST_TOKEN",
    TANBOT_MAX_BOT_USERNAME: "synthetic_photo_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-max-photo-pepper",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-max-photo-secret",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  const receiver = await createTestUser({ databaseUrl: db, email: "photo-target@test.local",
    password: "StrongPass123!", fullName: "AAA Native Photo Receiver", role: "manager" });
  await ensurePartyForUserOnWrite(getPool()!, receiver.id, "AAA Native Photo Receiver", null);
  await getPool()!.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1", [receiver.id]);
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    fetches.push(url.href);
    if (url.hostname === "api.telegram.org" && url.pathname.endsWith("/getFile")) {
      const key = url.searchParams.get("file_id")!;
      return new Response(JSON.stringify({ ok: true, result: { file_path: `photos/${key}.jpg` } }));
    }
    if (url.hostname === "synthetic.oneme.ru" ||
      (url.hostname === "api.telegram.org" && url.pathname.includes("/file/bot"))) {
      assert.equal(init?.redirect, "error", "no implicit redirects for downloadable media");
      const key = url.pathname.split("/").at(-1)!.replace(/\.jpg$/, "");
      if (key === "failed") return new Response("", { status: 503 });
      if (key === "invalid") return new Response("not an image");
      if (key === "oversize") return new Response(new Uint8Array(8 * 1024 * 1024 + 1));
      return new Response(bytesFor(key));
    }
    unexpectedFetches++;
    throw new Error("Unexpected real network is forbidden in photo feedback acceptance");
  };
  const { createApp } = await import("../../src/server");
  app = createApp();
});
after(async () => {
  globalThis.fetch = realFetch;
  await closePool();
  assert.equal(unexpectedFetches, 0, "no unexpected network requests");
});

async function actor(channel: Channel, staff: boolean): Promise<Actor> {
  const id = ++seq, chatId = channel === "max" ? id + 100000 : id;
  if (staff) {
    const user = await createTestUser({ databaseUrl: db, email: `photo-${id}@test.local`,
      password: "StrongPass123!", fullName: `ZZZ Photo Sender ${id}`, role: "admin" });
    const party = await ensurePartyForUserOnWrite(getPool()!, user.id, `ZZZ Photo Sender ${id}`, null);
    const prefix = channel === "max" ? "max" : "telegram";
    await getPool()!.query(`INSERT INTO tanbot_${prefix}_accounts
      (user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled) VALUES($1,$2,$3,true)`,
    [user.id, String(id), String(chatId)]);
    return { channel, id, chatId, staffId: user.id, partyId: party.id };
  }
  const phone = `+7999${String(id).padStart(7, "0")}`;
  const partyId = (await getPool()!.query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external','Synthetic Photo External',$1) RETURNING id`, [phone])).rows[0].id;
  const personId = randomUUID();
  await getPool()!.query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164)
    VALUES($1,$2,'Synthetic Photo External',$3)`, [personId, partyId, phone]);
  await getPool()!.query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
    VALUES($1,$2,$3,$4)`, [personId, channel, String(id), String(chatId)]);
  return { channel, id, chatId, partyId };
}

async function send(a: Actor, input: Input): Promise<Reply> {
  const id = input.id ?? ++seq;
  const replies: Reply[] = [];
  if (a.channel === "max") {
    const body: Record<string, unknown> = { mid: `independent-photo-${id}` };
    if (input.photos) {
      if ("caption" in input) body.text = input.caption;
      body.attachments = input.photos.map(key => ({ type: "image", payload: {
        ...(key === "tokenonly" ? {} : { url: key === "unsafe" ? "https://127.0.0.1/photo.jpg" : `https://synthetic.oneme.ru/${key}.jpg` }),
        token: `synthetic-token-${key}`, file_name: `${key}.jpg`,
      } }));
    } else body.text = input.text ?? "";
    const message = { sender: { user_id: a.id, is_bot: false },
      recipient: { chat_id: a.chatId, chat_type: input.chatType ?? "dialog", user_id: 999000 }, body };
    const raw = input.callback
      ? { update_type: "message_callback", timestamp: input.timestamp ?? id, message,
        callback: { callback_id: `photo-cb-${id}`, payload: input.callback, user: { user_id: a.id, is_bot: false } } }
      : { update_type: "message_created", timestamp: input.timestamp ?? id, message };
    const response = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!).send(raw);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const config = loadTanbotMaxStage2Config(); assert.ok(config.ok);
    await processUndeliveredMaxWebhookReplies(getPool()!, config.config, async p => {
      assert.equal(p.userId, BigInt(a.id), "MAX replies privately to actual user, not dialog chat ID");
      replies.push({ text: p.text, buttons: p.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `recorded-photo-${id}` } } } };
    }, { deliveryEnabled: true });
  } else {
    const message = { message_id: id, from: { id: a.id, is_bot: false },
      chat: { id: a.chatId, type: input.chatType ?? "private" },
      ...(input.photos ? { photo: [
        { file_id: `small-${input.photos[0]}`, file_unique_id: `small-${id}`, width: 10, height: 10 },
        { file_id: input.photos[0], file_unique_id: `large-${id}`, width: 100, height: 100 },
      ], media_group_id: "synthetic-album", caption: input.caption ?? "" } : { text: input.text ?? "" }) };
    const raw = input.callback ? { update_id: id, callback_query: {
      id: `photo-cb-${id}`, data: input.callback, from: message.from, message,
    } } : { update_id: id, message };
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
  }
  if (!input.optionalReply) assert.ok(replies.length, "photo update must not be silently dropped");
  return replies.at(-1) ?? { text: "", buttons: [] };
}
function action(reply: Reply, re: RegExp): string {
  const b = reply.buttons.find(b => re.test(b.text));
  assert.ok(b, `missing ${re}: ${JSON.stringify(reply)}`);
  const data = b.payload ?? b.callback_data;
  assert.ok(data); assert.ok(Buffer.byteLength(data) <= 64); return data;
}
async function draft(a: Actor) {
  const key = `native:${a.staffId ? "staff" : "ext"}:${a.channel}:${a.chatId}`;
  const row = (await getPool()!.query(`SELECT id,step,payload,confirmed_transfer_id FROM tt_external_request_drafts
    WHERE messenger_chat_id=$1 ORDER BY created_at DESC LIMIT 1`, [key])).rows[0];
  assert.ok(row); return row;
}
async function files(a: Actor) {
  return (await getPool()!.query(`SELECT storage_key,sort_order FROM tt_external_request_draft_files
    WHERE draft_id=$1 ORDER BY sort_order`, [(await draft(a)).id])).rows;
}
async function counts() {
  return (await getPool()!.query(`SELECT
    (SELECT count(*) FROM tt_transfers)::int transfers,
    (SELECT count(*) FROM tt_handoff_codes)::int codes,
    (SELECT count(*) FROM tt_transfer_invitations)::int invitations,
    (SELECT count(*) FROM tt_audit_log)::int audit,
    (SELECT count(*) FROM tt_external_person_verifications)::int verifications,
    (SELECT count(*) FROM tanbot_notification_outbox)::int notices,
    (SELECT count(*) FROM tt_external_person_message_outbox)::int external_notices`)).rows[0];
}
async function start(a: Actor) {
  await send(a, { text: "Создать передачу" });
  return send(a, { text: `Synthetic photo item ${a.id}` });
}
function photoGuidance(reply: Reply, n: number) {
  assert.match(reply.text, new RegExp(`${n}\\s*/\\s*5`), "ack states actual saved count, not sent count");
  assert.match(reply.text, /далее/iu, "explicitly explains next action");
  action(reply, /^далее$/iu);
  action(reply, /отмена/iu);
  assert.equal(reply.buttons.some(b => /пропустить/iu.test(b.text)), n === 0);
}

for (const channel of ["max", "telegram"] as const) {
  for (const staff of [true, false]) {
    it(`${channel} ${staff ? "staff" : "external"}: real HTTP photos acknowledge, replay once, working Next, exact canonical attachments`, async () => {
      const a = await actor(channel, staff);
      await start(a);
      const before = await counts();
      const id = ++seq;
      let reply = await send(a, { photos: ["one"], caption: null, id, timestamp: 1200000 });
      photoGuidance(reply, 1);
      const staleNext = action(reply, /^далее$/iu);
      await send(a, { photos: ["one"], caption: null, id, timestamp: 1200000, optionalReply: true });
      assert.equal((await files(a)).length, 1, "replay doesn't download/store duplicate");
      reply = await send(a, { photos: ["two"], caption: "", timestamp: 1200000 });
      photoGuidance(reply, 2);
      const album = ["three", "four", "five"];
      if (channel === "max") reply = await send(a, { photos: album, caption: "Album caption" });
      else for (const key of album) reply = await send(a, { photos: [key], caption: "Album caption" });
      photoGuidance(reply, 5);
      assert.equal((await draft(a)).step, "photo", "photos alone don't advance or create transfer");
      assert.deepEqual(await counts(), before, "photo ingestion has no business/identity/code/notice side effects");
      const rows = await files(a);
      assert.equal(rows.length, 5, "all album images saved, Telegram resolutions not separate photos");
      for (const [i, key] of ["one", "two", ...album].entries())
        assert.deepEqual(await readAttachmentBytes(rows[i].storage_key), bytesFor(key));
      await send(a, { callback: staleNext });
      assert.equal((await draft(a)).step, "photo", "old Next cannot advance after more photos");
      reply = await send(a, { photos: ["six"] });
      photoGuidance(reply, 5);
      assert.match(reply.text, /5|пять/iu);
      assert.equal((await files(a)).length, 5);
      reply = await send(a, { callback: action(reply, /^далее$/iu) });
      assert.equal((await draft(a)).step, "comment", "fresh Next advances to comment");
      reply = await send(a, { callback: action(reply, /пропустить/iu) });
      reply = await send(a, { callback: action(reply, /AAA Native Photo Receiver/u) });
      reply = await send(a, { callback: action(reply, /без срока/iu) });
      assert.match(reply.text, /Фото:\s*5/iu);
      const confirm = action(reply, /^создать$/iu);
      await send(a, { callback: confirm });
      const transferId = (await draft(a)).confirmed_transfer_id;
      assert.ok(transferId);
      const canonical = (await getPool()!.query(`SELECT storage_key FROM tt_transfer_attachments
        WHERE transfer_id=$1 ORDER BY created_at,id`, [transferId])).rows;
      assert.equal(canonical.length, 5);
      assert.deepEqual(canonical.map(f => f.storage_key).sort(), rows.map(f => f.storage_key).sort());
      await send(a, { callback: confirm, optionalReply: true });
      assert.equal((await getPool()!.query("SELECT id FROM tt_transfer_attachments WHERE transfer_id=$1", [transferId])).rowCount, 5);
    });
  }
  it(`${channel}: failed image shows current buttons and preserves previous bytes`, async () => {
    const a = await actor(channel, false); await start(a);
    const before = await counts();
    let reply = await send(a, { photos: ["failed"] });
    photoGuidance(reply, 0);
    assert.match(reply.text, /не удалось|ошиб|не загруз/iu);
    reply = await send(a, { photos: ["retained"] }); photoGuidance(reply, 1);
    const rows = await files(a);
    for (const key of ["invalid", "oversize", "failed"]) {
      reply = await send(a, { photos: [key] }); photoGuidance(reply, 1);
      assert.match(reply.text, /не удалось|ошиб|допустим|не загруз|размер|8\s*мб/iu);
      assert.deepEqual(await files(a), rows);
      assert.deepEqual(await readAttachmentBytes(rows[0].storage_key), bytesFor("retained"));
    }
    assert.deepEqual(await counts(), before);
    await send(a, { callback: action(reply, /^далее$/iu) });
    assert.equal((await draft(a)).step, "comment");
  });
  it(`${channel}: private/current binding guards prevent downloads before access checks`, async () => {
    const a = await actor(channel, true); await start(a);
    const before = await counts(), beforeFetch = fetches.length;
    await send(a, { photos: ["forbidden-group"], chatType: channel === "max" ? "chat" : "group", optionalReply: true });
    await send({ ...a, chatId: a.chatId + 900000 }, { photos: ["forbidden-chat"], optionalReply: true });
    await getPool()!.query(`UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.staffId]);
    await send(a, { photos: ["forbidden-stopped"], optionalReply: true });
    assert.equal(fetches.length, beforeFetch, "unauthorized photo must never trigger provider download");
    assert.equal((await files(a)).length, 0);
    assert.deepEqual(await counts(), before);
  });
  it(`${channel}: cancelled/no-photo-step/unverified messages never fetch or recreate drafts`, async () => {
    const a = await actor(channel, true);
    const prompt = await start(a);
    const oldId = (await draft(a)).id;
    await send(a, { callback: action(prompt, /отмена/iu) });
    const before = await counts(), n = fetches.length;
    await send(a, { photos: ["late-cancelled"], optionalReply: true });
    await send(a, { text: "Создать передачу" });
    assert.equal((await draft(a)).step, "item");
    await send(a, { photos: ["late-new-item"], optionalReply: true });
    const stranger = { ...a, id: ++seq, chatId: seq, staffId: undefined };
    await send(stranger, { photos: ["unverified"], optionalReply: true });
    assert.equal(fetches.length, n, "no downloads outside eligible owned photo step");
    assert.equal((await getPool()!.query("SELECT id FROM tt_external_request_draft_files WHERE draft_id=$1", [oldId])).rowCount, 0);
    assert.equal((await files(a)).length, 0);
    assert.deepEqual(await counts(), before);
  });
}
it("MAX: partial album, unsafe URL and token-only image always give accurate current guidance", async () => {
  const a = await actor("max", false); await start(a);
  const before = await counts();
  let reply = await send(a, { photos: ["partial", "invalid", "unsafe"], caption: "" });
  photoGuidance(reply, 1);
  assert.match(reply.text, /не удалось|ошиб|не загруз|не добав|пропущ/iu);
  assert.equal((await files(a)).length, 1);
  for (const key of ["unsafe", "tokenonly"]) {
    const n = fetches.length;
    reply = await send(a, { photos: [key] });
    photoGuidance(reply, 1);
    assert.match(reply.text, /не удалось|недоступ|не загруз|заново|сервер/iu);
    assert.equal(fetches.length, n, "unsafe URL / bare token don't cause network access");
    assert.equal((await files(a)).length, 1);
  }
  assert.deepEqual(await counts(), before);
});
it("MAX: album exceeding remaining slots keeps exactly five with explicit limit feedback", async () => {
  const a = await actor("max", true); await start(a);
  let reply = await send(a, { photos: ["slot1", "slot2", "slot3", "slot4"] });
  photoGuidance(reply, 4);
  reply = await send(a, { photos: ["slot5", "slot6", "slot7"], caption: "" });
  photoGuidance(reply, 5);
  assert.match(reply.text, /не добав|пропущ|не более|лимит|максим/iu);
  const saved = await files(a);
  assert.equal(saved.length, 5);
  assert.deepEqual(await readAttachmentBytes(saved[4].storage_key), bytesFor("slot5"));
});
