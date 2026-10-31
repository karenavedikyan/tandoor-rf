import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";

type Channel = "telegram" | "max";
type Button = { text: string; callback_data?: string; payload?: string; url?: string };
type Reply = { text: string; buttons: Button[] };
type Actor = { channel: Channel; messengerId: number; chatId: number; partyId: string; staffId?: string };
const databaseUrl = getIntegrationDatabaseUrl();
const origin = "http://127.0.0.1:3000";
let app: ReturnType<typeof import("../../src/server").createApp>;
let sequence = 700000;
let unexpectedFetches = 0;
let originalFetch: typeof fetch;
let target: { id: string; name: string; partyId: string };

async function send(actor: Actor, text: string, callback?: string,
  options: { skipDrain?: boolean; chatType?: string | null } = {}): Promise<Reply> {
  const id = ++sequence;
  const sends: Reply[] = [];
  if (actor.channel === "telegram") {
    const response = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send(callback ? {
        update_id: id, callback_query: {
          id: `independent-native-${id}`, data: callback, from: { id: actor.messengerId, is_bot: false },
          message: { message_id: id, chat: { id: actor.chatId, type: options.chatType === undefined ? "private" : options.chatType ?? undefined } },
        },
      } : {
        update_id: id, message: {
          message_id: id, from: { id: actor.messengerId, is_bot: false, first_name: "Synthetic" },
          chat: { id: actor.chatId, type: options.chatType === undefined ? "private" : options.chatType ?? undefined }, text,
        },
      });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    if (options.skipDrain) return { text: "", buttons: [] };
    const loaded = loadTanbotTelegramStage2Config();
    assert.ok(loaded.ok);
    const transport: TelegramDeliveryTransport = async input => {
      if (input.method === "sendMessage") {
        const markup = input.body.reply_markup as { inline_keyboard?: Button[][]; keyboard?: Button[][] } | undefined;
        sends.push({ text: String(input.body.text), buttons: (markup?.inline_keyboard ?? markup?.keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: id } };
    };
    await processUndeliveredTelegramWebhookReplies(getPool()!, loaded.config, transport, { deliveryEnabled: true });
  } else {
    const response = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send(callback ? {
        update_type: "message_callback", timestamp: id,
        callback: { callback_id: `independent-native-${id}`, payload: callback,
          user: { user_id: actor.messengerId, is_bot: false } },
        message: { recipient: { chat_id: actor.chatId, chat_type: options.chatType === undefined ? "dialog" : options.chatType ?? undefined, user_id: actor.messengerId },
          body: { mid: `independent-native-${id}` } },
      } : {
        update_type: "message_created", timestamp: id,
        message: {
          sender: { user_id: actor.messengerId, is_bot: false, first_name: "Synthetic" },
          recipient: { chat_id: actor.chatId, chat_type: options.chatType === undefined ? "dialog" : options.chatType ?? undefined, user_id: 999000 },
          body: { mid: `independent-native-${id}`, text },
        },
      });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    if (options.skipDrain) return { text: "", buttons: [] };
    const loaded = loadTanbotMaxStage2Config();
    assert.ok(loaded.ok);
    const transport: MaxDeliveryTransport = async input => {
      assert.equal(input.userId, BigInt(actor.messengerId), "reply goes privately to the actual user");
      sends.push({ text: input.text, buttons: input.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `recorded-${id}` } } } };
    };
    await processUndeliveredMaxWebhookReplies(getPool()!, loaded.config, transport, { deliveryEnabled: true });
  }
  assert.ok(sends.length, "HTTP webhook must persist a reply and deliver it through recording transport");
  for (const reply of sends) for (const button of reply.buttons) {
    const value = button.callback_data ?? button.payload;
    if (value) assert.ok(Buffer.byteLength(value, "utf8") <= 64, "callback fits the real Telegram byte limit");
  }
  return sends.at(-1)!;
}

function action(reply: Reply, label: RegExp): string {
  const found = reply.buttons.find(b => label.test(b.text));
  assert.ok(found, `Missing button ${label}: ${JSON.stringify(reply)}`);
  const value = found.callback_data ?? found.payload;
  assert.ok(value, `Button must be a native callback, not a web link: ${JSON.stringify(found)}`);
  return value;
}

async function actor(channel: Channel, staff: boolean): Promise<Actor> {
  const index = ++sequence;
  const messengerId = index;
  const chatId = channel === "telegram" ? messengerId : messengerId + 100000;
  const pool = getPool()!;
  if (staff) {
    const user = await createTestUser({
      databaseUrl, email: `native-${channel}-${index}@test.local`, password: "StrongPass123!",
      fullName: `Synthetic native ${channel} staff`, role: "admin",
    });
    const party = await ensurePartyForUserOnWrite(pool, user.id, `Synthetic native ${channel} staff`, null);
    const table = channel === "telegram" ? "tanbot_telegram_accounts" : "tanbot_max_accounts";
    const prefix = channel === "telegram" ? "telegram" : "max";
    await pool.query(`INSERT INTO ${table}(user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled)
      VALUES($1,$2,$3,TRUE)`, [user.id, String(messengerId), String(chatId)]);
    return { channel, messengerId, chatId, partyId: party.id, staffId: user.id };
  }
  const phone = `+7999${String(index).padStart(7, "0")}`;
  const partyId = (await pool.query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external',$1,$2) RETURNING id`, [`Synthetic native ${channel} external`, phone])).rows[0].id;
  const personId = randomUUID();
  await pool.query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164)
    VALUES($1,$2,$3,$4)`, [personId, partyId, `Synthetic native ${channel} external`, phone]);
  await pool.query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
    VALUES($1,$2,$3,$4)`, [personId, channel, String(messengerId), String(chatId)]);
  return { channel, messengerId, chatId, partyId };
}

describe("independent native creation entry in both bots and both actor types", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, origin);
    Object.assign(process.env, {
      TT_OTP_PEPPER: "independent-native-create-pepper-min16",
      TT_EXTERNAL_MESSENGER_ENABLED: "true",
      TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
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
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { unexpectedFetches++; throw new Error("Real network forbidden in independent native creation test"); };
    const { createApp } = await import("../../src/server");
    app = createApp();
    const receiver = await createTestUser({
      databaseUrl, email: "native-independent-receiver@test.local", password: "StrongPass123!",
      fullName: "Synthetic Native Receiver", role: "manager",
    });
    const receiverParty =     await ensurePartyForUserOnWrite(getPool()!, receiver.id, "Synthetic Native Receiver", "+79990001122");
    await getPool()!.query("UPDATE users SET accepts_external_tt_intake=TRUE, phone='+79990001122' WHERE id=$1", [receiver.id]);
    target = { id: receiver.id, partyId: receiverParty.id, name: "Synthetic Native Receiver" };
  });
  after(async () => {
    globalThis.fetch = originalFetch;
    await closePool();
    assert.equal(unexpectedFetches, 0);
  });
  for (const channel of ["telegram", "max"] as const) {
    for (const staff of [true, false]) {
      it(`${channel}: ${staff ? "linked staff" : "verified external"} creates natively with edit and concurrent confirmation once`, async () => {
        const sender = await actor(channel, staff);
        let reply = await send(sender, "Создать передачу");
        assert.match(reply.text, /что.*переда|предмет|шаг 1/iu, "entry must open actual first content step, not a web link");
        const oldCancel = action(reply, /отмена|отменить/iu);
        assert.ok(!reply.buttons.some(b => b.url), "creation must not require opening LK");
        const transfers = await getPool()!.query("SELECT id FROM tt_transfers WHERE creator_party_id=$1", [sender.partyId]);
        assert.equal(transfers.rowCount, 0, "entering the wizard never creates a transfer");
        const item = `Independent native ${channel} ${staff ? "staff" : "external"}`;
        reply = await send(sender, item);
        reply = await send(sender, "", action(reply, /пропустить/iu));
        reply = await send(sender, "", action(reply, /пропустить/iu));
        if (staff) {
          reply = await send(sender, "Synthetic Native");
          reply = await send(sender, "", action(reply, /Synthetic Native Receiver/u));
        } else {
          reply = await send(sender, "+79990001122");
        }
        reply = await send(sender, "", action(reply, /завтра/iu));
        assert.match(reply.text, new RegExp(item));
        if (staff) {
          assert.match(reply.text, /Synthetic Native Receiver/u, "summary displays recipient name, not UUID");
        } else {
          assert.match(reply.text, /79990001122|Получатель/i, "external summary uses generic label, not staff profile");
        }
        assert.match(reply.text, /завтра/iu);
        reply = await send(sender, "", action(reply, /изменить/iu));
        reply = await send(sender, "", action(reply, /комментар/iu));
        const comment = "Edited native summary comment";
        reply = await send(sender, comment);
        assert.match(reply.text, /Edited native summary comment/u);
        if (staff) assert.match(reply.text, /Synthetic Native Receiver/u);
        else assert.match(reply.text, /79990001122|Получатель/i);
        assert.match(reply.text, /завтра/iu, "editing a comment preserves the due date");
        const confirm = action(reply, /создать/iu);
        await Promise.all([
          send(sender, "", confirm, { skipDrain: true }),
          send(sender, "", confirm, { skipDrain: true }),
        ]);
        const created = await getPool()!.query(`SELECT * FROM tt_transfers
          WHERE creator_party_id=$1 AND item_title=$2`, [sender.partyId, item]);
        assert.equal(created.rowCount, 1, "distinct concurrent callbacks create exactly one canonical transfer");
        const row = created.rows[0];
        assert.equal(row.holder_party_id, sender.partyId);
        assert.equal(row.pending_party_id, target.partyId);
        assert.equal(row.final_recipient_party_id, target.partyId);
        assert.equal(row.handoff_version, 1, "creation never confirms physical receipt");
        assert.equal(row.comment_text, comment);
        for (const table of ["tt_transfer_timeline", "tt_transfer_invitations"]) {
          const count = await getPool()!.query(`SELECT count(*)::int AS n FROM ${table} WHERE transfer_id=$1`, [row.id]);
          assert.equal(count.rows[0].n, 1, `${table} has no duplicate`);
        }
        await send(sender, "", confirm);
        assert.equal((await getPool()!.query("SELECT count(*)::int AS n FROM tt_transfers WHERE creator_party_id=$1", [sender.partyId])).rows[0].n, 1);
        reply = await send(sender, "Создать передачу");
        const freshCancel = action(reply, /отмена|отменить/iu);
        reply = await send(sender, "", oldCancel);
        assert.match(reply.text, /устар|недейств|друг/iu, "old cancel cannot delete a new draft");
        reply = await send(sender, "New surviving draft item");
        assert.ok(reply.buttons.some(b => /пропустить/iu.test(b.text)));
        // A button from the fresh item phase becomes stale after changing to photos.
        reply = await send(sender, "", freshCancel);
        assert.match(reply.text, /устар|недейств|друг/iu);
        reply = await send(sender, "Создать передачу");
        await send(sender, "", action(reply, /отмена|отменить/iu));
      });
    }
    it(`${channel}: staff creates for an external recipient with a usable canonical invitation`, async () => {
      const sender = await actor(channel, true);
      const item = `Synthetic staff-to-external ${channel} ${++sequence}`;
      const phone = `+7903${String(++sequence).padStart(7, "0")}`;
      let reply = await send(sender, "Создать передачу");
      reply = await send(sender, item);
      reply = await send(sender, "", action(reply, /^Пропустить$/u));
      reply = await send(sender, "", action(reply, /^Пропустить$/u));
      reply = await send(sender, phone);
      assert.match(reply.text, /имя/i);
      reply = await send(sender, "Synthetic External Recipient");
      assert.match(reply.text, /телефон/i);
      reply = await send(sender, "", action(reply, /^Далее$/u));
      reply = await send(sender, "", action(reply, /^Без срока$/u));
      assert.match(reply.text, /Synthetic External Recipient/);
      reply = await send(sender, "", action(reply, /^Создать передачу$/u));
      const transfer = (await getPool().query(
        `SELECT t.id,t.public_code,t.holder_party_id::text,t.pending_party_id::text,t.handoff_version,
                p.kind,p.display_name,p.phone_e164
         FROM tt_transfers t JOIN tt_parties p ON p.id=t.pending_party_id WHERE t.item_title=$1`, [item])).rows[0];
      assert.ok(transfer, "one canonical pending transfer was created");
      assert.equal(transfer.kind, "external");
      assert.equal(transfer.display_name, "Synthetic External Recipient");
      assert.equal(transfer.phone_e164, phone);
      assert.equal(transfer.holder_party_id, sender.partyId);
      assert.equal(transfer.handoff_version, 1);
      const links = (reply.text.match(/https?:\/\/[^\s)]+/g) ?? []).map(text => new URL(text));
      const portal = links.find(url => url.pathname === "/tan-tracker/recipient" && url.searchParams.has("mst"));
      assert.ok(portal, "a shareable recipient portal invitation is returned inside the bot");
      const response = await request(app).get("/api/tan-tracker/public/recipient/messenger")
        .query({ mst: portal.searchParams.get("mst") });
      assert.equal(response.status, 200, "the synthetic invitation token resolves through the canonical HTTP endpoint");
      assert.equal(response.body.transferPublicCode, transfer.public_code);
      assert.equal(response.body.itemTitle, item);
      assert.equal(response.body.featureEnabled, true);
      const messenger = links.find(url => url.hostname === (channel === "telegram" ? "t.me" : "max.ru"));
      assert.ok(messenger, "invitation offers the current messenger in addition to the recipient portal");
      assert.equal(messenger.searchParams.get("start"), portal.searchParams.get("mst"));
      assert.equal((await getPool().query("SELECT count(*) FROM tt_transfers WHERE item_title=$1", [item])).rows[0].count, "1");
    });

    it(`${channel}: group, missing context and mismatched private binding cannot mutate a native draft`, async () => {
      const sender = await actor(channel, true);
      await send(sender, "Создать передачу");
      const snapshot = async () => (await getPool()!.query(`SELECT id,step,payload FROM tt_external_request_drafts
        WHERE payload->>'staffUserId'=$1 AND confirmed_transfer_id IS NULL`, [sender.staffId])).rows;
      const before = await snapshot();
      assert.equal(before.length, 1);
      await send(sender, "Group input must not be an item", undefined,
        { skipDrain: true, chatType: channel === "max" ? "chat" : "group" });
      assert.deepEqual(await snapshot(), before);
      await send(sender, "Missing private context must not be an item", undefined,
        { skipDrain: true, chatType: null });
      assert.deepEqual(await snapshot(), before);
      await send({ ...sender, chatId: sender.chatId + 99999 }, "Wrong private binding input", undefined,
        { skipDrain: true });
      assert.deepEqual(await snapshot(), before);
      await send({ ...sender, chatId: sender.chatId + 99999 }, "Создать передачу", undefined,
        { skipDrain: true });
      assert.deepEqual(await snapshot(), before, "an unbound private chat cannot create a second native draft");
      await getPool()!.query("UPDATE users SET role='analyst' WHERE id=$1", [sender.staffId]);
      await send(sender, "Excluded role input must not be an item", undefined, { skipDrain: true });
      assert.deepEqual(await snapshot(), before, "excluded LK role cannot bypass permissions through the bot");
    });
  }
  it("HTTP/LK canonical create keeps its original audit provenance", async () => {
    const sender = await actor("telegram", true);
    const email = (await getPool()!.query("SELECT email FROM users WHERE id=$1", [sender.staffId])).rows[0].email;
    const session = request.agent(app);
    const login = await session.post("/api/auth/login").set("Origin", origin).send({ email, password: "StrongPass123!" });
    assert.equal(login.status, 200);
    const item = "Independent ordinary LK create audit";
    const response = await session.post("/api/tan-tracker/transfers").set("Origin", origin)
      .send({ item, finalRecipientPartyId: target.partyId });
    assert.equal(response.status, 201);
    const rows = (await getPool()!.query(`SELECT a.detail FROM tt_audit_log a JOIN tt_transfers t ON t.id=a.transfer_id
      WHERE t.creator_party_id=$1 AND t.item_title=$2 AND a.action='create'`, [sender.partyId, item])).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].detail, { item }, "extracting shared service must not label ordinary LK writes as native_bot");
  });
});
