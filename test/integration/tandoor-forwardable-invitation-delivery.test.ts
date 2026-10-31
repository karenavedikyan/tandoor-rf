import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { getPool, closePool } from "../../src/db/pool";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";

const invitation = "Тандор · Получите код приёма: https://example.test/recipient?mst=synthetic";
describe("forwardable recipient invitation durable delivery", { concurrency: false }, () => {
  before(async () => {
    const url = getIntegrationDatabaseUrl();
    setIntegrationEnv(url, "http://127.0.0.1:3000");
    Object.assign(process.env, {
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
      TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:SYNTHETIC_TEST_TOKEN_abcdefghijklmnop",
      TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_test_bot",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-test-link-pepper-min16",
      TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-test-webhook-secret-min16",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
      TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_TEST_TOKEN_0123456789abcdef",
      TANBOT_MAX_BOT_USERNAME: "synthetic_test_bot",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-test-max-link-pepper-min16",
      TANBOT_MAX_WEBHOOK_SECRET: "synthetic-test-max-webhook-secret-min16",
    });
    await prepareDatabase(url);
  });
  after(async () => { await closePool(); });
  for (const channel of ["max", "telegram"] as const) {
    for (const scenario of ["success", "primary-fails", "invitation-fails", "concurrent"] as const) {
      it(`${channel}: ${scenario} preserves separate messages and retry progress`, async () => {
        const pool = getPool()!;
        const id = 982000 + (channel === "max" ? 10 : 20) + ["success", "primary-fails", "invitation-fails", "concurrent"].indexOf(scenario);
        const key = `forwardable-invite-${id}`;
        const table = channel === "max" ? "tanbot_max_update_dedup" : "tanbot_telegram_update_dedup";
        const column = channel === "max" ? "dedup_key" : "update_id";
        const rowId = channel === "max" ? key : id;
        const extra = { forwardInvitationText: invitation, futureMarker: { preserve: true } };
        if (channel === "max") {
          await pool.query(`INSERT INTO tanbot_max_update_dedup
            (dedup_key,status,reply_user_id,reply_chat_id,reply_text,reply_extra)
            VALUES($1,'committed',700001,800001,'Sender guidance',$2::jsonb)
            ON CONFLICT(dedup_key) DO UPDATE SET reply_extra=EXCLUDED.reply_extra,reply_delivered_at=NULL`,
          [key, JSON.stringify(extra)]);
        } else {
          await pool.query(`INSERT INTO tanbot_telegram_update_dedup
            (update_id,status,reply_chat_id,reply_text,reply_extra)
            VALUES($1,'committed',700001,'Sender guidance',$2::jsonb)
            ON CONFLICT(update_id) DO UPDATE SET reply_extra=EXCLUDED.reply_extra,reply_delivered_at=NULL`,
          [id, JSON.stringify(extra)]);
        }
        const attempts: string[] = [], delivered: string[] = [];
        let failed = false;
        const record = (text: string) => {
          attempts.push(text);
          const fail = !failed && ((scenario === "primary-fails" && text === "Sender guidance")
            || (scenario === "invitation-fails" && text === invitation));
          if (fail) { failed = true; return false; }
          delivered.push(text); return true;
        };
        const max: MaxDeliveryTransport = async input => {
          assert.equal(input.userId, 700001n);
          if (input.text === invitation) assert.equal(input.inlineButtons, undefined);
          return record(input.text)
            ? { ok: true, result: {} }
            : { ok: false, code: "HTTP", message: "Synthetic failure", retryable: true };
        };
        const telegram: TelegramDeliveryTransport = async input => {
          assert.equal(input.method, "sendMessage");
          assert.equal(input.body.chat_id, "700001");
          if (input.body.text === invitation) assert.equal(input.body.reply_markup, undefined);
          return record(String(input.body.text))
            ? { ok: true, result: {} }
            : { ok: false, code: "HTTP", message: "Synthetic failure", retryable: true };
        };
        const invoke = async () => {
          if (channel === "max") {
            const cfg = loadTanbotMaxStage2Config(); assert.ok(cfg.ok);
            return deliverMaxWebhookReply(pool, cfg.config, max, key,
              { userId: 700001n, chatId: 800001n, text: "Sender guidance" });
          }
          const cfg = loadTanbotTelegramStage2Config(); assert.ok(cfg.ok);
          return deliverTelegramWebhookReply(pool, cfg.config, telegram, id,
            { chatId: 700001n, text: "Sender guidance" });
        };
        if (scenario === "concurrent") {
          // Deliberately competing delivery workers; not independent research work.
          await Promise.all([invoke(), invoke()]);
        } else {
          await invoke();
          if (scenario.endsWith("fails")) {
            const row = (await pool.query(`SELECT reply_extra,reply_delivered_at FROM ${table} WHERE ${column}=$1`, [rowId])).rows[0];
            assert.equal(row.reply_delivered_at, null);
            assert.equal(row.reply_extra.delivery?.primary === true, scenario === "invitation-fails");
            assert.notEqual(row.reply_extra.delivery?.invitation, true);
            if (scenario === "primary-fails") assert.deepEqual(attempts, ["Sender guidance"]);
            await invoke();
          }
        }
        assert.deepEqual(delivered, ["Sender guidance", invitation]);
        const row = (await pool.query(`SELECT reply_extra,reply_delivered_at FROM ${table} WHERE ${column}=$1`, [rowId])).rows[0];
        assert.ok(row.reply_delivered_at);
        assert.equal(row.reply_extra.delivery.primary, true);
        assert.equal(row.reply_extra.delivery.invitation, true);
        assert.deepEqual(row.reply_extra.futureMarker, { preserve: true });
        const before = attempts.length;
        await invoke();
        assert.equal(attempts.length, before, "delivered messages are not replayed");
      });
    }
  }
});
