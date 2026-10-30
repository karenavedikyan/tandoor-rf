import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { upsertVerifiedPerson, createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { handleStaffOrExternalMessengerStop } from "../../src/tanbot/messenger-stop-handler";
import { processExternalPersonMessageOutbox } from "../../src/tan-tracker/external-person/outbox-worker";

const databaseUrl = getIntegrationDatabaseUrl();
const PHONE = "+79997778899";
const TG_USER = 887799001n;
const MAX_USER = 887799002n;
const STAFF_TG = 887799999n;

describe("external person per-channel opt-out (PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("telegram /stop: notifications off on TG only; MAX and staff unchanged; re-verify restores TG notify", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);

    const staff = await createTestUser({
      databaseUrl,
      email: "ext-optout-staff@test.local",
      password: "StrongPass123!",
      fullName: "Staff Untouched",
      role: "manager",
    });

    const client = await pool.connect();
    let personId = "";
    let accessEpochBefore = 0;
    let tgOutboxId = "";
    let maxOutboxId = "";
    const tgChat = "887799001";
    const maxChat = "887799002";

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
         VALUES ($1::uuid, $2, $3, TRUE)`,
        [staff.id, STAFF_TG.toString(), STAFF_TG.toString()],
      );

      const party = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Optout Ext', $1) RETURNING id::text`,
          [PHONE],
        )
      ).rows[0]!.id;

      const person = await upsertVerifiedPerson(client, {
        channel: "telegram",
        messengerUserId: TG_USER,
        messengerChatId: TG_USER,
        phoneRaw: PHONE,
        displayName: "Optout Ext",
      });
      personId = person.id;
      await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: MAX_USER,
        messengerChatId: MAX_USER,
        phoneRaw: PHONE,
        displayName: "Optout Ext",
      });

      const epochRow = await client.query<{ access_epoch: number }>(
        `SELECT access_epoch FROM tt_external_persons WHERE id = $1::uuid`,
        [personId],
      );
      accessEpochBefore = epochRow.rows[0]!.access_epoch;

      await createPersonBrowserSession(client, personId, "telegram");
      await createPersonBrowserSession(client, personId, "max");

      await client.query(
        `INSERT INTO tt_external_request_drafts (person_id, channel, messenger_chat_id, step, payload)
         VALUES ($1::uuid, 'telegram', $2, 'item', '{}'::jsonb), ($1::uuid, 'max', $3, 'item', '{}'::jsonb)`,
        [personId, tgChat, maxChat],
      );

      tgOutboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
           VALUES ($1::uuid, 'telegram', $2, 'tg body', $3, 'pending', NOW())
           RETURNING id::text`,
          [personId, tgChat, `optout-tg-${randomUUID()}`],
        )
      ).rows[0]!.id;
      maxOutboxId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
           VALUES ($1::uuid, 'max', $2, 'max body', $3, 'pending', NOW())
           RETURNING id::text`,
          [personId, maxChat, `optout-max-${randomUUID()}`],
        )
      ).rows[0]!.id;

      await handleStaffOrExternalMessengerStop(client, { channel: "telegram", messengerUserId: TG_USER });

      const tgVerify = await client.query<{ notifications_enabled: boolean; opted_out_at: Date | null }>(
        `SELECT notifications_enabled, opted_out_at FROM tt_external_person_verifications
         WHERE person_id = $1::uuid AND channel = 'telegram'`,
        [personId],
      );
      assert.equal(tgVerify.rows[0]!.notifications_enabled, false);
      assert.ok(tgVerify.rows[0]!.opted_out_at);

      const maxVerify = await client.query<{ notifications_enabled: boolean; opted_out_at: Date | null }>(
        `SELECT notifications_enabled, opted_out_at FROM tt_external_person_verifications
         WHERE person_id = $1::uuid AND channel = 'max'`,
        [personId],
      );
      assert.equal(maxVerify.rows[0]!.notifications_enabled, true);
      assert.equal(maxVerify.rows[0]!.opted_out_at, null);

      const staffAcct = await client.query<{ notifications_enabled: boolean; stopped_at: Date | null }>(
        `SELECT notifications_enabled, stopped_at FROM tanbot_telegram_accounts WHERE user_id = $1::uuid`,
        [staff.id],
      );
      assert.equal(staffAcct.rows[0]!.notifications_enabled, true);
      assert.equal(staffAcct.rows[0]!.stopped_at, null);

      const tgSessions = await client.query<{ revoked: number; active: number }>(
        `SELECT COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked,
                COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active
         FROM tt_external_person_sessions WHERE person_id = $1::uuid AND channel = 'telegram'`,
        [personId],
      );
      assert.ok(tgSessions.rows[0]!.revoked >= 1);
      assert.equal(tgSessions.rows[0]!.active, 0);

      const maxSessions = await client.query<{ active: number }>(
        `SELECT COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active
         FROM tt_external_person_sessions WHERE person_id = $1::uuid AND channel = 'max'`,
        [personId],
      );
      assert.ok(maxSessions.rows[0]!.active >= 1);

      const tgOut = await client.query<{ status: string; last_error_code: string | null }>(
        `SELECT status, last_error_code FROM tt_external_person_message_outbox WHERE id = $1::uuid`,
        [tgOutboxId],
      );
      assert.equal(tgOut.rows[0]!.status, "cancelled");
      assert.equal(tgOut.rows[0]!.last_error_code, "OPTED_OUT");

      const maxOut = await client.query<{ status: string }>(
        `SELECT status FROM tt_external_person_message_outbox WHERE id = $1::uuid`,
        [maxOutboxId],
      );
      assert.equal(maxOut.rows[0]!.status, "pending");

      const tgDrafts = await client.query(
        `SELECT 1 FROM tt_external_request_drafts WHERE person_id = $1::uuid AND channel = 'telegram'`,
        [personId],
      );
      assert.equal(tgDrafts.rowCount, 0);
      const maxDrafts = await client.query(
        `SELECT 1 FROM tt_external_request_drafts WHERE person_id = $1::uuid AND channel = 'max'`,
        [personId],
      );
      assert.equal(maxDrafts.rowCount, 1);

      const epochAfter = await client.query<{ access_epoch: number }>(
        `SELECT access_epoch FROM tt_external_persons WHERE id = $1::uuid`,
        [personId],
      );
      assert.equal(epochAfter.rows[0]!.access_epoch, accessEpochBefore);

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    let tgSendCalls = 0;
    const tgResult = await processExternalPersonMessageOutbox(pool, {
      channel: "telegram",
      botToken: "test",
      requestTimeoutMs: 5000,
      maxResponseBytes: 4096,
      transport: async () => {
        tgSendCalls += 1;
        return { ok: true as const };
      },
      deliveryEnabled: true,
    });
    assert.equal(tgSendCalls, 0);
    assert.equal(tgResult.sent, 0);

    const tgPendingAfterWorker = await pool.query(
      `SELECT status FROM tt_external_person_message_outbox WHERE id = $1::uuid`,
      [tgOutboxId],
    );
    assert.equal(tgPendingAfterWorker.rows[0]!.status, "cancelled");

    const tgRetryId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
         VALUES ($1::uuid, 'telegram', $2, 'tg retry', $3, 'pending', NOW())
         RETURNING id::text`,
        [personId, tgChat, `optout-tg-retry-${randomUUID()}`],
      )
    ).rows[0]!.id;

    const tgRetryResult = await processExternalPersonMessageOutbox(pool, {
      channel: "telegram",
      botToken: "test",
      requestTimeoutMs: 5000,
      maxResponseBytes: 4096,
      transport: async () => ({ ok: true as const }),
      deliveryEnabled: true,
    });
    assert.equal(tgRetryResult.sent, 0);
    assert.ok(tgRetryResult.cancelled >= 1);
    const tgRetryStatus = await pool.query(`SELECT status, last_error_code FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [
      tgRetryId,
    ]);
    assert.equal(tgRetryStatus.rows[0]!.status, "cancelled");
    assert.equal(tgRetryStatus.rows[0]!.last_error_code, "NO_VERIFICATION");

    let maxSendCalls = 0;
    const maxResult = await processExternalPersonMessageOutbox(pool, {
      channel: "max",
      botToken: "test",
      requestTimeoutMs: 5000,
      maxResponseBytes: 4096,
      transport: async () => {
        maxSendCalls += 1;
        return { ok: true as const };
      },
      deliveryEnabled: true,
    });
    assert.equal(maxSendCalls, 1);
    assert.equal(maxResult.sent, 1);

    const client2 = await pool.connect();
    try {
      await client2.query("BEGIN");
      await upsertVerifiedPerson(client2, {
        channel: "telegram",
        messengerUserId: TG_USER,
        messengerChatId: TG_USER,
        phoneRaw: PHONE,
        displayName: "Optout Ext",
      });
      const tgRe = await client2.query<{ notifications_enabled: boolean; opted_out_at: Date | null }>(
        `SELECT notifications_enabled, opted_out_at FROM tt_external_person_verifications
         WHERE person_id = $1::uuid AND channel = 'telegram'`,
        [personId],
      );
      assert.equal(tgRe.rows[0]!.notifications_enabled, true);
      assert.equal(tgRe.rows[0]!.opted_out_at, null);
      const maxRe = await client2.query<{ notifications_enabled: boolean }>(
        `SELECT notifications_enabled FROM tt_external_person_verifications WHERE person_id = $1::uuid AND channel = 'max'`,
        [personId],
      );
      assert.equal(maxRe.rows[0]!.notifications_enabled, true);

      const tgReOutId = (
        await client2.query<{ id: string }>(
          `INSERT INTO tt_external_person_message_outbox (person_id, channel, messenger_chat_id, body, idempotency_key, status, next_attempt_at)
           VALUES ($1::uuid, 'telegram', $2, 'tg after reverify', $3, 'pending', NOW())
           RETURNING id::text`,
          [personId, tgChat, `optout-tg-live-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await client2.query("COMMIT");

      let tgLiveCalls = 0;
      await processExternalPersonMessageOutbox(pool, {
        channel: "telegram",
        botToken: "test",
        requestTimeoutMs: 5000,
        maxResponseBytes: 4096,
        transport: async () => {
          tgLiveCalls += 1;
          return { ok: true as const };
        },
        deliveryEnabled: true,
      });
      assert.equal(tgLiveCalls, 1);
      const tgLiveStatus = await pool.query(`SELECT status FROM tt_external_person_message_outbox WHERE id = $1::uuid`, [tgReOutId]);
      assert.equal(tgLiveStatus.rows[0]!.status, "sent");
    } catch (e) {
      await client2.query("ROLLBACK");
      throw e;
    } finally {
      client2.release();
    }
  });
});
