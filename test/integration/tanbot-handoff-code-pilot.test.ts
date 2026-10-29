import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { spawnSync } from "node:child_process";
import { createRecordingMaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import { createRecordingTelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { runTanbotMaxOutboxWorkerOnce } from "../../src/tanbot-max/outbox-scheduler";
import { runTanbotOutboxWorkerOnce } from "../../src/tanbot-telegram/outbox-scheduler";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

function setPilotEnv(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
  process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
  process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
  process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
  process.env.TANBOT_MAX_ENABLED = "true";
  process.env.TANBOT_MAX_BOT_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";
  process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
  process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "test-max-link-pepper-min-16-chars";
  process.env.TANBOT_MAX_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_MAX_WEBHOOK_SECRET = "test-max-webhook-secret-min16";
  process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

describe("tanbot handoff code pilot", { concurrency: false }, () => {
  before(async () => {
    setPilotEnv();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  function externalIdsForPublicCode(publicCode: string): { telegramUserId: number; maxUserId: number } {
    const seed = publicCode.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return { telegramUserId: 700_000 + (seed % 50_000), maxUserId: 800_000 + (seed % 50_000) };
  }

  async function seedTransfer(
    holderId: string,
    pendingId: string,
    publicCode: string,
    options: { telegram?: boolean; max?: boolean } = { telegram: true, max: true },
  ) {
    const pool = getPool();
    assert.ok(pool);
    const { telegramUserId, maxUserId } = externalIdsForPublicCode(publicCode);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const holderParty = await ensurePartyForUserOnWrite(client, holderId, "Holder", "+79991110001");
      const pendingParty = await ensurePartyForUserOnWrite(client, pendingId, "Pending", "+79991110002");
      const transferId = `tt-${publicCode}`;
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id, handoff_version, row_version)
         VALUES ($1, $2, $3, 'waiting', $4, $4, $5, 1, 1)`,
        [transferId, publicCode, `Item ${publicCode}`, holderParty.id, pendingParty.id],
      );
      if (options.telegram !== false) {
        await client.query(
          `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
           VALUES ($1::uuid, $2, $2, TRUE)`,
          [pendingId, telegramUserId],
        );
      }
      if (options.max !== false) {
        await client.query(
          `INSERT INTO tanbot_max_accounts (user_id, max_user_id, max_chat_id, notifications_enabled)
           VALUES ($1::uuid, $2, $2, TRUE)`,
          [pendingId, maxUserId],
        );
      }
      await client.query("COMMIT");
      return {
        transferId,
        holderPartyId: holderParty.id,
        pendingPartyId: pendingParty.id,
        telegramUserId,
        maxUserId,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  it("telegram: pending recipient gets code; outsider cannot", async () => {
    const holder = await createTestUser({
      databaseUrl,
      email: "hc-holder-tg@test.local",
      password: PASSWORD,
      fullName: "Holder TG",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "hc-pending-tg@test.local",
      password: PASSWORD,
      fullName: "Pending TG",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "hc-outsider-tg@test.local",
      password: PASSWORD,
      fullName: "Outsider TG",
      role: "manager",
    });
    const seeded = await seedTransfer(holder.id, pending.id, "P-TG-01", { max: false });
    const app = await loadApp();

    const sink = { calls: [] as Array<{ method: string; body: Record<string, unknown> }> };
    const recording = createRecordingTelegramDeliveryTransport(sink);

    const wh = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 12001,
        callback_query: {
          id: "cq1",
          from: { id: seeded.telegramUserId, is_bot: false, first_name: "B" },
          message: { chat: { id: seeded.telegramUserId, type: "private" } },
          data: "hc:gen:P-TG-01",
        },
      });
    assert.equal(wh.status, 200);

    const pool = getPool();
    assert.ok(pool);
    const tgLoaded = loadTanbotTelegramStage2Config();
    assert.equal(tgLoaded.ok, true);
    if (!tgLoaded.ok) return;
    await runTanbotOutboxWorkerOnce(pool, tgLoaded.config, recording);

    assert.equal(sink.calls.length, 1);
    const text = String(sink.calls[0]!.body.text);
    const match = text.match(/\b(\d{6})\b/);
    assert.ok(match, text);
    const code = match![1]!;

    const outsiderWh = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 12002,
        callback_query: {
          id: "cq2",
          from: { id: 700002, is_bot: false },
          message: { chat: { id: 700002, type: "private" } },
          data: "hc:gen:P-TG-01",
        },
      });
    assert.equal(outsiderWh.status, 200);
    await runTanbotOutboxWorkerOnce(pool, tgLoaded.config, recording);
    const outsiderText = sink.calls.at(-1)?.body.text;
    assert.match(String(outsiderText), /не подключён|недоступ|ожидающий/i);

    const dup = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 12001,
        callback_query: {
          id: "cq1",
          from: { id: seeded.telegramUserId, is_bot: false },
          message: { chat: { id: seeded.telegramUserId, type: "private" } },
          data: "hc:gen:P-TG-01",
        },
      });
    assert.equal(dup.status, 200);
    const codesBefore = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = 'tt-P-TG-01'`,
    );
    await runTanbotOutboxWorkerOnce(pool, tgLoaded.config, recording);
    const codesAfter = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = 'tt-P-TG-01'`,
    );
    assert.equal(codesBefore.rows[0]!.c, codesAfter.rows[0]!.c);

    void code;
  });

  it("max: message envelope send marks outbox sent; reply retry delivers after failure", async () => {
    const holder = await createTestUser({
      databaseUrl,
      email: "hc-holder-max@test.local",
      password: PASSWORD,
      fullName: "Holder MAX",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "hc-pending-max@test.local",
      password: PASSWORD,
      fullName: "Pending MAX",
      role: "manager",
    });
    const seeded = await seedTransfer(holder.id, pending.id, "P-MAX-01", { telegram: false });
    const app = await loadApp();
    const pool = getPool();
    assert.ok(pool);

    let failOnce = true;
    const sink = { calls: [] as Array<{ userId: string; text: string }> };
    const transport = async (input: { userId: bigint; text: string }) => {
      sink.calls.push({ userId: input.userId.toString(), text: input.text });
      if (failOnce) {
        failOnce = false;
        return { ok: false, code: "NETWORK_ERROR", message: "fail", retryable: true };
      }
      return { ok: true, result: { message: { mid: "1" } } };
    };

    await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_callback",
        timestamp: 400,
        callback: {
          callback_id: "cb-max-1",
          payload: "hc:gen:P-MAX-01",
          user: { user_id: seeded.maxUserId, is_bot: false },
        },
        message: { recipient: { chat_id: seeded.maxUserId } },
      });

    const maxLoaded = loadTanbotMaxStage2Config();
    assert.equal(maxLoaded.ok, true);
    if (!maxLoaded.ok) return;
    await runTanbotMaxOutboxWorkerOnce(pool, maxLoaded.config, transport as never);
    assert.equal(sink.calls.length, 1);
    const undelivered = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tanbot_max_update_dedup WHERE reply_delivered_at IS NULL AND reply_text IS NOT NULL`,
    );
    assert.equal(undelivered.rows[0]!.c, 1);

    await runTanbotMaxOutboxWorkerOnce(pool, maxLoaded.config, transport as never);
    const undelivered2 = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tanbot_max_update_dedup WHERE reply_delivered_at IS NULL AND reply_text IS NOT NULL`,
    );
    assert.equal(undelivered2.rows[0]!.c, 0);
    assert.equal(sink.calls.length, 2);
  });

  it("master-off blocks enabling MAX notifications", async () => {
    await resetPoolForTests();
    const user = await createTestUser({
      databaseUrl,
      email: "hc-max-off@test.local",
      password: PASSWORD,
      fullName: "Max Off",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    await pool.query(
      `INSERT INTO tanbot_max_accounts (user_id, max_user_id, max_chat_id, notifications_enabled, stopped_at)
       VALUES ($1::uuid, 900001, 900001, FALSE, NULL)`,
      [user.id],
    );
    process.env.TANBOT_MAX_ENABLED = "false";
    const app = await loadApp();
    const poolAfterLoad = getPool();
    assert.ok(poolAfterLoad);
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "hc-max-off@test.local", password: PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const res = await request(app)
      .post("/api/profile/tanbot/max/notifications")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ enabled: true });
    assert.equal(res.status, 503);
    const row = await poolAfterLoad.query(
      `SELECT notifications_enabled FROM tanbot_max_accounts WHERE user_id = $1::uuid`,
      [user.id],
    );
    assert.equal(row.rows[0]!.notifications_enabled, false);
    process.env.TANBOT_MAX_ENABLED = "true";
  });

  it("runtime worker entrypoint starts", () => {
    setPilotEnv();
    const worker = spawnSync(process.execPath, ["dist/cli/tanbot-max-outbox-worker.js"], {
      cwd: "/workspace",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "test",
        PGSSLMODE: "disable",
        TANBOT_MAX_DELIVERY_ENABLED: "false",
      },
      timeout: 15_000,
    });
    if (worker.status !== 0) {
      assert.fail(
        `worker exit ${worker.status}: ${worker.stderr?.toString() || worker.stdout?.toString()}`,
      );
    }
  });
});
