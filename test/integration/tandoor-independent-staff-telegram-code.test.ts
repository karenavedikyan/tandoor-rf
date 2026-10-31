import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { prepareDatabase, getIntegrationDatabaseUrl, setIntegrationEnv, createTestUser } from "../helpers/test-db";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { processTanbotNotificationOutbox } from "../../src/tanbot-telegram/outbox-worker";
import { runTanbotOutboxWorkerOnce } from "../../src/tanbot-telegram/outbox-scheduler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";

test("independent: real external draft → Telegram intended recipient callback → sender verifies; issuance alone never receives", async () => {
  const db = getIntegrationDatabaseUrl();
  const origin = "http://127.0.0.1:3000";
  setIntegrationEnv(db, origin);
  Object.assign(process.env, {
    TT_OTP_PEPPER: "independent-staff-handoff-test-pepper",
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-synthetic-test-token-0123456789",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_test_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-link-pepper-min-16",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-telegram-webhook-secret-min16",
    TANBOT_MAX_ENABLED: "false",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  const app = createApp();
  const pool = getPool()!;
  const originalFetch = globalThis.fetch;
  let unexpectedFetches = 0;
  globalThis.fetch = async () => { unexpectedFetches++; throw new Error("Live fetch forbidden in synthetic bot test"); };
  try {
    const staff = await createTestUser({ databaseUrl: db, email: "ind-staff-code@test.local",
      password: "StrongPass123!", fullName: "Synthetic Receiving Staff", role: "manager" });
    const outsider = await createTestUser({ databaseUrl: db, email: "ind-staff-outsider@test.local",
      password: "StrongPass123!", fullName: "Synthetic Other Staff", role: "manager" });
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [staff.id]);
    const staffParty = await ensurePartyForUserOnWrite(pool, staff.id, "Synthetic Receiving Staff", null);
    await ensurePartyForUserOnWrite(pool, outsider.id, "Synthetic Other Staff", null);
    await pool.query(`INSERT INTO tanbot_telegram_accounts(user_id,telegram_user_id,telegram_chat_id,notifications_enabled)
      VALUES($1::uuid,885501,885501,TRUE),($2::uuid,885502,885502,TRUE)`, [staff.id, outsider.id]);
    const externalParty = (await pool.query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
      VALUES('external','Synthetic External Sender','+79994447701') RETURNING id`)).rows[0].id;
    const person = (await pool.query(`INSERT INTO tt_external_persons(party_id,display_name,phone_e164)
      VALUES($1,'Synthetic External Sender','+79994447701') RETURNING id`, [externalParty])).rows[0].id;
    await pool.query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
      VALUES($1,'telegram','885503','885503')`, [person]);
    const client = await pool.connect();
    let est: string;
    try { est = await createPersonBrowserSession(client, person, "telegram"); } finally { client.release(); }
    const postExternal = (path: string, body: Record<string, unknown>) => request(app).post(path)
      .set("Origin", origin).set("X-TT-External-Est", est!).send(body);
    const draft = await postExternal("/api/tan-tracker/public/external/request/draft", {
      startFresh: true, step: "summary",
      payload: { item: "Synthetic physical keys", recipientUserId: staff.id, dueMode: "today", comment: "" },
    });
    assert.equal(draft.status, 200);
    const confirmed = await postExternal("/api/tan-tracker/public/external/request/confirm", { draftId: draft.body.draftId });
    assert.equal(confirmed.status, 200);
    const publicCode = confirmed.body.publicCode;
    const hat = confirmed.body.bootstrap.holderAccessTokensByOrderId[publicCode];
    assert.ok(hat);
    const business = async () => (await pool.query(`SELECT status,holder_party_id,pending_party_id,handoff_version,first_custody_at
      FROM tt_transfers WHERE public_code=$1`, [publicCode])).rows[0];
    const codeCount = async () => Number((await pool.query(`SELECT COUNT(*) AS n FROM tt_handoff_codes
      WHERE transfer_id=$1`, [publicCode])).rows[0].n);
    const before = await business();
    assert.equal(before.pending_party_id, staffParty.id);
    assert.equal(await codeCount(), 0);
    const config = loadTanbotTelegramStage2Config();
    assert.ok(config.ok);
    if (!config.ok) throw new Error("synthetic Telegram configuration must load");
    const sends: Array<Parameters<TelegramDeliveryTransport>[0]> = [];
    const transport: TelegramDeliveryTransport = async input => { sends.push(input); return { ok: true, result: {} }; };
    await processTanbotNotificationOutbox(pool, config.config, transport, { deliveryEnabled: true });
    assert.equal(sends.length, 1);
    assert.match(String(sends[0].body.text), /От:\s*Synthetic External Sender/);
    assert.match(String(sends[0].body.text), /Кому:\s*Synthetic Receiving Staff/);
    assert.equal(String(sends[0].body.chat_id), "885501", "address the verified private user");
    const buttons = (sends[0].body.reply_markup as {
      inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
    })?.inline_keyboard?.flat() ?? [];
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].text, "Получить код приёма");
    assert.equal(buttons[0].url, undefined);
    const payload = buttons[0].callback_data;
    assert.ok(payload);
    assert.ok(Buffer.byteLength(payload, "utf8") <= 64);
    assert.equal(await codeCount(), 0, "sending the invitation must not issue a code");
    let sequence = 0;
    const updateIds = new Map<string, number>();
    const webhook = (userId: number, callbackId = `independent-staff-${++sequence}`,
      chatId = userId, chatType = "private") => {
      const updateId = updateIds.get(callbackId) ?? 20000 + ++sequence;
      updateIds.set(callbackId, updateId);
      return request(app).post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
        .send({ update_id: updateId, callback_query: {
          id: callbackId, data: payload, from: { id: userId, is_bot: false },
          message: { message_id: 1, chat: { id: chatId, type: chatType } },
        } });
    };
    assert.equal((await webhook(885501, "group-must-not-receive-code", -995501, "supergroup")).status, 200);
    assert.equal(await codeCount(), 0, "group callback must never generate or leak a receipt code");
    assert.equal((await webhook(885501, "private-chat-identity-mismatch", 885599)).status, 200);
    assert.equal(await codeCount(), 0, "callback chat must match private messenger user");
    assert.equal((await webhook(885502)).status, 200);
    assert.equal(await codeCount(), 0, "linked foreign staff must not issue recipient's code");
    assert.equal((await webhook(885599)).status, 200);
    assert.equal(await codeCount(), 0, "nonlinked Telegram identity must not issue any code");
    await pool.query("UPDATE users SET role='analyst' WHERE id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501)).status, 200);
    assert.equal(await codeCount(), 0, "an old button must respect current revoked tracker access");
    await pool.query("UPDATE users SET role='manager' WHERE id=$1::uuid", [staff.id]);
    await pool.query("UPDATE tanbot_telegram_accounts SET notifications_enabled=FALSE WHERE user_id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501)).status, 200);
    assert.equal(await codeCount(), 0, "current notification opt-out must be respected");
    await pool.query("UPDATE tanbot_telegram_accounts SET notifications_enabled=TRUE,stopped_at=NOW() WHERE user_id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501)).status, 200);
    assert.equal(await codeCount(), 0, "stopped account must not issue a code");
    await pool.query("UPDATE tanbot_telegram_accounts SET stopped_at=NULL WHERE user_id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501, "independent-valid-once")).status, 200);
    assert.equal(await codeCount(), 1);
    assert.deepEqual(await business(), before, "code issuance must not receive or change custody/version");
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    try { await runTanbotOutboxWorkerOnce(pool, config.config, transport); }
    finally { process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false"; }
    const codeReply = sends.filter(s => s.method === "sendMessage" &&
      String(s.body.chat_id) === "885501" && /\b\d{6}\b/.test(String(s.body.text))).at(-1);
    assert.ok(codeReply, "actual callback reply must privately deliver a one-time code");
    const code = String(codeReply.body.text).match(/\b(\d{6})\b/)![1];
    const codeMessages = sends.filter(s => s.method === "sendMessage" && String(s.body.text).includes(code));
    assert.equal(codeMessages.length, 2, "one explanatory message and one plain-copy message per issuance");
    assert.notEqual(String(codeMessages[0].body.text), code);
    assert.match(String(codeMessages[0].body.text), /От:\s*Synthetic External Sender/);
    assert.match(String(codeMessages[0].body.text), /Кому:\s*Synthetic Receiving Staff/);
    assert.ok(String(codeMessages[0].body.text).includes(publicCode));
    assert.ok(String(codeMessages[0].body.text).includes("Synthetic physical keys"));
    assert.equal(codeMessages[1].body.text, code);
    assert.equal(codeMessages[1].body.chat_id, codeMessages[0].body.chat_id);
    assert.equal(codeMessages[1].body.reply_markup, undefined);
    assert.equal(codeMessages[1].body.parse_mode, undefined);
    assert.notEqual(codeMessages[1].body.disable_web_page_preview, false,
      "a code-only message contains no URL and must not explicitly enable previews");
    const afterPair = sends.length;
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    try { await runTanbotOutboxWorkerOnce(pool, config.config, transport); }
    finally { process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false"; }
    assert.equal(sends.length, afterPair, "fully delivered pair is not resent by the next worker tick");
    assert.equal((await webhook(885501, "independent-valid-once")).status, 200);
    assert.equal(await codeCount(), 1, "replayed callback id must not rotate or duplicate code");
    const received = await request(app).post("/api/tan-tracker/public/holder/code/verify")
      .set("Origin", origin).send({ holderAccessToken: hat, code });
    assert.equal(received.status, 200);
    const after = await business();
    assert.equal(after.holder_party_id, staffParty.id);
    assert.equal(after.pending_party_id, null);
    assert.equal(after.handoff_version, before.handoff_version + 1);
    assert.equal((await webhook(885501)).status, 200);
    assert.equal(await codeCount(), 1, "old notification cannot issue a code after receipt");
    assert.deepEqual(await business(), after);
    const staleNotice = (await pool.query(`UPDATE tanbot_notification_outbox
      SET status='pending',next_attempt_at=NOW()
      WHERE event_type='tan_tracker.external_created' AND channel='telegram' AND payload->>'publicCode'=$1
      RETURNING id`, [publicCode])).rows;
    assert.equal(staleNotice.length, 1);
    const invitationText = sends[0].body.text;
    await processTanbotNotificationOutbox(pool, config.config, transport, { deliveryEnabled: true });
    const staleResult = (await pool.query("SELECT status,last_error_code FROM tanbot_notification_outbox WHERE id=$1::uuid",
      [staleNotice[0].id])).rows[0];
    assert.equal(staleResult.status, "cancelled");
    assert.equal(staleResult.last_error_code, "STALE_EXTERNAL_INTAKE");
    assert.equal(sends.filter(s => s.body.text === invitationText).length, 1,
      "a queued obsolete receipt invitation must never be sent again");
    assert.equal(unexpectedFetches, 0, "every bot send must use recording transport");
  } finally { globalThis.fetch = originalFetch; await closePool(); }
});
