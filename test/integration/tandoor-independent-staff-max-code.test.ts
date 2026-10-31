import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { prepareDatabase, getIntegrationDatabaseUrl, setIntegrationEnv, createTestUser } from "../helpers/test-db";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { processTanbotMaxNotificationOutbox } from "../../src/tanbot-max/outbox-worker";
import { runTanbotMaxOutboxWorkerOnce } from "../../src/tanbot-max/outbox-scheduler";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";

test("independent: real external draft → MAX intended recipient callback → sender verifies; issuance alone never receives", async () => {
  const db = getIntegrationDatabaseUrl();
  const origin = "http://127.0.0.1:3000";
  setIntegrationEnv(db, origin);
  Object.assign(process.env, {
    TT_OTP_PEPPER: "independent-staff-handoff-test-pepper",
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_MAX_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "false",
    TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_TEST_TOKEN_0123456789abcdef",
    TANBOT_MAX_BOT_USERNAME: "synthetic_test_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-max-link-pepper-min-16",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-max-webhook-secret-min16",
    TANBOT_TELEGRAM_ENABLED: "false",
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
    await pool.query(`INSERT INTO tanbot_max_accounts(user_id,max_user_id,max_chat_id,notifications_enabled)
      VALUES($1::uuid,885501,995501,TRUE),($2::uuid,885502,995502,TRUE)`, [staff.id, outsider.id]);
    const externalParty = (await pool.query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
      VALUES('external','Synthetic External Sender','+79994447701') RETURNING id`)).rows[0].id;
    const person = (await pool.query(`INSERT INTO tt_external_persons(party_id,display_name,phone_e164)
      VALUES($1,'Synthetic External Sender','+79994447701') RETURNING id`, [externalParty])).rows[0].id;
    await pool.query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
      VALUES($1,'max','885503','-995503')`, [person]);
    const client = await pool.connect();
    let est: string;
    try { est = await createPersonBrowserSession(client, person, "max"); } finally { client.release(); }
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
    const config = loadTanbotMaxStage2Config();
    assert.ok(config.ok);
    if (!config.ok) throw new Error("synthetic MAX configuration must load");
    const sends: Array<Parameters<MaxDeliveryTransport>[0]> = [];
    const transport: MaxDeliveryTransport = async input => { sends.push(input); return { ok: true, result: {} }; };
    await processTanbotMaxNotificationOutbox(pool, config.config, transport, { deliveryEnabled: true });
    assert.equal(sends.length, 1);
    assert.equal(sends[0].userId, 885501n, "address the verified user, never a different chat id");
    const buttons = sends[0].inlineButtons?.flat() ?? [];
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].text, "Получить код приёма");
    assert.equal(buttons[0].type, "callback");
    if (buttons[0].type !== "callback") throw new Error("receipt action must be a callback");
    const payload = buttons[0].payload;
    assert.equal(await codeCount(), 0, "sending the invitation must not issue a code");
    let sequence = 0;
    const webhook = (userId: number, callbackId = `independent-staff-${++sequence}`) =>
      request(app).post("/api/tanbot-max/webhook")
        .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
        .send({ update_type: "message_callback", timestamp: 20000 + sequence,
          callback: { callback_id: callbackId, payload, user: { user_id: userId, is_bot: false } },
          message: { recipient: { chat_id: 995501 } } });
    assert.equal((await webhook(885502)).status, 200);
    assert.equal(await codeCount(), 0, "linked foreign staff must not issue recipient's code");
    assert.equal((await webhook(885599)).status, 200);
    assert.equal(await codeCount(), 0, "nonlinked MAX identity must not issue any code");
    await pool.query("UPDATE users SET role='analyst' WHERE id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501)).status, 200);
    assert.equal(await codeCount(), 0, "an old button must respect current revoked tracker access");
    await pool.query("UPDATE users SET role='manager' WHERE id=$1::uuid", [staff.id]);
    await pool.query("UPDATE tanbot_max_accounts SET notifications_enabled=FALSE WHERE user_id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501)).status, 200);
    assert.equal(await codeCount(), 0, "current notification opt-out must be respected");
    await pool.query("UPDATE tanbot_max_accounts SET notifications_enabled=TRUE,stopped_at=NOW() WHERE user_id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501)).status, 200);
    assert.equal(await codeCount(), 0, "stopped account must not issue a code");
    await pool.query("UPDATE tanbot_max_accounts SET stopped_at=NULL WHERE user_id=$1::uuid", [staff.id]);
    assert.equal((await webhook(885501, "independent-valid-once")).status, 200);
    assert.equal(await codeCount(), 1);
    assert.deepEqual(await business(), before, "code issuance must not receive or change custody/version");
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
    try { await runTanbotMaxOutboxWorkerOnce(pool, config.config, transport); }
    finally { process.env.TANBOT_MAX_DELIVERY_ENABLED = "false"; }
    const codeReply = sends.filter(s => s.userId === 885501n && /\b\d{6}\b/.test(s.text)).at(-1);
    assert.ok(codeReply, "actual callback reply must privately deliver a one-time code");
    const code = codeReply.text.match(/\b(\d{6})\b/)![1];
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
      WHERE event_type='tan_tracker.external_created' AND channel='max' AND payload->>'publicCode'=$1
      RETURNING id`, [publicCode])).rows;
    assert.equal(staleNotice.length, 1);
    const invitationText = sends[0].text;
    await processTanbotMaxNotificationOutbox(pool, config.config, transport, { deliveryEnabled: true });
    const staleResult = (await pool.query("SELECT status,last_error_code FROM tanbot_notification_outbox WHERE id=$1::uuid",
      [staleNotice[0].id])).rows[0];
    assert.equal(staleResult.status, "cancelled");
    assert.equal(staleResult.last_error_code, "STALE_EXTERNAL_INTAKE");
    assert.equal(sends.filter(s => s.text === invitationText).length, 1,
      "a queued obsolete receipt invitation must never be sent again");
    assert.equal(unexpectedFetches, 0, "every bot send must use recording transport");
  } finally { globalThis.fetch = originalFetch; await closePool(); }
});
