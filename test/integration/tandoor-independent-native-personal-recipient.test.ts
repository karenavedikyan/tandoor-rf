import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import { TT_PERSONAL_RECIPIENT_LABEL_SET } from "../../src/tan-tracker/personal-recipient-label";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { withTransaction } from "../../src/access/db";

type Channel = "telegram" | "max";
type Button = { text: string; callback_data?: string; payload?: string };
type Reply = { text: string; buttons: Button[]; messages?: Array<{ text: string; buttons: Button[] }> };
type Actor = { channel: Channel; messengerId: number; chatId: number; partyId: string; staffId?: string };

const databaseUrl = getIntegrationDatabaseUrl();
const origin = "http://127.0.0.1:3000";
let app: ReturnType<typeof import("../../src/server").createApp>;
let sequence = 810000;
let targetA: { partyId: string; name: string };
let targetB: { partyId: string; name: string };

async function send(actor: Actor, text: string, callback?: string): Promise<Reply> {
  const id = ++sequence;
  const sends: Reply[] = [];
  if (actor.channel === "telegram") {
    const response = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send(callback ? {
        update_id: id,
        callback_query: {
          id: `prl-native-${id}`,
          data: callback,
          from: { id: actor.messengerId, is_bot: false },
          message: { message_id: id, chat: { id: actor.chatId, type: "private" } },
        },
      } : {
        update_id: id,
        message: {
          message_id: id,
          from: { id: actor.messengerId, is_bot: false, first_name: "Synthetic" },
          chat: { id: actor.chatId, type: "private" },
          text,
        },
      });
    assert.equal(response.status, 200, JSON.stringify(response.body));
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
  } else {
    const response = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send(callback ? {
        update_type: "message_callback",
        timestamp: id,
        callback: { callback_id: `prl-native-${id}`, payload: callback, user: { user_id: actor.messengerId, is_bot: false } },
        message: { recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: actor.messengerId }, body: { mid: `prl-${id}` } },
      } : {
        update_type: "message_created",
        timestamp: id,
        message: {
          sender: { user_id: actor.messengerId, is_bot: false, first_name: "Synthetic" },
          recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: 999000 },
          body: { mid: `prl-${id}`, text },
        },
      });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const loaded = loadTanbotMaxStage2Config();
    assert.ok(loaded.ok);
    const transport: MaxDeliveryTransport = async (input) => {
      sends.push({ text: input.text, buttons: input.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `recorded-${id}` } } } };
    };
    await processUndeliveredMaxWebhookReplies(getPool()!, loaded.config, transport, { deliveryEnabled: true });
  }
  assert.ok(sends.length, "expected bot reply");
  return { ...sends.at(-1)!, messages: sends };
}

function action(reply: Reply, label: RegExp): string {
  const found = reply.buttons.find((b) => label.test(b.text));
  assert.ok(found, `Missing button ${label}: ${JSON.stringify(reply)}`);
  const value = found.callback_data ?? found.payload;
  assert.ok(value, `callback required: ${JSON.stringify(found)}`);
  return value;
}

async function actor(channel: Channel, staff: boolean): Promise<Actor> {
  const index = ++sequence;
  const messengerId = index;
  const chatId = channel === "telegram" ? messengerId : messengerId + 100000;
  const pool = getPool()!;
  if (staff) {
    const user = await createTestUser({
      databaseUrl,
      email: `prl-native-staff-${channel}-${index}@test.local`,
      password: "StrongPass123!",
      fullName: `PRL Staff ${channel}`,
      role: "admin",
    });
    const party = await ensurePartyForUserOnWrite(pool, user.id, `PRL Staff ${channel}`, null);
    const table = channel === "telegram" ? "tanbot_telegram_accounts" : "tanbot_max_accounts";
    const prefix = channel === "telegram" ? "telegram" : "max";
    await pool.query(
      `INSERT INTO ${table}(user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled) VALUES($1,$2,$3,TRUE)`,
      [user.id, String(messengerId), String(chatId)],
    );
    return { channel, messengerId, chatId, partyId: party.id, staffId: user.id };
  }
  const phone = `+7998${String(index).padStart(7, "0")}`;
  const partyId = (
    await pool.query(`INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external',$1,$2) RETURNING id`, [
      `PRL Ext ${channel}`,
      phone,
    ])
  ).rows[0].id;
  const personId = randomUUID();
  await pool.query(
    `INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,$3,$4)`,
    [personId, partyId, `PRL Ext ${channel}`, phone],
  );
  await pool.query(
    `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id) VALUES($1,$2,$3,$4)`,
    [personId, channel, String(messengerId), String(chatId)],
  );
  return { channel, messengerId, chatId, partyId };
}

async function staffWalkToSummary(sender: Actor, item: string, recipientName: RegExp): Promise<Reply> {
  let reply = await send(sender, "Создать передачу");
  reply = await send(sender, item);
  reply = await send(sender, "", action(reply, /пропустить/iu));
  reply = await send(sender, "", action(reply, /пропустить/iu));
  reply = await send(sender, "Synthetic Native");
  reply = await send(sender, "", action(reply, recipientName));
  return send(sender, "", action(reply, /завтра/iu));
}

async function externalWalkToSummary(sender: Actor, item: string, phone: string, extName: string): Promise<Reply> {
  let reply = await send(sender, "Создать передачу");
  reply = await send(sender, item);
  reply = await send(sender, "", action(reply, /пропустить/iu));
  reply = await send(sender, "", action(reply, /пропустить/iu));
  reply = await send(sender, phone);
  assert.match(reply.text, /имя/i);
  reply = await send(sender, extName);
  return send(sender, "", action(reply, /завтра/iu));
}

describe("native bot personal recipient name (webhook PG)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, origin);
    Object.assign(process.env, {
      TT_OTP_PEPPER: "prl-native-pepper-min-16-ch",
      TT_EXTERNAL_MESSENGER_ENABLED: "true",
      TANBOT_TELEGRAM_ENABLED: "true",
      TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
      TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-prl-native-token-0123456789",
      TANBOT_TELEGRAM_BOT_USERNAME: "prl_native_bot",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "prl-telegram-link-pepper-min16",
      TANBOT_TELEGRAM_WEBHOOK_SECRET: "prl-telegram-webhook-secret-min16",
      TANBOT_MAX_ENABLED: "true",
      TANBOT_MAX_WEBHOOK_ENABLED: "true",
      TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "PRL_NATIVE_MAX_TEST_TOKEN_0123456789ab",
      TANBOT_MAX_BOT_USERNAME: "prl_native_max_bot",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "prl-max-link-pepper-min16",
      TANBOT_MAX_WEBHOOK_SECRET: "prl-max-webhook-secret-min16",
    });
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    app = createApp();
    const pool = getPool()!;
    const recvA = await createTestUser({
      databaseUrl,
      email: "prl-native-recv-a@test.local",
      password: "StrongPass123!",
      fullName: "Synthetic Native Receiver",
      role: "manager",
    });
    const recvB = await createTestUser({
      databaseUrl,
      email: "prl-native-recv-b@test.local",
      password: "StrongPass123!",
      fullName: "Other Native Receiver",
      role: "manager",
    });
    const partyA = await ensurePartyForUserOnWrite(pool, recvA.id, "Synthetic Native Receiver", "+79990001122");
    const partyB = await ensurePartyForUserOnWrite(pool, recvB.id, "Other Native Receiver", "+79990003344");
    targetA = { partyId: partyA.id, name: "Synthetic Native Receiver" };
    targetB = { partyId: partyB.id, name: "Other Native Receiver" };
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE, phone='+79990001122' WHERE id=$1", [recvA.id]);
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE, phone='+79990003344' WHERE id=$1", [recvB.id]);
  });

  after(async () => {
    await closePool();
  });

  for (const channel of ["telegram", "max"] as const) {
    it(`${channel} staff: summary → personal name → summary → confirm stores owner-only audit label`, async () => {
      const sender = await actor(channel, true);
      const item = `PRL staff personal ${channel} ${++sequence}`;
      const privateName = `Staff private ${channel}`;
      let reply = await staffWalkToSummary(sender, item, /Synthetic Native Receiver/u);
      reply = await send(sender, "", action(reply, /Имя для меня/u));
      reply = await send(sender, privateName);
      assert.match(reply.text, new RegExp(`Имя для меня: ${privateName}`));
      assert.match(reply.text, /Получатель \(справочник\): Synthetic Native Receiver/u);
      reply = await send(sender, "", action(reply, /создать передачу/iu));
      const row = (
        await getPool()!.query(
          `SELECT id::text, pending_party_id::text FROM tt_transfers WHERE creator_party_id=$1 AND item_title=$2`,
          [sender.partyId, item],
        )
      ).rows[0];
      assert.ok(row);
      const audit = await getPool()!.query(
        `SELECT detail FROM tt_audit_log WHERE transfer_id=$1 AND acting_party_id=$2 AND action=$3`,
        [row.id, sender.partyId, TT_PERSONAL_RECIPIENT_LABEL_SET],
      );
      assert.equal(audit.rowCount, 1);
      assert.equal(audit.rows[0].detail.personalName, privateName);
      assert.equal(audit.rows[0].detail.recipientPartyId, row.pending_party_id);
      const partyName = (
        await getPool()!.query(`SELECT display_name FROM tt_parties WHERE id=$1::uuid`, [row.pending_party_id])
      ).rows[0].display_name;
      assert.equal(partyName, "Synthetic Native Receiver");
    });

    it(`${channel} external: summary → personal name → confirm; invitation stays canonical`, async () => {
      const sender = await actor(channel, false);
      const item = `PRL ext personal ${channel} ${++sequence}`;
      const canonical = "Canonical Ext Recipient Label";
      const privateName = `Ext private ${channel}`;
      let reply = await externalWalkToSummary(sender, item, "+79990001122", canonical);
      reply = await send(sender, "", action(reply, /Имя для меня/u));
      reply = await send(sender, privateName);
      assert.match(reply.text, new RegExp(`Имя для меня: ${privateName}`));
      assert.match(reply.text, new RegExp(`Получатель \\(справочник\\): ${canonical}`));
      reply = await send(sender, "", action(reply, /создать передачу/iu));
      const transfer = (
        await getPool()!.query(`SELECT id::text, public_code FROM tt_transfers WHERE creator_party_id=$1 AND item_title=$2`, [
          sender.partyId,
          item,
        ])
      ).rows[0];
      assert.ok(transfer);
      const audit = await getPool()!.query(
        `SELECT detail FROM tt_audit_log WHERE transfer_id=$1 AND acting_party_id=$2 AND action=$3`,
        [transfer.id, sender.partyId, TT_PERSONAL_RECIPIENT_LABEL_SET],
      );
      assert.equal(audit.rowCount, 1);
      assert.equal(audit.rows[0].detail.personalName, privateName);
      const inviteMsg = reply.messages?.find((m) => /Получатель:/u.test(m.text)) ?? reply;
      assert.match(inviteMsg.text, /Получатель: Synthetic Native Receiver/u);
      assert.doesNotMatch(inviteMsg.text, new RegExp(privateName));
      const portal = (inviteMsg.text.match(/https?:\/\/[^\s)]+/g) ?? [])[0];
      assert.ok(portal);
      const mst = new URL(portal).searchParams.get("mst");
      assert.ok(mst);
      const pub = await request(app).get("/api/tan-tracker/public/recipient/messenger").query({ mst });
      assert.equal(pub.status, 200);
      assert.equal(pub.body.transferPublicCode, transfer.public_code);
      assert.doesNotMatch(JSON.stringify(pub.body), new RegExp(privateName));
    });
  }

  it("telegram: changing recipient clears personal name before confirm", async () => {
    const sender = await actor("telegram", true);
    const item = `PRL recipient swap ${++sequence}`;
    let reply = await staffWalkToSummary(sender, item, /Synthetic Native Receiver/u);
    reply = await send(sender, "", action(reply, /Имя для меня/u));
    reply = await send(sender, "Swap me away");
    assert.match(reply.text, /Имя для меня: Swap me away/u);
    reply = await send(sender, "", action(reply, /Изменить данные/u));
    reply = await send(sender, "", action(reply, /^Получатель$/u));
    reply = await send(sender, "Other Native");
    reply = await send(sender, "", action(reply, /Other Native Receiver/u));
    assert.doesNotMatch(reply.text, /Имя для меня:/u);
    assert.match(reply.text, /Other Native Receiver/u);
    const draft = await getPool()!.query(
      `SELECT payload FROM tt_external_request_drafts WHERE payload->>'staffUserId'=$1 AND confirmed_transfer_id IS NULL ORDER BY created_at DESC LIMIT 1`,
      [sender.staffId],
    );
    assert.equal(draft.rowCount, 1);
    assert.equal(draft.rows[0].payload.recipientPersonalNameForMe, undefined);
  });
});
