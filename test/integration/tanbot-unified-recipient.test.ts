import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";

const db = getIntegrationDatabaseUrl();
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 960000;

type Reply = { text: string; buttons: Array<{ text: string; callback_data?: string; payload?: string }> };

before(async () => {
  setIntegrationEnv(db, "http://127.0.0.1:3000");
  Object.assign(process.env, {
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-unified-recipient-test",
    TANBOT_TELEGRAM_BOT_USERNAME: "unified_recipient_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "unified-recipient-pepper-min16",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "unified-recipient-webhook-secret",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  const target = await createTestUser({
    databaseUrl: db,
    email: "unified-target@test.local",
    password: "StrongPass123!",
    fullName: "Unified Target Manager",
    role: "manager",
  });
  await ensurePartyForUserOnWrite(getPool()!, target.id, "Unified Target Manager", "+79990003344");
  await getPool()!.query(
    "UPDATE users SET accepts_external_tt_intake=TRUE, phone='+79990003344' WHERE id=$1",
    [target.id],
  );
  const { createApp } = await import("../../src/server");
  app = createApp();
});

after(closePool);

async function staffSend(tgId: number, body: Record<string, unknown>): Promise<Reply> {
  const id = ++seq;
  const replies: Reply[] = [];
  const res = await request(app)
    .post("/api/tanbot-telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
    .send(body.update_id ? body : { update_id: id, ...body });
  assert.equal(res.status, 200);
  const cfg = loadTanbotTelegramStage2Config();
  assert.ok(cfg.ok);
  await processUndeliveredTelegramWebhookReplies(getPool()!, cfg.config, async (p) => {
    if (p.method === "sendMessage") {
      const m = p.body.reply_markup as { inline_keyboard?: Reply["buttons"][] } | undefined;
      replies.push({ text: String(p.body.text), buttons: (m?.inline_keyboard ?? []).flat() });
    }
    return { ok: true, result: { message_id: id } };
  }, { deliveryEnabled: true });
  assert.ok(replies.length);
  return replies.at(-1)!;
}

async function staffActor(): Promise<number> {
  const id = ++seq;
  const user = await createTestUser({
    databaseUrl: db,
    email: `unified-staff-${id}@test.local`,
    password: "StrongPass123!",
    fullName: "Unified Staff Sender",
    role: "admin",
  });
  await ensurePartyForUserOnWrite(getPool()!, user.id, "Unified Staff Sender", null);
  await getPool()!.query(
    `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
     VALUES ($1,$2,$2,TRUE)`,
    [user.id, String(id)],
  );
  return id;
}

function btn(r: Reply, re: RegExp): string {
  const b = r.buttons.find((x) => re.test(x.text));
  assert.ok(b, JSON.stringify(r));
  return b.callback_data ?? b.payload!;
}

describe("tanbot unified recipient (author integration)", { concurrency: false }, () => {
  it("staff recipient step shows unified prompt without internal/external buttons", async () => {
    const tg = await staffActor();
    const priv = { chat: { id: tg, type: "private" }, from: { id: tg, is_bot: false } };
    let r = await staffSend(tg, { message: { message_id: 1, ...priv, text: "Создать передачу" } });
    r = await staffSend(tg, { message: { message_id: 2, ...priv, text: "Unified item" } });
    r = await staffSend(tg, { callback_query: { id: "c1", data: btn(r, /пропустить/i), from: priv.from, message: { message_id: 2, chat: priv.chat } } });
    r = await staffSend(tg, { callback_query: { id: "c2", data: btn(r, /пропустить/i), from: priv.from, message: { message_id: 2, chat: priv.chat } } });
    assert.match(r.text, /кому передаёте/i);
    assert.match(r.text, /имя.*фамили.*телефон.*контакт/is);
    assert.ok(!r.buttons.some((b) => /внешний получатель/i.test(b.text)));
    assert.ok(!r.buttons.some((b) => /внутренн/i.test(b.text)));
  });

  it("staff name search returns eligible manager button", async () => {
    const tg = await staffActor();
    const priv = { chat: { id: tg, type: "private" }, from: { id: tg, is_bot: false } };
    let r = await staffSend(tg, { message: { message_id: 1, ...priv, text: "Создать передачу" } });
    r = await staffSend(tg, { message: { message_id: 2, ...priv, text: "Item" } });
    r = await staffSend(tg, { callback_query: { id: "c1", data: btn(r, /пропустить/i), from: priv.from, message: { message_id: 2, chat: priv.chat } } });
    r = await staffSend(tg, { callback_query: { id: "c2", data: btn(r, /пропустить/i), from: priv.from, message: { message_id: 2, chat: priv.chat } } });
    r = await staffSend(tg, { message: { message_id: 3, ...priv, text: "Unified Target" } });
    assert.ok(r.buttons.some((b) => /Unified Target Manager/i.test(b.text)));
  });

  it("external name query does not expose staff directory in reply text", async () => {
    const tg = ++seq;
    const phone = `+7999${String(tg).padStart(7, "0")}`;
    const partyId = (
      await getPool()!.query(`INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Ext',$1) RETURNING id`, [
        phone,
      ])
    ).rows[0].id;
    const personId = randomUUID();
    await getPool()!.query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,'Ext',$3)`, [
      personId,
      partyId,
      phone,
    ]);
    await getPool()!.query(
      `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id) VALUES($1,'telegram',$2,$2)`,
      [personId, String(tg)],
    );
    const priv = { chat: { id: tg, type: "private" }, from: { id: tg, is_bot: false } };
    let r = await staffSend(tg, { message: { message_id: 1, ...priv, text: "Создать передачу" } });
    r = await staffSend(tg, { message: { message_id: 2, ...priv, text: "Ext item" } });
    r = await staffSend(tg, { callback_query: { id: "c1", data: btn(r, /пропустить/i), from: priv.from, message: { message_id: 2, chat: priv.chat } } });
    r = await staffSend(tg, { callback_query: { id: "c2", data: btn(r, /пропустить/i), from: priv.from, message: { message_id: 2, chat: priv.chat } } });
    r = await staffSend(tg, { message: { message_id: 3, ...priv, text: "Unified Target Manager" } });
    assert.doesNotMatch(r.text, /Unified Target Manager/i);
    assert.match(r.text, /телефон|контакт/i);
    assert.equal(r.buttons.filter((b) => /Unified Target/i.test(b.text)).length, 0);
  });
});
