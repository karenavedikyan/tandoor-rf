import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { prepareDatabase, getIntegrationDatabaseUrl, setIntegrationEnv, createTestUser } from "../helpers/test-db";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { runTanbotOutboxWorkerOnce } from "../../src/tanbot-telegram/outbox-scheduler";
import { createRecordingTelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";

test("independent: Telegram invitation → own contact → sender verifies → one rich receipt, public preview never contains credentials", async () => {
  const db = getIntegrationDatabaseUrl(), origin = "http://127.0.0.1:3000";
  setIntegrationEnv(db, origin);
  Object.assign(process.env, {
    TT_OTP_PEPPER: "independent-telegram-receipt-pepper",
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "true",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-synthetic-receipt-token-0123456789",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_test_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-link-pepper-min16",
    TANBOT_MAX_ENABLED: "false",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  const app = createApp(), pool = getPool()!;
  const originalFetch = globalThis.fetch;
  let unexpectedFetches = 0;
  globalThis.fetch = async () => { unexpectedFetches++; throw new Error("Live fetch forbidden in synthetic bot test"); };
  try {
    await createTestUser({ databaseUrl: db, email: "ind-tg-holder@test.local",
      password: "StrongPass123!", fullName: "Synthetic Sender", role: "admin" });
    const login = await request(app).post("/api/auth/login").set("Origin", origin)
      .send({ email: "ind-tg-holder@test.local", password: "StrongPass123!" });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const authenticated = (path: string, data: Record<string, unknown>) => request(app).post(path)
      .set({ Origin: origin, Cookie: cookie }).send(data);
    const create = await authenticated("/api/tan-tracker/transfers", {
      item: "Документы для получателя",
      finalRecipientExternal: { name: "Synthetic Recipient", phone: "+79993336604" },
    });
    assert.equal(create.status, 201);
    const publicCode = create.body.publicCode, pendingParty = create.body.bootstrap.orders[0].pendingId;
    // The same person has MAX too: an invitation accepted in Telegram must not fan out there.
    const client = await pool.connect();
    try {
      await upsertVerifiedPerson(client, { channel: "max", messengerUserId: 885505n,
        messengerChatId: 885505n, phoneRaw: "+79993336604", displayName: "Synthetic Recipient" });
    } finally { client.release(); }
    const invitation = await authenticated(`/api/tan-tracker/transfers/${publicCode}/messenger-invite`, {});
    assert.equal(invitation.status, 201);
    const config = loadTanbotTelegramStage2Config();
    assert.ok(config.ok);
    if (!config.ok) throw new Error("synthetic Telegram config must load");
    const baseMessage = { chat: { id: 885504, type: "private" },
      from: { id: 885504, is_bot: false, first_name: "Synthetic Recipient" } };
    const start = await handleTanbotTelegramUpdate(pool, config.config, {
      update_id: 680001, message: { ...baseMessage, message_id: 1, date: 1,
        text: `/start ${invitation.body.startToken}` },
    });
    assert.ok(start.reply?.replyMarkup);
    const before = (await pool.query(`SELECT holder_party_id,handoff_version FROM tt_transfers WHERE public_code=$1`,
      [publicCode])).rows[0];
    const contact = await handleTanbotTelegramUpdate(pool, config.config, {
      update_id: 680002, message: { ...baseMessage, message_id: 2, date: 2,
        contact: { phone_number: "+79993336604", user_id: 885504, first_name: "Synthetic Recipient" } },
    });
    const code = contact.reply?.text.match(/\b(\d{6})\b/)?.[1];
    assert.ok(code, "the actual verified contact gets a code");
    assert.deepEqual((await pool.query(`SELECT holder_party_id,handoff_version FROM tt_transfers WHERE public_code=$1`,
      [publicCode])).rows[0], before, "code alone must not transfer custody");
    const received = await authenticated(`/api/tan-tracker/transfers/${publicCode}/code/verify`, { code });
    assert.equal(received.status, 200);
    const rows = (await pool.query(`SELECT o.channel,o.event_type FROM tt_external_person_message_outbox o
      JOIN tt_external_persons p ON p.id=o.person_id WHERE p.party_id=$1::uuid`, [pendingParty])).rows;
    assert.deepEqual(rows, [{ channel: "telegram", event_type: "external_person.delivered" }]);
    const sink = { calls: [] as Array<{ method: string; body: Record<string, unknown> }> };
    const transport = createRecordingTelegramDeliveryTransport(sink);
    await runTanbotOutboxWorkerOnce(pool, config.config, transport);
    const receipt = sink.calls.filter(c => {
      const t = String(c.body.text);
      return t.includes("Вы получили") && t.includes("Передача ");
    }).at(-1);
    assert.ok(receipt);
    assert.equal(String(receipt.body.chat_id), "885504");
    assert.match(String(receipt.body.text), /историю.*передать предмет дальше.*вернуть отправителю/);
    assert.ok(!String(receipt.body.text).includes("cap="));
    assert.ok(!String(receipt.body.text).includes("tt_hat="));
    assert.equal(receipt.body.parse_mode, undefined, "item text must remain literal");
    const buttons = (receipt.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; url: string }>> })
      .inline_keyboard.flat();
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].text, "Открыть передачу");
    const holder = new URL(buttons[0].url);
    assert.equal(holder.origin, origin);
    assert.ok(holder.searchParams.get("cap"));
    assert.ok(holder.searchParams.get("tt_hat"));
    const preview = receipt.body.link_preview_options as { is_disabled?: boolean; url?: string };
    assert.equal(preview.is_disabled, false);
    const safe = new URL(preview.url!);
    assert.equal(safe.origin, origin);
    assert.equal(safe.pathname.replace(/\/$/, ""), "/tan-tracker");
    assert.equal(safe.search, "");
    assert.equal(safe.hash, "");
    const sentCount = sink.calls.length;
    await runTanbotOutboxWorkerOnce(pool, config.config, transport);
    assert.equal(sink.calls.length, sentCount, "repeated worker tick must not duplicate receipt or private replies");
    assert.equal(unexpectedFetches, 0, "every bot send must use recording transport");
  } finally { globalThis.fetch = originalFetch; await closePool(); }
});
