import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { listMessengerAccounts, changeMessengerAccount } from "../../src/tanbot/messenger-accounts";
import { linkStaffByVerifiedContact } from "../../src/tanbot/verified-contact-staff-link";
import { handleStaffOrExternalMessengerStop } from "../../src/tanbot/messenger-stop-handler";
import { assertNativeCreateContext } from "../../src/tanbot/native-create/access-guard";
import { startTanbotMaxLink, consumeStartTokenForMaxUser } from "../../src/tanbot-max/link-service";
import { startTanbotLink, consumeStartTokenForTelegramUser } from "../../src/tanbot-telegram/link-service";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { enqueueNotificationOutbox } from "../../src/tanbot-telegram/outbox";
import { processTanbotMaxNotificationOutbox } from "../../src/tanbot-max/outbox-worker";
import { processTanbotNotificationOutbox } from "../../src/tanbot-telegram/outbox-worker";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { enqueueAutomaticReceiptCode, processAutomaticReceiptCodes } from "../../src/tan-tracker/automatic-receipt-codes";
import { assertHandoffCodeBotAccess } from "../../src/tanbot/handoff-code-bot-service";

const databaseUrl = getIntegrationDatabaseUrl();
const origin = "http://127.0.0.1:3000";
const p1 = "+79000000001", p2 = "+79000000002";
const password = "SyntheticPassword123!";
const channels = ["max", "telegram"] as const;
describe("multiple staff messenger accounts, additive schema and independent delivery", { concurrency: false }, () => {
  let owner: string, other: string;
  before(async () => {
    setIntegrationEnv(databaseUrl, origin);
    for (const name of ["MAX", "TELEGRAM"]) {
      process.env[`TANBOT_${name}_ENABLED`] = "true";
      process.env[`TANBOT_${name}_BOT_TOKEN`] = name === "MAX"
        ? "SYNTH_MAX_TEST_TOKEN_0123456789abcdef" : "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";
      process.env[`TANBOT_${name}_BOT_USERNAME`] = name === "MAX" ? "id231100522180_bot" : "TANDOOR_IBOT";
      process.env[`TANBOT_${name}_EXPECTED_USERNAME`] = process.env[`TANBOT_${name}_BOT_USERNAME`];
      process.env[`TANBOT_${name}_LINK_TOKEN_PEPPER`] = "synthetic-multi-account-link-pepper";
      process.env[`TANBOT_${name}_DELIVERY_ENABLED`] = "false";
    }
    await prepareDatabase(databaseUrl);
    owner = (await createTestUser({ databaseUrl, email: "multi@test.local", password,
      fullName: "Синтетический сотрудник", phone: p1 })).id;
    other = (await createTestUser({ databaseUrl, email: "other@test.local", password,
      fullName: "Другой сотрудник", phone: "+79000000003" })).id;
    await resetPoolForTests();
    await getPool()!.query("UPDATE users SET additional_phone=$2 WHERE id=$1", [owner, p2]);
  });
  after(closePool);
  const maxConfig = () => { const c = loadTanbotMaxStage2Config(); assert.ok(c.ok); return c.config; };
  const tgConfig = () => { const c = loadTanbotTelegramStage2Config(); assert.ok(c.ok); return c.config; };
  async function onClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>) {
    const c = await getPool()!.connect();
    try { await c.query("BEGIN"); const result = await fn(c); await c.query("COMMIT"); return result; }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  for (const channel of channels) {
    const id = channel === "max" ? 91001n : 92001n;
    it(`${channel}: old primary record survives; own contact identifies its actual phone`, async () => {
      await getPool()!.query(`INSERT INTO tanbot_${channel}_accounts
        (user_id,${channel}_user_id,${channel}_chat_id) VALUES ($1,$2,$2)`, [owner, id.toString()]);
      await onClient(async c => {
        const before = (await listMessengerAccounts(c, channel, owner))[0]!;
        assert.equal(before.phone_e164, null);
        const result = await linkStaffByVerifiedContact(c, {
          channel, messengerUserId: id, messengerChatId: id, phoneRaw: p1,
        });
        assert.deepEqual(result, { kind: "staff", userId: owner });
        const after = (await listMessengerAccounts(c, channel, owner))[0]!;
        assert.equal(after.messenger_user_id, before.messenger_user_id);
        assert.equal(after.phone_e164, p1);
        assert.ok(after.phone_confirmed_at);
      });
    });
    it(`${channel}: second own contact adds an account without replacing the first`, async () => {
      await onClient(async c => {
        const result = await linkStaffByVerifiedContact(c, {
          channel, messengerUserId: id + 1n, messengerChatId: id + 1n, phoneRaw: p2,
        });
        assert.deepEqual(result, { kind: "staff", userId: owner });
        assert.deepEqual((await listMessengerAccounts(c, channel, owner)).map(a => a.phone_e164), [p1, p2]);
        const duplicate = await linkStaffByVerifiedContact(c, {
          channel, messengerUserId: id + 2n, messengerChatId: id + 2n, phoneRaw: p2,
        });
        assert.equal(duplicate.kind, "rejected");
        assert.equal((await listMessengerAccounts(c, channel, owner)).length, 2);
      });
    });
    it(`${channel}: /stop affects only its caller, and reconfirmation resumes only that account`, async () => {
      await onClient(async c => {
        await handleStaffOrExternalMessengerStop(c, { channel, messengerUserId: id + 1n });
        let rows = await listMessengerAccounts(c, channel, owner);
        assert.equal(rows[0]!.stopped_at, null);
        assert.ok(rows[1]!.stopped_at);
        await linkStaffByVerifiedContact(c, { channel, messengerUserId: id + 1n,
          messengerChatId: id + 1n, phoneRaw: p2 });
        rows = await listMessengerAccounts(c, channel, owner);
        assert.ok(rows.every(a => !a.stopped_at && a.notifications_enabled));
      });
    });
    it(`${channel}: secondary bot access matches BOTH messenger user and chat`, async () => {
      const ctx = { channel, messengerUserId: id + 1n, messengerChatId: (id + 1n).toString(),
        privateDialogOk: true, isLinkedStaff: true, staffUserId: owner, personId: null };
      await onClient(async c => {
        await assertNativeCreateContext(c, ctx);
        await assert.rejects(assertNativeCreateContext(c, { ...ctx, messengerChatId: id.toString() }), /Чат не привязан/);
        await assert.rejects(assertNativeCreateContext(c, { ...ctx, staffUserId: other }), /Чат не привязан/);
      });
    });
    it(`${channel}: account opt-out is independent and ownership-scoped`, async () => {
      await onClient(async c => {
        await assert.rejects(changeMessengerAccount(c, { channel, userId: other,
          accountId: (id + 1n).toString(), enabled: false }), /недоступен/);
        await changeMessengerAccount(c, { channel, userId: owner, accountId: (id + 1n).toString(), enabled: false });
        const rows = await listMessengerAccounts(c, channel, owner);
        assert.equal(rows[0]!.notifications_enabled, true);
        assert.equal(rows[1]!.notifications_enabled, false);
        await changeMessengerAccount(c, { channel, userId: owner, accountId: (id + 1n).toString(), enabled: true });
      });
    });
  }
  it("LK link token preserves opt-out; duplicate account cannot occupy another current phone slot", async () => {
    // Separate owner tests LK-driven linking (not provider contact proof).
    const u = (await createTestUser({ databaseUrl, email: "links@test.local", password,
      fullName: "Проверка ссылок", phone: p1.replace(/01$/, "11") })).id;
    const work = p2.replace(/02$/, "12"), personal = p1.replace(/01$/, "11");
    await getPool()!.query("UPDATE users SET additional_phone=$2 WHERE id=$1", [u, work]);
    for (const channel of channels) {
      const n = channel === "max" ? 93001n : 94001n;
      async function start(phone: string, enabled: boolean) {
        return channel === "max" ? startTanbotMaxLink(getPool()!, maxConfig(), u, { phone, enableNotifications: enabled })
          : startTanbotLink(getPool()!, tgConfig(), u, { phone, enableNotifications: enabled });
      }
      async function consume(deepLink: string, account: bigint) {
        const startToken = new URL(deepLink).searchParams.get("start")!;
        return channel === "max"
          ? consumeStartTokenForMaxUser(getPool()!, maxConfig(), {
            startToken, maxUserId: account, maxChatId: account, maxUsername: null, maxFirstName: null })
          : consumeStartTokenForTelegramUser(getPool()!, tgConfig(), {
            startToken, telegramUserId: account, telegramChatId: account, telegramUsername: null, telegramFirstName: null });
      }
      const first = await start(personal, true);
      assert.equal(await consume(first.deepLink, n), "linked");
      const second = await start(work, false);
      assert.equal(await consume(second.deepLink, n), "conflict", "same account cannot be relabelled as the second number");
      assert.equal(await consume(second.deepLink, n + 1n), "invalid", "attempt remains bound to first messenger");
      const fresh = await start(work, false);
      assert.equal(await consume(fresh.deepLink, n + 1n), "linked");
      assert.equal(await consume(fresh.deepLink, n + 1n), "linked", "webhook replay idempotent");
      const rows = await onClient(c => listMessengerAccounts(c, channel, u));
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.notifications_enabled, true);
      assert.equal(rows[1]!.notifications_enabled, false);
      assert.equal(rows[1]!.phone_confirmed_at, null, "LK label is not provider contact proof");
      await assert.rejects(start("+79000009999", true), /сохраните/);
    }
  });
  it("HTTP API returns all own accounts, rejects foreign writes and CSRF", async () => {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app).post("/api/auth/login").set("Origin", origin)
      .send({ email: "multi@test.local", password });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    for (const channel of channels) {
      const res = await request(app).get(`/api/profile/tanbot/${channel}`).set("Cookie", cookie);
      assert.equal(res.status, 200);
      assert.equal(res.body.accounts.length, 2);
      assert.deepEqual(res.body.profilePhones, [p1,p2]);
      const foreign = await request(app).post(`/api/profile/tanbot/${channel}/disconnect`)
        .set({ Cookie: cookie, Origin: origin }).send({ accountId: "999999" });
      assert.equal(foreign.status, 409);
      const csrf = await request(app).post(`/api/profile/tanbot/${channel}/notifications`)
        .set({ Cookie: cookie, Origin: "https://attacker.invalid" }).send({ enabled: false });
      assert.equal(csrf.status, 403);
      assert.equal((await request(app).get(`/api/profile/tanbot/${channel}`)).status, 401);
    }
  });
  it("simultaneous own-contact claims cannot create two accounts in one phone slot", async () => {
    for (const channel of channels) {
      const id = channel === "max" ? 95001n : 96001n;
      const results = await Promise.all([id, id + 1n].map(messengerUserId => onClient(c =>
        linkStaffByVerifiedContact(c, { channel, messengerUserId, messengerChatId: messengerUserId,
          phoneRaw: "+79000000003" }))));
      assert.equal(results.filter(r => r.kind === "staff").length, 1);
      assert.equal(results.filter(r => r.kind === "rejected").length, 1);
      assert.equal((await onClient(c => listMessengerAccounts(c, channel, other))).length, 1);
    }
  });
  it("expired token and disabled owner cannot add another MAX account", async () => {
    const config = maxConfig();
    const consume = (deepLink: string) => consumeStartTokenForMaxUser(getPool()!, config, {
      startToken: new URL(deepLink).searchParams.get("start")!, maxUserId: 97001n, maxChatId: 97001n,
      maxUsername: null, maxFirstName: null,
    });
    const expired = await startTanbotMaxLink(getPool()!, config, owner, { phone: p2 });
    await getPool()!.query("UPDATE tanbot_max_link_attempts SET expires_at=NOW()-interval '1 second' WHERE id=$1", [expired.attemptId]);
    assert.equal(await consume(expired.deepLink), "invalid");
    const disabled = await startTanbotMaxLink(getPool()!, config, owner, { phone: p2 });
    await getPool()!.query("UPDATE users SET status='disabled' WHERE id=$1", [owner]);
    try { assert.equal(await consume(disabled.deepLink), "invalid"); }
    finally { await getPool()!.query("UPDATE users SET status='active' WHERE id=$1", [owner]); }
    assert.equal((await onClient(c => listMessengerAccounts(c, "max", owner))).length, 2);
  });
  it("each account has independent retry; thrown MAX transport does not roll back successful accounts", async () => {
    await onClient(async c => {
      const p = await ensurePartyForUserOnWrite(c, owner, "Сотрудник", p1);
      await c.query(`INSERT INTO tt_transfers
        (id,public_code,item_title,status,creator_party_id,holder_party_id,handoff_version,row_version)
        VALUES ('MULTI-1','MUL1','Тестовый предмет','waiting',$1,$1,1,1)`, [p.id]);
      for (const channel of channels) {
        const input = { idempotencyKey: `multi-event:${channel}`, userId: owner, channel,
          eventType: "tan_tracker.assignment", payload: { transferId: "MULTI-1", publicCode: "MUL1",
            itemTitle: "Тестовый предмет", handoffVersion: 1 } };
        await enqueueNotificationOutbox(c, input);
        await enqueueNotificationOutbox(c, input);
      }
    });
    assert.equal((await getPool()!.query("SELECT 1 FROM tanbot_notification_outbox")).rowCount, 4);
    const received: string[] = [];
    const max = await processTanbotMaxNotificationOutbox(getPool()!, maxConfig(), async input => {
      if (input.userId === 91002n) throw new Error("Synthetic connection loss");
      received.push(input.userId.toString()); return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    const tg = await processTanbotNotificationOutbox(getPool()!, tgConfig(), async input => {
      received.push(String(input.body.chat_id)); return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.equal(max.sent, 1); assert.equal(max.failed, 1); assert.equal(tg.sent, 2);
    await getPool()!.query("UPDATE tanbot_notification_outbox SET next_attempt_at=NOW() WHERE status='pending'");
    const retry = await processTanbotMaxNotificationOutbox(getPool()!, maxConfig(), async input => {
      received.push(input.userId.toString()); return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.equal(retry.sent, 1);
    assert.deepEqual(received.sort(), ["91001","91002","92001","92002"]);
    const counts = (await getPool()!.query("SELECT status,attempt_count FROM tanbot_notification_outbox")).rows;
    assert.ok(counts.every(r => r.status === "sent"));
    assert.equal(counts.filter(r => r.attempt_count === 2).length, 1);
  });
  it("queued target cannot jump to another account after unsubscribe", async () => {
    await onClient(async c => {
      await enqueueNotificationOutbox(c, { idempotencyKey: "stopped-target", userId: owner, channel: "max",
        eventType: "tan_tracker.assignment", payload: { transferId: "MULTI-1", handoffVersion: 1 } });
      await changeMessengerAccount(c, { channel: "max", userId: owner, accountId: "91002", disconnect: true });
    });
    const received: string[] = [];
    const result = await processTanbotMaxNotificationOutbox(getPool()!, maxConfig(), async input => {
      received.push(input.userId.toString()); return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.deepEqual(received, ["91001"]);
    assert.equal(result.cancelled, 1);
  });
  it("pre-upgrade null-target jobs retain primary-only semantics", async () => {
    // Telegram still has two enabled accounts, but this row predates target snapshots.
    await getPool()!.query(`INSERT INTO tanbot_notification_outbox
      (idempotency_key,user_id,channel,event_type,payload)
      VALUES ('legacy-null-target',$1,'telegram','tan_tracker.assignment',$2::jsonb)`,
    [owner, JSON.stringify({ transferId: "MULTI-1", handoffVersion: 1 })]);
    const received: string[] = [];
    await processTanbotNotificationOutbox(getPool()!, tgConfig(), async input => {
      received.push(String(input.body.chat_id)); return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.deepEqual(received, ["92001"]);
  });
  it("new pending transfer sends the same protected receipt code to all four accounts", async () => {
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_MAX_DELIVERY_ENABLED = process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    process.env.TANBOT_MAX_WEBHOOK_ENABLED = process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_MAX_WEBHOOK_SECRET = process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "synthetic-local-webhook-secret";
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
    await onClient(async c => {
      await linkStaffByVerifiedContact(c, { channel: "max", messengerUserId: 91002n,
        messengerChatId: 91002n, phoneRaw: p2 });
      await changeMessengerAccount(c, { channel: "max", userId: owner, accountId: "91002", enabled: false });
      const denied = await assertHandoffCodeBotAccess(c, "max", owner, 91002n);
      assert.equal(denied.ok, false, "another enabled account must not bypass this account's opt-out");
      await changeMessengerAccount(c, { channel: "max", userId: owner, accountId: "91002", enabled: true });
      const holder = await ensurePartyForUserOnWrite(c, other, "Отправитель", "+79000000003");
      const recipient = await ensurePartyForUserOnWrite(c, owner, "Получатель", p1);
      await c.query(`INSERT INTO tt_transfers
        (id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,final_recipient_party_id,handoff_version,row_version)
        VALUES ('MULTI-2','MUL2','Предмет для получателя','waiting',$1,$1,$2,$2,1,1)`, [holder.id, recipient.id]);
      assert.equal(await enqueueAutomaticReceiptCode(c, "MULTI-2"), true);
      assert.equal(await enqueueAutomaticReceiptCode(c, "MULTI-2"), true, "same stage remains idempotent");
    });
    const received = new Map<string,string[]>();
    for (const channel of channels) {
      await processAutomaticReceiptCodes(getPool()!, { channel, deliveryEnabled: true,
        transport: async msg => {
          received.set(msg.userId,[...(received.get(msg.userId) ?? []),msg.text]);
          return { ok: true };
        } });
    }
    assert.deepEqual([...received.keys()].sort(), ["91001","91002","92001","92002"]);
    assert.ok([...received.values()].every(messages => messages.length === 2 && /^\d{6}$/.test(messages[1]!)));
    assert.equal(new Set([...received.values()].map(messages => messages[1])).size, 1);
    assert.equal((await getPool()!.query("SELECT 1 FROM tt_handoff_codes WHERE transfer_id='MULTI-2'")).rowCount, 1);
    assert.equal((await getPool()!.query("SELECT 1 FROM tt_automatic_receipt_codes WHERE transfer_id='MULTI-2'")).rowCount, 1);
    assert.equal((await getPool()!.query("SELECT 1 FROM tt_automatic_receipt_account_deliveries")).rowCount, 4);
  });
});
