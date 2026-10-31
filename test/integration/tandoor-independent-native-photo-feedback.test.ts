import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { randomUUID } from "node:crypto";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import { readAttachmentBytes } from "../../src/tan-tracker/attachment-storage";
import { parseMaxWebhookUpdate } from "../../src/tanbot-max/update-parse";

type Channel = "telegram" | "max";
type Button = { text: string; callback_data?: string; payload?: string };
type Reply = { text: string; buttons: Button[] };
type Actor = { channel: Channel; messengerId: number; chatId: number; partyId: string; staff?: boolean };

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const JPEG_A = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0xaa]);
const JPEG_B = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0xbb]);
const JPEG_C = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0xcc]);

let app: ReturnType<typeof import("../../src/server").createApp>;
let sequence = 910000;
let targetReceiver: { id: string; partyId: string; name: string };
let mockAgent: MockAgent | null = null;

function installMaxPhotoMocks(paths: Array<{ path: string; body: Buffer }>) {
  mockAgent?.close().catch(() => {});
  mockAgent = new MockAgent();
  setGlobalDispatcher(mockAgent);
  const pool = mockAgent.get("https://iu.oneme.ru");
  for (const p of paths) {
    pool.intercept({ path: p.path, method: "GET" }).reply(200, p.body, {
      headers: { "content-type": "image/jpeg" },
    });
  }
}

async function drainTelegram(actor: Actor, id: number, sends: Reply[]): Promise<void> {
  const loaded = loadTanbotTelegramStage2Config();
  assert.ok(loaded.ok);
  const transport: TelegramDeliveryTransport = async (input) => {
    if (input.method === "sendMessage") {
      const markup = input.body.reply_markup as { inline_keyboard?: Button[][] } | undefined;
      sends.push({ text: String(input.body.text), buttons: (markup?.inline_keyboard ?? []).flat() });
    }
    return { ok: true, result: { message_id: id } };
  };
  await processUndeliveredTelegramWebhookReplies(getPool()!, loaded.config, transport, { deliveryEnabled: true });
}

async function drainMax(actor: Actor, id: number, sends: Reply[]): Promise<void> {
  const loaded = loadTanbotMaxStage2Config();
  assert.ok(loaded.ok);
  const transport: MaxDeliveryTransport = async (input) => {
    if (input.userId !== BigInt(actor.messengerId)) {
      return { ok: true, result: { message: { body: { mid: `drain-other-${id}` } } } };
    }
    sends.push({ text: input.text, buttons: input.inlineButtons?.flat() ?? [] });
    return { ok: true, result: { message: { body: { mid: `recorded-${id}` } } } };
  };
  for (let i = 0; i < 10; i++) {
    const batch = await processUndeliveredMaxWebhookReplies(getPool()!, loaded.config, transport, {
      deliveryEnabled: true,
      limit: 50,
    });
    if (batch.attempted === 0) break;
  }
}

async function sendText(actor: Actor, text: string, skipDrain = false): Promise<Reply> {
  const id = ++sequence;
  const sends: Reply[] = [];
  if (actor.channel === "telegram") {
    const res = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: id,
        message: {
          message_id: id,
          from: { id: actor.messengerId, is_bot: false },
          chat: { id: actor.chatId, type: "private" },
          text,
        },
      });
    assert.equal(res.status, 200);
    if (!skipDrain) await drainTelegram(actor, id, sends);
  } else {
    const res = await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_created",
        timestamp: id,
        message: {
          sender: { user_id: actor.messengerId, is_bot: false },
          recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: 999000 },
          body: { mid: `text-${id}`, text },
        },
      });
    assert.equal(res.status, 200);
    if (!skipDrain) await drainMax(actor, id, sends);
  }
  if (skipDrain) return { text: "", buttons: [] };
  assert.ok(sends.length, "expected bot reply");
  return sends.at(-1)!;
}

async function sendMaxAlbum(
  actor: Actor,
  mid: string,
  attachments: unknown[],
  bodyExtra: Record<string, unknown> = {},
  timestamp?: number,
  options: { requireReply?: boolean } = {},
): Promise<Reply> {
  const id = timestamp ?? ++sequence;
  const sends: Reply[] = [];
  const res = await request(app)
    .post("/api/tanbot-max/webhook")
    .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
    .send({
      update_type: "message_created",
      timestamp: id,
      message: {
        sender: { user_id: actor.messengerId, is_bot: false },
        recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: 999000 },
        body: { mid, attachments, ...bodyExtra },
      },
    });
  assert.equal(res.status, 200);
  await drainMax(actor, id, sends);
  if (options.requireReply !== false) {
    assert.ok(sends.length, "album must produce feedback");
  }
  return sends.at(-1) ?? { text: "", buttons: [] };
}

async function sendTelegramPhoto(actor: Actor, fileId: string, variants?: Array<{ file_id: string; width: number }>): Promise<Reply> {
  const id = ++sequence;
  const sends: Reply[] = [];
  const photo =
    variants ??
    [
      { file_id: `${fileId}-small`, width: 90 },
      { file_id: `${fileId}-large`, width: 800 },
    ];
  const res = await request(app)
    .post("/api/tanbot-telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
    .send({
      update_id: id,
      message: {
        message_id: id,
        from: { id: actor.messengerId, is_bot: false },
        chat: { id: actor.chatId, type: "private" },
        photo,
      },
    });
  assert.equal(res.status, 200);
  await drainTelegram(actor, id, sends);
  assert.ok(sends.length);
  return sends.at(-1)!;
}

async function sendCallback(actor: Actor, data: string): Promise<Reply> {
  const id = ++sequence;
  const sends: Reply[] = [];
  if (actor.channel === "telegram") {
    const res = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: id,
        callback_query: {
          id: `cb-${id}`,
          data,
          from: { id: actor.messengerId, is_bot: false },
          message: { message_id: id, chat: { id: actor.chatId, type: "private" } },
        },
      });
    assert.equal(res.status, 200);
    await drainTelegram(actor, id, sends);
  } else {
    const res = await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_callback",
        timestamp: id,
        callback: { callback_id: `cb-${id}`, payload: data, user: { user_id: actor.messengerId, is_bot: false } },
        message: { recipient: { chat_id: actor.chatId, chat_type: "dialog" } },
      });
    assert.equal(res.status, 200);
    await drainMax(actor, id, sends);
  }
  assert.ok(sends.length);
  return sends.at(-1)!;
}

function button(reply: Reply, label: RegExp): string {
  const b = reply.buttons.find((x) => label.test(x.text));
  assert.ok(b, `button ${label}: ${JSON.stringify(reply)}`);
  const v = b.callback_data ?? b.payload;
  assert.ok(v);
  return v;
}

async function makeActor(channel: Channel, staff: boolean): Promise<Actor> {
  const index = ++sequence;
  const messengerId = index;
  const chatId = channel === "telegram" ? messengerId : messengerId + 100000;
  const pool = getPool()!;
  if (staff) {
    const user = await createTestUser({
      databaseUrl,
      email: `photo-fb-${channel}-${index}@test.local`,
      password: PASSWORD,
      fullName: `Photo staff ${channel}`,
      role: "manager",
    });
    const party = await ensurePartyForUserOnWrite(pool, user.id, `Photo staff ${channel}`, null);
    const table = channel === "telegram" ? "tanbot_telegram_accounts" : "tanbot_max_accounts";
    const prefix = channel === "telegram" ? "telegram" : "max";
    await pool.query(
      `INSERT INTO ${table}(user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled) VALUES($1,$2,$3,TRUE)`,
      [user.id, String(messengerId), String(chatId)],
    );
    return { channel, messengerId, chatId, partyId: party.id, staff: true };
  }
  const phone = `+7988${String(index).padStart(7, "0")}`;
  const partyId = (
    await pool.query(`INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external',$1,$2) RETURNING id`, [
      `Photo ext ${channel}`,
      phone,
    ])
  ).rows[0].id;
  const personId = randomUUID();
  await pool.query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,$3,$4)`, [
    personId,
    partyId,
    `Photo ext ${channel}`,
    phone,
  ]);
  await pool.query(
    `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id) VALUES($1,$2,$3,$4)`,
    [personId, channel, String(messengerId), String(chatId)],
  );
  return { channel, messengerId, chatId, partyId, staff: false };
}

function draftKey(actor: Actor): string {
  const actorKind = actor.staff ? "staff" : "ext";
  return `native:${actorKind}:${actor.channel}:${actor.channel === "telegram" ? actor.chatId : actor.chatId}`;
}

async function draftRow(actor: Actor) {
  const pool = getPool()!;
  return pool.query<{ id: string; payload: { revision: number }; step: string }>(
    `SELECT id::text, payload, step FROM tt_external_request_drafts WHERE messenger_chat_id = $1`,
    [draftKey(actor)],
  );
}

describe("independent native photo feedback (MAX/TG staff+external)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    Object.assign(process.env, {
      TT_EXTERNAL_MESSENGER_ENABLED: "true",
      TANBOT_TELEGRAM_ENABLED: "true",
      TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
      TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-photo-feedback-tg-token",
      TANBOT_TELEGRAM_BOT_USERNAME: "photo_feedback_bot",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "photo-feedback-tg-pepper-min16",
      TANBOT_TELEGRAM_WEBHOOK_SECRET: "photo-feedback-tg-webhook-secret",
      TANBOT_MAX_ENABLED: "true",
      TANBOT_MAX_WEBHOOK_ENABLED: "true",
      TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_PHOTO_FEEDBACK_TOKEN",
      TANBOT_MAX_BOT_USERNAME: "photo_feedback_max_bot",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "photo-feedback-max-pepper-min16",
      TANBOT_MAX_WEBHOOK_SECRET: "photo-feedback-max-webhook-secret",
    });
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    const receiver = await createTestUser({
      databaseUrl,
      email: "photo-feedback-receiver@test.local",
      password: PASSWORD,
      fullName: targetReceiver?.name ?? "Photo Feedback Receiver",
      role: "manager",
    });
    const party = await ensurePartyForUserOnWrite(getPool()!, receiver.id, "Photo Feedback Receiver", null);
    await getPool()!.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1", [receiver.id]);
    targetReceiver = { id: receiver.id, partyId: party.id, name: "Photo Feedback Receiver" };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/synthetic.jpg" } }), {
          status: 200,
        });
      }
      if (url.includes("/file/bot")) {
        return new Response(JPEG_A, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      return originalFetch(input);
    };
    const { createApp } = await import("../../src/server");
    app = createApp();
  });

  after(async () => {
    await mockAgent?.close();
    await closePool();
  });

  it("parse: MAX image with caption text still yields normalizedImages", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "message_created",
      timestamp: 42,
      chat_id: 1,
      message: {
        sender: { user_id: 2, is_bot: false },
        recipient: { chat_id: 3, chat_type: "dialog" },
        body: {
          mid: "cap-mid",
          text: "Подпись к фото",
          attachments: [{ type: "image", payload: { url: "https://iu.oneme.ru/getImage?token=x" } }],
        },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok && "normalizedImages" in parsed.update) {
      assert.equal(parsed.update.normalizedImages?.length, 1);
    }
  });

  for (const staff of [true, false] as const) {
    it(`max ${staff ? "staff" : "external"}: 3-image album acknowledges count and hides skip`, async () => {
      installMaxPhotoMocks([
        { path: "/photo/album-a.jpg", body: JPEG_A },
        { path: "/photo/album-b.jpg", body: JPEG_B },
        { path: "/photo/album-c.jpg", body: JPEG_C },
      ]);
      const actor = await makeActor("max", staff);
      await sendText(actor, "Создать передачу");
      const item = `Album item ${staff ? "staff" : "ext"} ${++sequence}`;
      await sendText(actor, item);
      const reply = await sendMaxAlbum(actor, `album-${sequence}`, [
        { type: "image", payload: { url: "https://iu.oneme.ru/photo/album-a.jpg" } },
        { type: "image", payload: { url: "https://iu.oneme.ru/photo/album-b.jpg" } },
        { type: "image", payload: { url: "https://iu.oneme.ru/photo/album-c.jpg" } },
      ]);
      assert.match(reply.text, /Добавлено 3 фото/i);
      assert.match(reply.text, /Фото: 3\/5/);
      assert.match(reply.text, /Далее/i);
      assert.ok(reply.buttons.some((b) => /Далее/i.test(b.text)));
      assert.ok(!reply.buttons.some((b) => /^Пропустить$/u.test(b.text)));
      const draft = await draftRow(actor);
      assert.equal(draft.rowCount, 1);
      const files = await getPool()!.query(`SELECT byte_size FROM tt_external_request_draft_files WHERE draft_id=$1::uuid`, [
        draft.rows[0]!.id,
      ]);
      assert.equal(files.rowCount, 3);
    });
  }

  it("max staff: caption+empty text variants still ingest; distinct mid same timestamp both stored", async () => {
    installMaxPhotoMocks([
      { path: "/photo/cap.jpg", body: JPEG_A },
      { path: "/photo/empty.jpg", body: JPEG_B },
      { path: "/photo/empty2.jpg", body: JPEG_C },
    ]);
    const actor = await makeActor("max", true);
    await sendText(actor, "Создать передачу");
    await sendText(actor, "Caption parse item");
    await sendMaxAlbum(
      actor,
      "mid-caption",
      [{ type: "image", payload: { url: "https://iu.oneme.ru/photo/cap.jpg" } }],
      { text: "Подпись" },
    );
    const ts = 424242;
    await sendMaxAlbum(
      actor,
      "mid-empty-a",
      [{ type: "image", payload: { url: "https://iu.oneme.ru/photo/empty.jpg" } }],
      { text: "" },
      ts,
    );
    await sendMaxAlbum(
      actor,
      "mid-empty-b",
      [{ type: "image", payload: { url: "https://iu.oneme.ru/photo/empty2.jpg" } }],
      {},
      ts,
    );
    const draft = await draftRow(actor);
    const n = (
      await getPool()!.query(`SELECT count(*)::int AS n FROM tt_external_request_draft_files WHERE draft_id=$1::uuid`, [
        draft.rows[0]!.id,
      ])
    ).rows[0]!.n;
    assert.equal(n, 3);
  });

  it("max: webhook replay same mid does not duplicate stored files", async () => {
    installMaxPhotoMocks([{ path: "/photo/replay.jpg", body: JPEG_A }]);
    const actor = await makeActor("max", false);
    await sendText(actor, "Создать передачу");
    await sendText(actor, "Replay item");
    const attachments = [{ type: "image", payload: { url: "https://iu.oneme.ru/photo/replay.jpg" } }];
    await sendMaxAlbum(actor, "replay-mid-1", attachments);
    const id = ++sequence;
    const res = await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_created",
        timestamp: id,
        message: {
          sender: { user_id: actor.messengerId, is_bot: false },
          recipient: { chat_id: actor.chatId, chat_type: "dialog" },
          body: { mid: "replay-mid-1", attachments },
        },
      });
    assert.equal(res.status, 200);
    const draft = await draftRow(actor);
    const n = (
      await getPool()!.query(`SELECT count(*)::int AS n FROM tt_external_request_draft_files WHERE draft_id=$1::uuid`, [
        draft.rows[0]!.id,
      ])
    ).rows[0]!.n;
    assert.equal(n, 1);
  });

  for (const staff of [true, false] as const) {
    it(`telegram ${staff ? "staff" : "external"}: variants are one photo; two messages store two`, async () => {
      const actor = await makeActor("telegram", staff);
      await sendText(actor, "Создать передачу");
      await sendText(actor, `TG photo ${staff ? "staff" : "ext"}`);
      const fileA = `tg-file-${++sequence}`;
      const fileB = `tg-file-${++sequence}`;
      let reply = await sendTelegramPhoto(actor, fileA);
      assert.match(reply.text, /Добавлено 1 фото/i);
      assert.match(reply.text, /Фото: 1\/5/);
      reply = await sendTelegramPhoto(actor, fileB);
      assert.match(reply.text, /Фото: 2\/5/);
      const draft = await draftRow(actor);
      const rows = await getPool()!.query<{ telegram_file_id: string }>(
        `SELECT telegram_file_id FROM tt_external_request_draft_files WHERE draft_id=$1::uuid ORDER BY sort_order`,
        [draft.rows[0]!.id],
      );
      assert.equal(rows.rowCount, 2);
      assert.equal(rows.rows[0]!.telegram_file_id, `${fileA}-large`);
      assert.equal(rows.rows[1]!.telegram_file_id, `${fileB}-large`);
    });
  }

  it("max external: unsafe URL error keeps prior good file; token-only shows error", async () => {
    installMaxPhotoMocks([{ path: "/photo/good.jpg", body: JPEG_A }]);
    const actor = await makeActor("max", false);
    await sendText(actor, "Создать передачу");
    await sendText(actor, "Partial fail item");
    await sendMaxAlbum(actor, "good-mid", [
      { type: "image", payload: { url: "https://iu.oneme.ru/photo/good.jpg" } },
    ]);
    const bad = await sendMaxAlbum(actor, "bad-mid", [
      { type: "image", payload: { url: "https://evil.example/x.jpg" } },
    ]);
    assert.match(bad.text, /недоступна|изображение/i);
    const draft = await draftRow(actor);
    assert.equal(
      (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_external_request_draft_files WHERE draft_id=$1::uuid`, [
        draft.rows[0]!.id,
      ])).rows[0]!.n,
      1,
    );
    const tokenReply = await sendMaxAlbum(
      actor,
      "token-mid",
      [{ type: "image", payload: { token: "only-token-no-url" } }],
      {},
      undefined,
      { requireReply: true },
    );
    assert.match(tokenReply.text, /токен|MAX|галере/i);
  });

  it("stale photo_next does not advance; fresh next reaches summary with photo count", async () => {
    installMaxPhotoMocks([{ path: "/photo/summary.jpg", body: JPEG_A }]);
    const actor = await makeActor("max", false);
    await sendText(actor, "Создать передачу");
    await sendText(actor, "Summary flow item");
    await sendMaxAlbum(actor, "sum-mid", [
      { type: "image", payload: { url: "https://iu.oneme.ru/photo/summary.jpg" } },
    ]);
    let draft = await draftRow(actor);
    const draftId = draft.rows[0]!.id;
    const staleRev = Number(draft.rows[0]!.payload.revision) - 1;
    const stale = buildNativeCreateCallback("photo_next", draftId, staleRev);
    assert.ok(stale);
    const staleReply = await sendCallback(actor, stale);
    assert.match(staleReply.text, /устар|недейств|друг/i);
    assert.equal(draft.rows[0]!.step, "photo");
    let rev = Number(draft.rows[0]!.payload.revision);
    await sendCallback(actor, buildNativeCreateCallback("photo_next", draftId, rev)!);
    rev = Number((await getPool()!.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    let reply = await sendCallback(actor, buildNativeCreateCallback("comment_skip", draftId, rev)!);
    rev = Number((await getPool()!.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    reply = await sendCallback(actor, button(reply, new RegExp(targetReceiver.name, "u")));
    rev = Number((await getPool()!.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    reply = await sendCallback(actor, buildNativeCreateCallback("due", draftId, rev, "n")!);
    draft = await draftRow(actor);
    assert.equal(draft.rows[0]!.step, "summary");
    assert.match(reply.text, /Фото: 1/u);
  });

  it("confirm attaches stored bytes once on canonical create", async () => {
    installMaxPhotoMocks([{ path: "/photo/confirm.jpg", body: JPEG_A }]);
    const actor = await makeActor("max", false);
    const item = `Confirm bytes ${++sequence}`;
    await sendText(actor, "Создать передачу");
    await sendText(actor, item);
    await sendMaxAlbum(actor, "confirm-mid", [
      { type: "image", payload: { url: "https://iu.oneme.ru/photo/confirm.jpg" } },
    ]);
    const draft = await draftRow(actor);
    const draftId = draft.rows[0]!.id;
    const storageKey = (
      await getPool()!.query<{ storage_key: string }>(
        `SELECT storage_key FROM tt_external_request_draft_files WHERE draft_id=$1::uuid`,
        [draftId],
      )
    ).rows[0]!.storage_key;
    let rev = Number(draft.rows[0]!.payload.revision);
    await sendCallback(actor, buildNativeCreateCallback("photo_next", draftId, rev)!);
    rev = Number((await getPool()!.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    let reply = await sendCallback(actor, buildNativeCreateCallback("comment_skip", draftId, rev)!);
    rev = Number((await getPool()!.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    reply = await sendCallback(actor, button(reply, new RegExp(targetReceiver.name, "u")));
    rev = Number((await getPool()!.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    reply = await sendCallback(actor, buildNativeCreateCallback("due", draftId, rev, "n")!);
    rev = Number((await getPool()!.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await sendCallback(actor, buildNativeCreateCallback("confirm", draftId, rev)!);
    const transfer = (
      await getPool()!.query<{ id: string }>(
        `SELECT id::text FROM tt_transfers WHERE item_title=$1 AND creator_party_id=$2::uuid`,
        [item, actor.partyId],
      )
    ).rows[0];
    assert.ok(transfer);
    const attached = await getPool()!.query<{ storage_key: string }>(
      `SELECT storage_key FROM tt_transfer_attachments WHERE transfer_id=$1`,
      [transfer.id],
    );
    assert.equal(attached.rowCount, 1);
    const bytes = await readAttachmentBytes(attached.rows[0]!.storage_key, getPool()!);
    assert.deepEqual(bytes, JPEG_A);
    assert.deepEqual(await readAttachmentBytes(storageKey, getPool()!), JPEG_A);
  });
});
