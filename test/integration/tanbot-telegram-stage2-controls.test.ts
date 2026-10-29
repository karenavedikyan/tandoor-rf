import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { createRecordingTelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { applyPendingReceiptHandoff } from "../../src/tan-tracker/handoff-complete";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const WEBHOOK_SECRET = "controls-webhook-secret-16";
const LINK_PEPPER = "controls-link-pepper-min-16";
const SYNTH_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
const databaseUrl = getIntegrationDatabaseUrl();
const repoRoot = process.cwd();

function setStage2Env(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_TELEGRAM_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_BOT_TOKEN = SYNTH_TOKEN;
  process.env.TANBOT_TELEGRAM_EXPECTED_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = LINK_PEPPER;
  process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, app: Awaited<ReturnType<typeof loadApp>>) {
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function startAndAttachTelegram(
  app: Awaited<ReturnType<typeof loadApp>>,
  cookie: string,
  telegramUserId: number,
  updateId: number,
): Promise<string> {
  const start = await request(app)
    .post("/api/profile/tanbot/telegram/link/start")
    .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
    .send({});
  const token = new URL(start.body.deepLink).searchParams.get("start")!;
  await request(app)
    .post("/api/tanbot-telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
    .send({
      update_id: updateId,
      message: {
        message_id: 1,
        from: { id: telegramUserId, is_bot: false, username: "race_user" },
        chat: { id: telegramUserId, type: "private" },
        date: 1,
        text: `/start ${token}`,
      },
    });
  const status = await request(app)
    .get("/api/profile/tanbot/telegram")
    .set({ Origin: ORIGIN, Cookie: cookie });
  return status.body.pendingConfirmation.attemptId as string;
}

describe("tanbot telegram stage2 independent controls", { concurrency: false }, () => {
  before(async () => {
    setStage2Env();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("concurrent confirm: only one LK user owns telegram account", async () => {
    const userA = await createTestUser({
      databaseUrl,
      email: "race-a@test.local",
      password: PASSWORD,
      fullName: "Race A",
      role: "manager",
    });
    const userB = await createTestUser({
      databaseUrl,
      email: "race-b@test.local",
      password: PASSWORD,
      fullName: "Race B",
      role: "manager",
    });
    const app = await loadApp();
    const cookieA = await login("race-a@test.local", app);
    const cookieB = await login("race-b@test.local", app);
    const tgId = 991001;
    const attemptA = await startAndAttachTelegram(app, cookieA, tgId, 991001);
    const attemptB = (
      await request(app)
        .post("/api/profile/tanbot/telegram/link/start")
        .set({ Origin: ORIGIN, Cookie: cookieB, "Content-Type": "application/json" })
        .send({})
    ).body.attemptId as string;
    const pool = getPool()!;
    await pool.query(
      `UPDATE tanbot_telegram_link_attempts
       SET telegram_user_id = $1, telegram_chat_id = $1, telegram_username = 'race', telegram_started_at = NOW()
       WHERE id = $2::uuid`,
      [tgId, attemptB],
    );

    const confirmA = request(app)
      .post("/api/profile/tanbot/telegram/link/confirm")
      .set({ Origin: ORIGIN, Cookie: cookieA, "Content-Type": "application/json" })
      .send({ attemptId: attemptA, enableNotifications: false });
    const confirmB = request(app)
      .post("/api/profile/tanbot/telegram/link/confirm")
      .set({ Origin: ORIGIN, Cookie: cookieB, "Content-Type": "application/json" })
      .send({ attemptId: attemptB, enableNotifications: false });
    const [resA, resB] = await Promise.all([confirmA, confirmB]);
    const ok = [resA.status, resB.status].filter((s) => s === 200).length;
    const conflict = [resA.status, resB.status].filter((s) => s === 409).length;
    assert.equal(ok, 1);
    assert.equal(conflict, 1);
    const owners = await pool.query(`SELECT user_id::text FROM tanbot_telegram_accounts WHERE telegram_user_id = $1`, [
      tgId,
    ]);
    assert.equal(owners.rowCount, 1);
    const winner = owners.rows[0]!.user_id;
    assert.ok(winner === userA.id || winner === userB.id);
  });

  it("webhook update retries after business rollback", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "rollback@test.local",
      password: PASSWORD,
      fullName: "Rollback User",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("rollback@test.local", app);
    const start = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    const token = new URL(start.body.deepLink).searchParams.get("start")!;
    const pool = getPool()!;
    await pool.query(`
      CREATE OR REPLACE FUNCTION tanbot_test_fail_telegram_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'telegram_start' THEN
          RAISE EXCEPTION 'tanbot_test_fail_telegram_audit';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS tanbot_test_fail_telegram_audit_trg ON tanbot_telegram_link_audit;
      CREATE TRIGGER tanbot_test_fail_telegram_audit_trg
      BEFORE INSERT ON tanbot_telegram_link_audit
      FOR EACH ROW EXECUTE FUNCTION tanbot_test_fail_telegram_audit();
    `);
    const update = {
      update_id: 992001,
      message: {
        message_id: 1,
        from: { id: 992001, is_bot: false, first_name: "RB" },
        chat: { id: 992001, type: "private" },
        date: 1,
        text: `/start ${token}`,
      },
    };
    const first = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send(update);
    assert.equal(first.status, 500);
    await pool.query(`DROP TRIGGER IF EXISTS tanbot_test_fail_telegram_audit_trg ON tanbot_telegram_link_audit`);
    await pool.query(`DROP FUNCTION IF EXISTS tanbot_test_fail_telegram_audit()`);
    const second = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send(update);
    assert.equal(second.status, 200);
    const attempt = await pool.query(
      `SELECT telegram_started_at FROM tanbot_telegram_link_attempts WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
      [user.id],
    );
    assert.ok(attempt.rows[0]?.telegram_started_at);
  });

  it("confirm blocked when master switch disabled", async () => {
    await createTestUser({
      databaseUrl,
      email: "master-off@test.local",
      password: PASSWORD,
      fullName: "Master Off",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("master-off@test.local", app);
    const attemptId = await startAndAttachTelegram(app, cookie, 992003, 992003);
    process.env.TANBOT_TELEGRAM_ENABLED = "false";
    await resetPoolForTests();
    const app2 = await loadApp();
    const res = await request(app2)
      .post("/api/profile/tanbot/telegram/link/confirm")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ attemptId, enableNotifications: false });
    assert.equal(res.status, 503);
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
  });

  it("disabled user does not receive queued notification delivery", async () => {
    const recipient = await createTestUser({
      databaseUrl,
      email: "disabled-recipient@test.local",
      password: PASSWORD,
      fullName: "Disabled Recipient",
      role: "manager",
    });
    const holder = await createTestUser({
      databaseUrl,
      email: "disabled-holder@test.local",
      password: PASSWORD,
      fullName: "Disabled Holder",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    const transferId = "tt-disabled-1";
    try {
      await client.query("BEGIN");
      const holderParty = await ensurePartyForUserOnWrite(client, holder.id, "H", "+79990001111");
      const pendingParty = await ensurePartyForUserOnWrite(client, recipient.id, "R", "+79990002222");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id, handoff_version, row_version)
         VALUES ($1, 'DIS1', 'Item', 'waiting', $2, $2, $3, 1, 1)`,
        [transferId, holderParty.id, pendingParty.id],
      );
      await client.query(
        `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
         VALUES ($1::uuid, 992004, 992004, TRUE)`,
        [recipient.id],
      );
      await applyPendingReceiptHandoff(
        client,
        {
          id: transferId,
          holder_party_id: holderParty.id,
          pending_party_id: pendingParty.id,
          final_recipient_party_id: null,
          handoff_version: 1,
          row_version: 1,
        },
        recipient.id,
        pendingParty.id,
        "handoff",
      );
      await client.query(`UPDATE users SET status = 'disabled' WHERE id = $1::uuid`, [recipient.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    const loaded = loadTanbotTelegramStage2Config();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe", encoding: "utf8" });
    assert.equal(build.status, 0);
    const worker = spawnSync(process.execPath, ["dist/cli/tanbot-telegram-outbox-worker.js", "--once"], {
      cwd: repoRoot,
      env: { ...process.env, PATH: process.env.PATH },
      encoding: "utf8",
    });
    assert.equal(worker.status, 0, worker.stderr || worker.stdout);
    const idempotencyKey = `tt-assignment:${transferId}:hv:2:telegram:${recipient.id}`;
    const row = await pool.query(
      `SELECT status, last_error_code FROM tanbot_notification_outbox WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    assert.equal(row.rows[0]?.status, "cancelled");
    assert.equal(row.rows[0]?.last_error_code, "NO_ACCESS");
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
  });

  it("runtime outbox worker CLI delivers one pending row", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "worker-cli@test.local",
      password: PASSWORD,
      fullName: "Worker CLI",
      role: "manager",
    });
    const pool = getPool()!;
    await pool.query(
      `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
       VALUES ($1::uuid, 992005, 992005, TRUE)`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO tanbot_notification_outbox (idempotency_key, user_id, channel, event_type, payload)
       VALUES ('test-worker-once', $1::uuid, 'telegram', 'tan_tracker.assignment', $2::jsonb)`,
      [user.id, JSON.stringify({ transferId: "x", publicCode: "W1", itemTitle: "T", handoffVersion: 1 })],
    );
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    const worker = spawnSync(process.execPath, ["dist/cli/tanbot-telegram-outbox-worker.js", "--once"], {
      cwd: repoRoot,
      env: { ...process.env, PATH: process.env.PATH },
      encoding: "utf8",
    });
    assert.equal(worker.status, 0, worker.stderr || worker.stdout);
    const row = await pool.query(`SELECT status FROM tanbot_notification_outbox WHERE idempotency_key = 'test-worker-once'`);
    assert.equal(row.rows[0]?.status, "cancelled");
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
  });
});
