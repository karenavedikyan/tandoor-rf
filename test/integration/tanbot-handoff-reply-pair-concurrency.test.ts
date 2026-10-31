import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Pool } from "pg";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import { parseTelegramReplyExtra } from "../../src/tanbot/webhook-reply-extra";

const ORIGIN = "http://127.0.0.1:3000";
const databaseUrl = getIntegrationDatabaseUrl();

function setEnv(): void {
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
  process.env.TANBOT_MAX_BOT_TOKEN = "SYNTHETIC_MAX_TEST_TOKEN_0123456789abcdef";
  process.env.TANBOT_MAX_BOT_USERNAME = "synthetic_test_bot";
  process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "synthetic-max-link-pepper-min-16";
  process.env.TANBOT_MAX_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_MAX_WEBHOOK_SECRET = "synthetic-max-webhook-secret-min16";
  process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
}

describe("handoff reply pair delivery concurrency", { concurrency: false }, () => {
  before(async () => {
    setEnv();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("telegram: concurrent deliverers emit one primary and one copy-only send", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const updateId = 991001;
    const copyCode = "654321";
    await pool.query(
      `INSERT INTO tanbot_telegram_update_dedup (update_id, status, reply_chat_id, reply_text, reply_extra)
       VALUES ($1, 'committed', 700001, 'Primary explanatory body', $2::jsonb)
       ON CONFLICT (update_id) DO UPDATE SET reply_text = EXCLUDED.reply_text, reply_extra = EXCLUDED.reply_extra, reply_delivered_at = NULL`,
      [
        updateId,
        JSON.stringify({
          copyOnlyCode: copyCode,
          delivery: { primary: false, copyOnly: false },
          futureMedia: { phase: "queued", token: "native-test" },
        }),
      ],
    );

    let primarySent = 0;
    let copySent = 0;
    let gateResolve: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });

    const transport: TelegramDeliveryTransport = async ({ method, body }) => {
      if (method !== "sendMessage") return { ok: true, result: {} };
      const text = String(body.text);
      if (text === copyCode) {
        copySent += 1;
        return { ok: true, result: {} };
      }
      primarySent += 1;
      if (primarySent === 1) await gate;
      return { ok: true, result: {} };
    };

    const cfg = loadTanbotTelegramStage2Config();
    assert.equal(cfg.ok, true);
    if (!cfg.ok) return;

    const reply = { chatId: 700001n, text: "Primary explanatory body" };
    const p1 = deliverTelegramWebhookReply(pool, cfg.config, transport, updateId, reply);
    const p2 = deliverTelegramWebhookReply(pool, cfg.config, transport, updateId, reply);
    await new Promise((r) => setTimeout(r, 30));
    gateResolve!();
    await Promise.all([p1, p2]);

    assert.equal(primarySent, 1);
    assert.equal(copySent, 1);

    const row = await pool.query<{ reply_extra: unknown; reply_delivered_at: Date | null }>(
      `SELECT reply_extra, reply_delivered_at FROM tanbot_telegram_update_dedup WHERE update_id = $1`,
      [updateId],
    );
    const extra = parseTelegramReplyExtra(row.rows[0]?.reply_extra);
    assert.equal(extra.delivery?.primary, true);
    assert.equal(extra.delivery?.copyOnly, true);
    assert.ok(row.rows[0]?.reply_delivered_at);
    const raw = row.rows[0]?.reply_extra as Record<string, unknown>;
    assert.deepEqual(raw.futureMedia, { phase: "queued", token: "native-test" });
  });

  it("max: copy-only failure then retry sends only copy without second primary", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const dedupKey = "max-pair-retry-1";
    const copyCode = "112233";
    await pool.query(
      `INSERT INTO tanbot_max_update_dedup (dedup_key, status, reply_user_id, reply_text, reply_extra)
       VALUES ($1, 'committed', 800001, 'Max primary text', $2::jsonb)
       ON CONFLICT (dedup_key) DO UPDATE SET reply_text = EXCLUDED.reply_text, reply_extra = EXCLUDED.reply_extra, reply_delivered_at = NULL`,
      [
        dedupKey,
        JSON.stringify({ copyOnlyCode: copyCode, delivery: { primary: false, copyOnly: false }, futureMedia: { ok: true } }),
      ],
    );

    let sendCount = 0;
    const transport: MaxDeliveryTransport = async ({ text }) => {
      sendCount += 1;
      if (text === copyCode && sendCount === 2) {
        return { ok: false, code: "NETWORK_ERROR", message: "fail", retryable: true };
      }
      return { ok: true, result: { message: { mid: String(sendCount) } } };
    };

    const cfg = loadTanbotMaxStage2Config();
    assert.equal(cfg.ok, true);
    if (!cfg.ok) return;

    const reply = { userId: 800001n, chatId: 800001n, text: "Max primary text" };
    await deliverMaxWebhookReply(pool, cfg.config, transport, dedupKey, reply);
    const mid = await pool.query(`SELECT reply_extra, reply_delivered_at FROM tanbot_max_update_dedup WHERE dedup_key = $1`, [
      dedupKey,
    ]);
    assert.equal(mid.rows[0]?.reply_delivered_at, null);

    await deliverMaxWebhookReply(pool, cfg.config, transport, dedupKey, reply);
    const done = await pool.query(`SELECT reply_extra, reply_delivered_at FROM tanbot_max_update_dedup WHERE dedup_key = $1`, [
      dedupKey,
    ]);
    assert.ok(done.rows[0]?.reply_delivered_at);
    const raw = done.rows[0]?.reply_extra as Record<string, unknown>;
    assert.deepEqual(raw.futureMedia, { ok: true });
    assert.equal(sendCount, 3, "one primary, two copy attempts");
  });
});
