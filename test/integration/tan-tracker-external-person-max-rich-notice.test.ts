import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";
import { buildExternalPersonMessengerBody } from "../../src/tan-tracker/external-person/messenger-copy";
import { runTanbotMaxOutboxWorkerOnce } from "../../src/tanbot-max/outbox-scheduler";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import type { MaxDeliveryTransport, MaxInlineButton } from "../../src/tanbot-max/delivery-transport";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../../src/tan-tracker/phone-normalize";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const MAX_USER_ID = 887766301n;
const MAX_CHAT_ID = 887766351n;

async function seedKnownExternalParty(client: PoolClient, phoneRaw: string, displayName: string): Promise<void> {
  const phone = normalizeRuPhoneE164(phoneRaw);
  assert.ok(phone);
  await client.query(
    `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', $1, $2)`,
    [displayName, phone],
  );
}

describe("external person MAX rich notice presentation (PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = "SYNTH_MAX_RICH_NOTICE_TOKEN0123456";
    process.env.TANBOT_MAX_BOT_USERNAME = "tandoor_max_test_bot";
    process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "test-max-link-pepper-min-16-chars";
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("sends share attachment and link button without raw holder URL in text", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const cfg = loadTanbotMaxStage2Config(process.env);
    assert.equal(cfg.ok, true);
    if (!cfg.ok) return;

    const holderUrl = `${ORIGIN}/tan-tracker/?cap=synthetic-cap&tt_hat=synthetic-hat`;
    const storedBody = buildExternalPersonMessengerBody({
      event: "delivered",
      publicCode: "TT-2026-099",
      itemTitle: "Rich notice parcel",
      holderUrl,
    });

    const client = await pool.connect();
    let outboxId = "";
    try {
      await client.query("BEGIN");
      await seedKnownExternalParty(client, "+79995556701", "Rich notice");
      const person = await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: MAX_USER_ID,
        messengerChatId: MAX_CHAT_ID,
        phoneRaw: "+79995556701",
        displayName: "Rich notice",
      });
      outboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (
             person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, next_attempt_at
           ) VALUES ($1::uuid, 'max', $2, $3, $4, 'external_person.delivered', 'pending', NOW())
           RETURNING id::text`,
          [person.id, String(MAX_CHAT_ID), storedBody, `max-rich-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const maxCalls: Array<{
      userId: bigint;
      text: string;
      shareUrl?: string;
      inlineButtons?: MaxInlineButton[][];
    }> = [];
    const transport: MaxDeliveryTransport = async (input) => {
      maxCalls.push(input);
      return { ok: true, result: { message: { mid: "synthetic" } } };
    };

    await runTanbotMaxOutboxWorkerOnce(pool, cfg.config, transport);

    assert.equal(maxCalls.length, 1);
    assert.equal(maxCalls[0]!.userId, MAX_USER_ID);
    assert.ok(!maxCalls[0]!.text.includes("cap="));
    assert.ok(!maxCalls[0]!.text.includes("tt_hat"));
    assert.ok(!maxCalls[0]!.text.includes("Открыть:"));
    assert.match(maxCalls[0]!.text, /Rich notice parcel/);
    assert.equal(maxCalls[0]!.shareUrl, holderUrl);
    assert.equal(maxCalls[0]!.inlineButtons?.[0]?.[0]?.type, "link");

    const row = await pool.query(`SELECT status FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [
      outboxId,
    ]);
    assert.equal(row.rows[0]!.status, "sent");
  });
});
