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
import {
  buildHandoffGenCallback,
} from "../../src/tanbot/handoff-code-bot-service";
import { fanoutStaffTransferNotification, transferPayload } from "../../src/tan-tracker/staff-notify-fanout";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();
const repoRoot = process.cwd();

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

    const sendMessages = sink.calls.filter((c) => c.method === "sendMessage");
    assert.equal(sendMessages.length, 1);
    const text = String(sendMessages[0]!.body.text);
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
    const outsiderText = sink.calls.filter((c) => c.method === "sendMessage").at(-1)?.body.text;
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

  it("telegram: menu worker retry and dedup resend keep inline keyboard", async () => {
    const holder = await createTestUser({
      databaseUrl,
      email: "hc-menu-tg-holder@test.local",
      password: PASSWORD,
      fullName: "Menu Holder",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "hc-menu-tg-pending@test.local",
      password: PASSWORD,
      fullName: "Menu Pending",
      role: "manager",
    });
    const seeded = await seedTransfer(holder.id, pending.id, "P-TG-MENU", { max: false });
    const app = await loadApp();
    const pool = getPool();
    assert.ok(pool);
    const updateId = 13101;
    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: updateId,
        message: {
          message_id: 1,
          from: { id: seeded.telegramUserId, is_bot: false, first_name: "B" },
          chat: { id: seeded.telegramUserId, type: "private" },
          date: 1,
          text: "/code",
        },
      });

    const stored = await pool.query<{ reply_extra: unknown }>(
      `SELECT reply_extra FROM tanbot_telegram_update_dedup WHERE update_id = $1`,
      [updateId],
    );
    assert.ok(stored.rows[0]?.reply_extra);

    let failOnce = true;
    const sink = { calls: [] as Array<{ method: string; body: Record<string, unknown> }> };
    const transport: TelegramDeliveryTransport = async (input) => {
      sink.calls.push({ method: input.method, body: input.body });
      if (input.method === "sendMessage" && failOnce) {
        failOnce = false;
        return { ok: false, code: "NETWORK_ERROR", message: "fail", retryable: true };
      }
      if (input.method === "sendMessage") {
        return { ok: true, result: {} };
      }
      return { ok: true, result: true };
    };

    const tgLoaded = loadTanbotTelegramStage2Config();
    assert.equal(tgLoaded.ok, true);
    if (!tgLoaded.ok) return;
    await runTanbotOutboxWorkerOnce(pool, tgLoaded.config, transport);
    const send = sink.calls.find((c) => c.method === "sendMessage");
    assert.ok(send, sink.calls.map((c) => c.method).join(","));
    const markup = send!.body.reply_markup as {
      inline_keyboard?: Array<Array<{ callback_data?: string }>>;
    };
    assert.equal(markup.inline_keyboard?.[0]?.[0]?.callback_data, buildHandoffGenCallback("P-TG-MENU"));

    const codesBefore = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = 'tt-P-TG-MENU'`,
    );
    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: updateId,
        message: {
          message_id: 1,
          from: { id: seeded.telegramUserId, is_bot: false },
          chat: { id: seeded.telegramUserId, type: "private" },
          date: 1,
          text: "/code",
        },
      });
    const codesAfterResend = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = 'tt-P-TG-MENU'`,
    );
    assert.equal(codesBefore.rows[0]!.c, codesAfterResend.rows[0]!.c);

    sink.calls.length = 0;
    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 13102,
        callback_query: {
          id: "cq-menu-gen",
          from: { id: seeded.telegramUserId, is_bot: false },
          message: { chat: { id: seeded.telegramUserId, type: "private" } },
          data: buildHandoffGenCallback("P-TG-MENU"),
        },
      });
    await runTanbotOutboxWorkerOnce(pool, tgLoaded.config, transport);
    const codesAfterGen = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = 'tt-P-TG-MENU'`,
    );
    assert.equal(codesAfterResend.rows[0]!.c + 1, codesAfterGen.rows[0]!.c);
  });

  it("max: menu worker retry and dedup resend keep inline buttons", async () => {
    const holder = await createTestUser({
      databaseUrl,
      email: "hc-menu-max-holder@test.local",
      password: PASSWORD,
      fullName: "Menu MAX Holder",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "hc-menu-max-pending@test.local",
      password: PASSWORD,
      fullName: "Menu MAX Pending",
      role: "manager",
    });
    const seeded = await seedTransfer(holder.id, pending.id, "P-MAX-MENU", { telegram: false });
    const app = await loadApp();
    const pool = getPool();
    assert.ok(pool);

    await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_callback",
        timestamp: 501,
        callback: {
          callback_id: "cb-menu",
          payload: "hc:menu",
          user: { user_id: seeded.maxUserId, is_bot: false },
        },
        message: { recipient: { chat_id: seeded.maxUserId } },
      });

    const dedup = await pool.query<{ reply_extra: unknown }>(
      `SELECT reply_extra FROM tanbot_max_update_dedup WHERE reply_text IS NOT NULL ORDER BY received_at DESC LIMIT 1`,
    );
    assert.ok(dedup.rows[0]?.reply_extra);

    let failOnce = true;
    const sink = { calls: [] as Array<{ inlineButtons?: unknown }> };
    const transport: MaxDeliveryTransport = async (input) => {
      sink.calls.push({ inlineButtons: input.inlineButtons });
      if (failOnce) {
        failOnce = false;
        return { ok: false, code: "NETWORK_ERROR", message: "fail", retryable: true };
      }
      return { ok: true, result: { message: { mid: "m-retry" } } };
    };

    const maxLoaded = loadTanbotMaxStage2Config();
    assert.equal(maxLoaded.ok, true);
    if (!maxLoaded.ok) return;
    await runTanbotMaxOutboxWorkerOnce(pool, maxLoaded.config, transport);
    assert.ok(sink.calls[0]?.inlineButtons);
    const buttons = sink.calls[0]!.inlineButtons as Array<
      Array<{ type?: string; payload?: string }>
    >;
    assert.equal(buttons[0]?.[0]?.type, "callback");
    assert.equal(buttons[0]?.[0]?.payload, buildHandoffGenCallback("P-MAX-MENU"));

    const codesBefore = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = 'tt-P-MAX-MENU'`,
    );
    await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_callback",
        timestamp: 501,
        callback: {
          callback_id: "cb-menu",
          payload: "hc:menu",
          user: { user_id: seeded.maxUserId, is_bot: false },
        },
        message: { recipient: { chat_id: seeded.maxUserId } },
      });
    const codesAfterResend = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = 'tt-P-MAX-MENU'`,
    );
    assert.equal(codesBefore.rows[0]!.c, codesAfterResend.rows[0]!.c);
  });

  it("max external_created outbox sends one receipt-code button (structured payload)", async () => {
    await resetPoolForTests();
    const holder = await createTestUser({
      databaseUrl,
      email: "hc-ext-holder@test.local",
      password: PASSWORD,
      fullName: "Ext Holder",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "hc-ext-pending@test.local",
      password: PASSWORD,
      fullName: "Ext Pending",
      role: "manager",
    });
    const seeded = await seedTransfer(holder.id, pending.id, "P-EXT-MAX", { telegram: false });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await fanoutStaffTransferNotification(client, {
        eventType: "tan_tracker.external_created",
        recipientUserIds: [pending.id],
        payload: transferPayload({
          transferId: seeded.transferId,
          publicCode: "P-EXT-MAX",
          itemTitle: "External box",
          handoffVersion: 1,
        }),
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const sink = {
      calls: [] as Array<{ userId: string; text: string; inlineButtons?: unknown }>,
    };
    const transport = createRecordingMaxDeliveryTransport(sink);
    const maxLoaded = loadTanbotMaxStage2Config();
    assert.equal(maxLoaded.ok, true);
    if (!maxLoaded.ok) return;
    await runTanbotMaxOutboxWorkerOnce(pool, maxLoaded.config, transport);
    const call =
      sink.calls.find((c) => String(c.text).includes("P-EXT-MAX")) ?? sink.calls.at(-1);
    assert.ok(call, "expected MAX delivery for P-EXT-MAX");
    assert.match(call!.text, /код приёма/i);
    const buttons = call!.inlineButtons as Array<Array<{ payload: string; text: string }>>;
    assert.equal(buttons?.[0]?.[0]?.text, "Получить код приёма");
    assert.equal(buttons?.[0]?.[0]?.payload, buildHandoffGenCallback("P-EXT-MAX", 1));
    assert.ok(!/\d{6}/.test(call!.text));
  });

  it("max: stale handoffVersion callback does not issue code or mutate transfer", async () => {
    const holder = await createTestUser({
      databaseUrl,
      email: "hc-stale-holder@test.local",
      password: PASSWORD,
      fullName: "Stale Holder",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "hc-stale-pending@test.local",
      password: PASSWORD,
      fullName: "Stale Pending",
      role: "manager",
    });
    const seeded = await seedTransfer(holder.id, pending.id, "P-STALE-1", { telegram: false });
    const app = await loadApp();
    const pool = getPool();
    assert.ok(pool);
    const before = await pool.query<{
      handoff_version: number;
      holder_party_id: string;
      status: string;
    }>(`SELECT handoff_version, holder_party_id::text, status FROM tt_transfers WHERE id = $1`, [
      seeded.transferId,
    ]);

    const sink = { calls: [] as Array<{ userId: string; text: string }> };
    const recording = createRecordingMaxDeliveryTransport(sink);

    await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_callback",
        timestamp: 601,
        callback: {
          callback_id: "cb-stale",
          payload: buildHandoffGenCallback("P-STALE-1", 99),
          user: { user_id: seeded.maxUserId, is_bot: false },
        },
        message: { recipient: { chat_id: seeded.maxUserId } },
      });

    const maxLoaded = loadTanbotMaxStage2Config();
    assert.equal(maxLoaded.ok, true);
    if (!maxLoaded.ok) return;
    await runTanbotMaxOutboxWorkerOnce(pool, maxLoaded.config, recording);
    assert.equal(sink.calls.length, 1);
    assert.match(sink.calls[0]!.text, /обновилась|недоступ/i);
    assert.ok(!/\d{6}/.test(sink.calls[0]!.text));

    const codes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes WHERE transfer_id = $1`,
      [seeded.transferId],
    );
    assert.equal(codes.rows[0]!.c, 0);
    const after = await pool.query<{
      handoff_version: number;
      holder_party_id: string;
      status: string;
    }>(`SELECT handoff_version, holder_party_id::text, status FROM tt_transfers WHERE id = $1`, [
      seeded.transferId,
    ]);
    assert.deepEqual(after.rows[0], before.rows[0]);
  });

  it("max: issuing code does not change holder, status, or handoff_version", async () => {
    const holder = await createTestUser({
      databaseUrl,
      email: "hc-issue-holder@test.local",
      password: PASSWORD,
      fullName: "Issue Holder",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "hc-issue-pending@test.local",
      password: PASSWORD,
      fullName: "Issue Pending",
      role: "manager",
    });
    const seeded = await seedTransfer(holder.id, pending.id, "P-ISSUE-1", { telegram: false });
    const app = await loadApp();
    const pool = getPool();
    assert.ok(pool);
    const before = await pool.query<{
      handoff_version: number;
      holder_party_id: string;
      status: string;
    }>(`SELECT handoff_version, holder_party_id::text, status FROM tt_transfers WHERE id = $1`, [
      seeded.transferId,
    ]);

    const sink = { calls: [] as Array<{ userId: string; text: string }> };
    const recording = createRecordingMaxDeliveryTransport(sink);
    await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_callback",
        timestamp: 602,
        callback: {
          callback_id: "cb-issue",
          payload: buildHandoffGenCallback("P-ISSUE-1", 1),
          user: { user_id: seeded.maxUserId, is_bot: false },
        },
        message: { recipient: { chat_id: seeded.maxUserId } },
      });
    const maxLoaded = loadTanbotMaxStage2Config();
    assert.equal(maxLoaded.ok, true);
    if (!maxLoaded.ok) return;
    await runTanbotMaxOutboxWorkerOnce(pool, maxLoaded.config, recording);
    assert.match(sink.calls[0]!.text, /\d{6}/);

    const after = await pool.query<{
      handoff_version: number;
      holder_party_id: string;
      status: string;
    }>(`SELECT handoff_version, holder_party_id::text, status FROM tt_transfers WHERE id = $1`, [
      seeded.transferId,
    ]);
    assert.deepEqual(after.rows[0], before.rows[0]);
  });

  it("runtime worker entrypoint starts", () => {
    setPilotEnv();
    const worker = spawnSync(process.execPath, ["dist/cli/tanbot-max-outbox-worker.js"], {
      cwd: repoRoot,
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
