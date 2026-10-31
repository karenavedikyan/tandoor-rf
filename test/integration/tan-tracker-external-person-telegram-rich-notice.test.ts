import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";
import { buildExternalPersonMessengerBody } from "../../src/tan-tracker/external-person/messenger-copy";
import { runTanbotOutboxWorkerOnce } from "../../src/tanbot-telegram/outbox-scheduler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../../src/tan-tracker/phone-normalize";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const TG_USER_ID = 887766401n;
const TG_CHAT_ID = 887766401n;

async function seedKnownExternalParty(client: PoolClient, phoneRaw: string, displayName: string): Promise<void> {
  const phone = normalizeRuPhoneE164(phoneRaw);
  assert.ok(phone);
  await client.query(
    `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', $1, $2)`,
    [displayName, phone],
  );
}

describe("external person Telegram rich notice presentation (PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_TG_RICH_NOTICE_TOKEN_abcdefghijklmnop";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "tandoor_tg_test_bot";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("sends inline URL button and branded preview without raw holder URL in text", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const cfg = loadTanbotTelegramStage2Config(process.env);
    assert.equal(cfg.ok, true);
    if (!cfg.ok) return;

    const holderUrl = `${ORIGIN}/tan-tracker/?cap=synthetic-cap&tt_hat=synthetic-hat`;
    const storedBody = buildExternalPersonMessengerBody({
      event: "delivered",
      publicCode: "TT-2026-100",
      itemTitle: "Telegram rich parcel",
      holderUrl,
    });

    const client = await pool.connect();
    let outboxId = "";
    try {
      await client.query("BEGIN");
      await seedKnownExternalParty(client, "+79995556702", "TG rich notice");
      const person = await upsertVerifiedPerson(client, {
        channel: "telegram",
        messengerUserId: TG_USER_ID,
        messengerChatId: TG_CHAT_ID,
        phoneRaw: "+79995556702",
        displayName: "TG rich notice",
      });
      outboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (
             person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, next_attempt_at
           ) VALUES ($1::uuid, 'telegram', $2, $3, $4, 'external_person.delivered', 'pending', NOW())
           RETURNING id::text`,
          [person.id, String(TG_CHAT_ID), storedBody, `tg-rich-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const tgCalls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const transport: TelegramDeliveryTransport = async (input) => {
      tgCalls.push({ method: input.method, body: input.body });
      return { ok: true, result: { message_id: tgCalls.length } };
    };

    await runTanbotOutboxWorkerOnce(pool, cfg.config, transport);

    const send = tgCalls.find((c) => c.method === "sendMessage");
    assert.ok(send);
    const text = String(send!.body.text);
    assert.ok(!text.includes("cap="));
    assert.ok(!text.includes("tt_hat"));
    assert.ok(!text.includes("Открыть:"));
    assert.match(text, /Telegram rich parcel/);
    const markup = send!.body.reply_markup as {
      inline_keyboard?: Array<Array<{ url?: string; text?: string }>>;
    };
    assert.equal(markup.inline_keyboard?.[0]?.[0]?.text, "Открыть передачу");
    assert.equal(markup.inline_keyboard?.[0]?.[0]?.url, holderUrl);
    const preview = send!.body.link_preview_options as { url?: string; is_disabled?: boolean };
    assert.equal(preview.url, `${ORIGIN}/tan-tracker/`);
    assert.equal(preview.is_disabled, false);

    const row = await pool.query(`SELECT status FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [
      outboxId,
    ]);
    assert.equal(row.rows[0]!.status, "sent");
  });
});
