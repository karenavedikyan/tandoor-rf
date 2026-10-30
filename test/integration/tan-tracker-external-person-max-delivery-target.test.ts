import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";
import { processExternalPersonMessageOutbox } from "../../src/tan-tracker/external-person/outbox-worker";
import { runTanbotMaxOutboxWorkerOnce } from "../../src/tanbot-max/outbox-scheduler";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import type { PoolClient } from "pg";
import { normalizeRuPhoneE164 } from "../../src/tan-tracker/phone-normalize";

const databaseUrl = getIntegrationDatabaseUrl();

async function seedKnownExternalParty(client: PoolClient, phoneRaw: string, displayName: string): Promise<void> {
  const phone = normalizeRuPhoneE164(phoneRaw);
  assert.ok(phone);
  await client.query(
    `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', $1, $2)`,
    [displayName, phone],
  );
}
const MAX_BOT_TOKEN = "SYNTH_MAX_DELIVERY_TARGET_TOKEN012345";
const PHONE = "+79995556677";
const MAX_USER_ID = 887766001n;
const MAX_CHAT_ID = 887766552n;
const MAX_USER_CANCEL = 887766201n;
const MAX_CHAT_CANCEL = 887766251n;
const MAX_USER_OPTOUT = 887766202n;
const MAX_CHAT_OPTOUT = 887766252n;
const MAX_USER_MASTER_OFF = 887766203n;
const MAX_CHAT_MASTER_OFF = 887766253n;
const TG_USER_ID = 776655001n;
const TG_CHAT_ID = 776655992n;

describe("external person MAX delivery uses messenger_user_id (PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = MAX_BOT_TOKEN;
    process.env.TANBOT_MAX_BOT_USERNAME = "tandoor_max_test_bot";
    process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "test-max-link-pepper-min-16-chars";
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("runTanbotMaxOutboxWorkerOnce sends external notice to MAX user_id not chat_id", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const cfg = loadTanbotMaxStage2Config(process.env);
    assert.equal(cfg.ok, true);
    if (!cfg.ok) return;

    const client = await pool.connect();
    let outboxId = "";
    let personId = "";
    const holderLink = "https://example.test/tan-tracker/holder/erTESTHOLDERLINK00000000000001";
    try {
      await client.query("BEGIN");
      await seedKnownExternalParty(client, PHONE, "Max Target Recipient");
      const person = await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: MAX_USER_ID,
        messengerChatId: MAX_CHAT_ID,
        phoneRaw: PHONE,
        displayName: "Max Target Recipient",
      });
      personId = person.id;
      outboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (
             person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, next_attempt_at
           ) VALUES ($1::uuid, 'max', $2, $3, $4, 'external_person.delivered', 'pending', NOW())
           RETURNING id::text`,
          [
            personId,
            String(MAX_CHAT_ID),
            `Доставлено. Открыть: ${holderLink}`,
            `max-delivery-target-happy-${randomUUID()}`,
          ],
        )
      ).rows[0]!.id;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const maxCalls: Array<{ userId: bigint; text: string }> = [];
    const transport: MaxDeliveryTransport = async (input) => {
      maxCalls.push({ userId: input.userId, text: input.text });
      assert.match(input.text, /Открыть:/);
      assert.ok(input.text.includes(holderLink));
      return { ok: true, result: { message: { mid: "synthetic" } } };
    };

    await runTanbotMaxOutboxWorkerOnce(pool, cfg.config, transport);

    assert.equal(maxCalls.length, 1);
    assert.equal(maxCalls[0]!.userId, MAX_USER_ID);
    assert.notEqual(maxCalls[0]!.userId, MAX_CHAT_ID);

    const row = await pool.query<{ status: string; attempt_count: number; last_error_code: string | null }>(
      `SELECT status, attempt_count, last_error_code FROM tt_external_person_message_outbox WHERE id = $1::uuid`,
      [outboxId],
    );
    assert.equal(row.rows[0]!.status, "sent");
    assert.equal(row.rows[0]!.attempt_count, 1);
    assert.equal(row.rows[0]!.last_error_code, null);
  });

  it("telegram external transport still targets chat_id when user_id differs", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let outboxId = "";
    try {
      await client.query("BEGIN");
      await seedKnownExternalParty(client, "+79995556678", "Tg Target Recipient");
      const person = await upsertVerifiedPerson(client, {
        channel: "telegram",
        messengerUserId: TG_USER_ID,
        messengerChatId: TG_CHAT_ID,
        phoneRaw: "+79995556678",
        displayName: "Tg Target Recipient",
      });
      outboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (
             person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, next_attempt_at
           ) VALUES ($1::uuid, 'telegram', $2, 'TG delivered body', $3, 'external_person.delivered', 'pending', NOW())
           RETURNING id::text`,
          [person.id, String(TG_CHAT_ID), `tg-target-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const tgCalls: Array<{ chatId: string; messengerUserId: string }> = [];
    await processExternalPersonMessageOutbox(pool, {
      channel: "telegram",
      botToken: "fake",
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      deliveryEnabled: true,
      transport: async ({ chatId, messengerUserId }) => {
        tgCalls.push({ chatId, messengerUserId });
        return { ok: true };
      },
    });

    assert.equal(tgCalls.length, 1);
    assert.equal(tgCalls[0]!.chatId, String(TG_CHAT_ID));
    assert.equal(tgCalls[0]!.messengerUserId, String(TG_USER_ID));

    const row = await pool.query(`SELECT status FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [
      outboxId,
    ]);
    assert.equal(row.rows[0]!.status, "sent");
  });

  it("cancels stale chat binding and invalid MAX user id without sending", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let staleId = "";
    let badUserId = "";
    try {
      await client.query("BEGIN");
      await seedKnownExternalParty(client, "+79995556679", "Cancel cases");
      const person = await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: MAX_USER_CANCEL,
        messengerChatId: MAX_CHAT_CANCEL,
        phoneRaw: "+79995556679",
        displayName: "Cancel cases",
      });
      staleId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
           VALUES ($1::uuid, 'max', '111111111', 'stale', $2, 'pending', NOW()) RETURNING id::text`,
          [person.id, `stale-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client.query(
        `UPDATE tt_external_person_verifications SET messenger_user_id = 'not-numeric'
         WHERE person_id = $1::uuid AND channel = 'max'`,
        [person.id],
      );
      badUserId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
           VALUES ($1::uuid, 'max', $2, 'bad uid', $3, 'pending', NOW()) RETURNING id::text`,
          [person.id, String(MAX_CHAT_CANCEL), `baduid-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    let sendCount = 0;
    await processExternalPersonMessageOutbox(pool, {
      channel: "max",
      botToken: MAX_BOT_TOKEN,
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      deliveryEnabled: true,
      transport: async () => {
        sendCount += 1;
        return { ok: true };
      },
    });
    assert.equal(sendCount, 0);

    const stale = await pool.query(`SELECT status, last_error_code FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [
      staleId,
    ]);
    assert.equal(stale.rows[0]!.status, "cancelled");
    assert.equal(stale.rows[0]!.last_error_code, "NO_VERIFICATION");

    const bad = await pool.query(`SELECT status, last_error_code FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [
      badUserId,
    ]);
    assert.equal(bad.rows[0]!.status, "cancelled");
    assert.equal(bad.rows[0]!.last_error_code, "INVALID_MESSENGER_USER_ID");
  });

  it("respects per-channel opt-out without send", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let outboxId = "";
    try {
      await client.query("BEGIN");
      await seedKnownExternalParty(client, "+79995556680", "Opt out");
      const person = await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: MAX_USER_OPTOUT,
        messengerChatId: MAX_CHAT_OPTOUT,
        phoneRaw: "+79995556680",
        displayName: "Opt out",
      });
      await client.query(
        `UPDATE tt_external_person_verifications SET notifications_enabled = FALSE WHERE person_id = $1::uuid AND channel = 'max'`,
        [person.id],
      );
      outboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
           VALUES ($1::uuid, 'max', $2, 'optout', $3, 'pending', NOW()) RETURNING id::text`,
          [person.id, String(MAX_CHAT_OPTOUT), `optout-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    let sendCount = 0;
    await processExternalPersonMessageOutbox(pool, {
      channel: "max",
      botToken: MAX_BOT_TOKEN,
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      deliveryEnabled: true,
      transport: async () => {
        sendCount += 1;
        return { ok: true };
      },
    });
    assert.equal(sendCount, 0);
    const row = await pool.query(`SELECT status, last_error_code FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [
      outboxId,
    ]);
    assert.equal(row.rows[0]!.status, "cancelled");
    assert.equal(row.rows[0]!.last_error_code, "NO_VERIFICATION");
  });

  it("master delivery off leaves row pending without transport call", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let outboxId = "";
    try {
      await client.query("BEGIN");
      await seedKnownExternalParty(client, "+79995556681", "Master off");
      const person = await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: MAX_USER_MASTER_OFF,
        messengerChatId: MAX_CHAT_MASTER_OFF,
        phoneRaw: "+79995556681",
        displayName: "Master off",
      });
      outboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
           VALUES ($1::uuid, 'max', $2, 'master off', $3, 'pending', NOW()) RETURNING id::text`,
          [person.id, String(MAX_CHAT_MASTER_OFF), `master-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    let sendCount = 0;
    await processExternalPersonMessageOutbox(pool, {
      channel: "max",
      botToken: MAX_BOT_TOKEN,
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      deliveryEnabled: false,
      transport: async () => {
        sendCount += 1;
        return { ok: true };
      },
    });
    assert.equal(sendCount, 0);
    const row = await pool.query(`SELECT status FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [outboxId]);
    assert.equal(row.rows[0]!.status, "pending");
  });
});
