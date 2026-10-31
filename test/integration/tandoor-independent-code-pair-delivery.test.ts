import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Pool, PoolClient } from "pg";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";

const url = getIntegrationDatabaseUrl();
type Channel = "telegram" | "max";
let serial = 990000;
const primary = "Код приёма тестовой передачи: 012345. Сообщите отправителю.";
const marker = { kind: "synthetic-future-media", references: ["synthetic-local-ref"] };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe("independent persisted private code-pair delivery", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(url, "http://127.0.0.1:3000");
    for (const channel of ["TELEGRAM", "MAX"]) {
      process.env[`TANBOT_${channel}_ENABLED`] = "true";
      process.env[`TANBOT_${channel}_BOT_TOKEN`] = channel === "TELEGRAM"
        ? "123456789:SYNTHETIC_PAIR_TOKEN_abcdefghijklmnopqrstuvwxyz"
        : "SYNTHETIC_PAIR_MAX_TOKEN_abcdefghijklmnopqrstuvwxyz";
      process.env[`TANBOT_${channel}_BOT_USERNAME`] = channel === "TELEGRAM" ? "TANDOOR_IBOT" : "tandoor_bot";
      process.env[`TANBOT_${channel}_LINK_TOKEN_PEPPER`] = "synthetic-pair-pepper-minimum-16";
      process.env[`TANBOT_${channel}_WEBHOOK_SECRET`] = "synthetic-pair-secret-minimum-16";
      process.env[`TANBOT_${channel}_WEBHOOK_ENABLED`] = "true";
      process.env[`TANBOT_${channel}_DELIVERY_ENABLED`] = "false";
    }
    await prepareDatabase(url);
    await resetPoolForTests();
  });
  after(async () => { await closePool(); });

  for (const channel of ["telegram", "max"] as const) {
    const table = channel === "telegram" ? "tanbot_telegram_update_dedup" : "tanbot_max_update_dedup";
    const keyColumn = channel === "telegram" ? "update_id" : "dedup_key";
    async function seed() {
      const id = ++serial;
      const key = channel === "telegram" ? id : id.toString(16).padStart(64, "0");
      const columns = channel === "telegram"
        ? "update_id, reply_chat_id"
        : "dedup_key, reply_chat_id, reply_user_id";
      const values = channel === "telegram" ? "$1, 778899" : "$1, 778899, 778899";
      await getPool().query(
        `INSERT INTO ${table} (${columns}, reply_text, reply_extra, status)
         VALUES (${values}, $2, $3::jsonb, 'committed')`,
        [key, primary, JSON.stringify({ copyOnlyCode: "012345", futureMedia: marker })]);
      return key;
    }
    async function row(key: number | string) {
      return (await getPool().query(`SELECT reply_extra, reply_delivered_at FROM ${table} WHERE ${keyColumn}=$1`, [key])).rows[0];
    }
    async function deliver(db: Pool | PoolClient, key: number | string,
      send: (text: string) => Promise<boolean>) {
      if (channel === "telegram") {
        const config = loadTanbotTelegramStage2Config();
        assert.ok(config.ok);
        const transport: TelegramDeliveryTransport = async ({ method, body }) => {
          assert.equal(method, "sendMessage");
          assert.equal(String(body.chat_id), "778899");
          return await send(String(body.text))
            ? { ok: true, result: {} }
            : { ok: false, code: "HTTP_ERROR", message: "synthetic controlled failure", retryable: true };
        };
        return deliverTelegramWebhookReply(db, config.config, transport, Number(key), { chatId: 778899n, text: primary });
      }
      const config = loadTanbotMaxStage2Config();
      assert.ok(config.ok);
      const transport: MaxDeliveryTransport = async ({ userId, text }) => {
        assert.equal(userId, 778899n);
        return await send(text)
          ? { ok: true, result: {} }
          : { ok: false, code: "HTTP_ERROR", message: "synthetic controlled failure", retryable: true };
      };
      return deliverMaxWebhookReply(db, config.config, transport, String(key), { userId: 778899n, chatId: 778899n, text: primary });
    }

    it(`${channel}: confirmed primary survives copy failure, unknown extras survive all progress`, async () => {
      const key = await seed();
      const calls: string[] = [];
      await deliver(getPool(), key, async text => { calls.push(text); return text !== "012345"; });
      assert.deepEqual(calls, [primary, "012345"]);
      let stored = await row(key);
      assert.deepEqual(stored.reply_extra.futureMedia, marker, "delivery must not erase future media metadata");
      assert.equal(stored.reply_delivered_at, null);
      const retried: string[] = [];
      await deliver(getPool(), key, async text => { retried.push(text); return true; });
      assert.deepEqual(retried, ["012345"], "only the unconfirmed second part is retried");
      stored = await row(key);
      assert.ok(stored.reply_delivered_at);
      assert.deepEqual(stored.reply_extra.futureMedia, marker);
      await deliver(getPool(), key, async () => { assert.fail("fully delivered pair was resent"); });
    });

    it(`${channel}: concurrent delivery callers cannot duplicate confirmed parts`, { timeout: 15000 }, async () => {
      const key = await seed();
      const enteredPrimary = deferred();
      const releasePrimary = deferred();
      const contenderReachedDatabase = deferred();
      const calls: string[] = [];
      const send = async (text: string) => {
        calls.push(text);
        if (text === primary && calls.length === 1) {
          enteredPrimary.resolve();
          await releasePrimary.promise;
        }
        return true;
      };
      function instrument<T extends Pool | PoolClient>(target: T): T {
        return new Proxy(target, {
          get(object, property) {
            if (property === "connect") return async () => instrument(await (object as Pool).connect());
            if (property === "query") return async (...args: unknown[]) => {
              const sql = typeof args[0] === "string" ? args[0] : String((args[0] as { text?: string })?.text);
              if (/pg_(?:try_)?advisory_|FOR (?:NO KEY )?UPDATE/i.test(sql)) contenderReachedDatabase.resolve();
              const result = await (object.query as (...a: unknown[]) => Promise<unknown>).apply(object, args);
              if (/\bSELECT\b[\s\S]*reply_extra/i.test(sql)) contenderReachedDatabase.resolve();
              return result;
            };
            const value = Reflect.get(object, property, object);
            return typeof value === "function" ? value.bind(object) : value;
          },
        });
      }
      const first = deliver(getPool(), key, send);
      let second: ReturnType<typeof deliver> | undefined;
      try {
        await enteredPrimary.promise;
        second = deliver(instrument(getPool()), key, send);
        await contenderReachedDatabase.promise;
      } finally {
        releasePrimary.resolve();
        await Promise.all([first, second]);
      }
      assert.deepEqual(calls, [primary, "012345"], "one explanatory message and one copy message across both callers");
      const stored = await row(key);
      assert.ok(stored.reply_delivered_at);
      assert.deepEqual(stored.reply_extra.futureMedia, marker);
    });
  }
});
