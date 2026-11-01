import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createRecordingTelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { processTanbotNotificationOutbox } from "../../src/tanbot-telegram/outbox-worker";
import { processTanbotMaxNotificationOutbox } from "../../src/tanbot-max/outbox-worker";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { applyPendingReceiptHandoff } from "../../src/tan-tracker/handoff-complete";
import {
  notifyRouteContinued,
  notifyTransferDelivered,
} from "../../src/tan-tracker/transfer-lk-notify";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const SYNTH_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
const LINK_PEPPER = "test-link-pepper-min-16-chars";
const databaseUrl = getIntegrationDatabaseUrl();

function setBotEnv(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_TELEGRAM_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_BOT_TOKEN = SYNTH_TOKEN;
  process.env.TANBOT_TELEGRAM_EXPECTED_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = LINK_PEPPER;
  process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
  process.env.TANBOT_MAX_ENABLED = "true";
  process.env.TANBOT_MAX_BOT_TOKEN = SYNTH_TOKEN;
  process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
  process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = LINK_PEPPER;
  process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
}

describe("tan-tracker staff notify fanout (PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setBotEnv();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("assignment fanout: LK + telegram + max with idempotency", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const holder = await createTestUser({
      databaseUrl,
      email: "staff-fanout-holder@test.local",
      password: PASSWORD,
      fullName: "Fanout Holder",
      role: "manager",
    });
    const client = await pool.connect();
    const transferId = "TT-FANOUT-1";
    try {
      await client.query("BEGIN");
      const party = await ensurePartyForUserOnWrite(client, holder.id, "Fanout Holder", "+79991110001");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1, 'FAN1', 'Fanout item', 'waiting', $2, $2, 1, 1)`,
        [transferId, party.id],
      );
      await client.query(
        `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
         VALUES ($1::uuid, 880101, 880101, TRUE)`,
        [holder.id],
      );
      await client.query(
        `INSERT INTO tanbot_max_accounts (user_id, max_user_id, max_chat_id, notifications_enabled)
         VALUES ($1::uuid, 880102, 880102, TRUE)`,
        [holder.id],
      );
      const { notifyTransferAssignment } = await import("../../src/tan-tracker/transfer-lk-notify");
      await notifyTransferAssignment(client, {
        transferId,
        publicCode: "FAN1",
        itemTitle: "Fanout item",
        holderUserId: holder.id,
        holderPartyId: party.id,
        handoffVersion: 1,
      });
      await notifyTransferAssignment(client, {
        transferId,
        publicCode: "FAN1",
        itemTitle: "Fanout item",
        holderUserId: holder.id,
        holderPartyId: party.id,
        handoffVersion: 1,
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const lk = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_lk_notifications WHERE user_id = $1::uuid AND event_type = 'tan_tracker.assignment'`,
      [holder.id],
    );
    assert.equal(lk.rows[0]!.c, 1);
    const out = await pool.query(
      `SELECT channel, status FROM tanbot_notification_outbox WHERE user_id = $1::uuid AND event_type = 'tan_tracker.assignment' ORDER BY channel`,
      [holder.id],
    );
    assert.equal(out.rowCount, 2);
    assert.deepEqual(
      out.rows.map((r) => r.channel),
      ["max", "telegram"],
    );

    const tgLoaded = loadTanbotTelegramStage2Config();
    assert.equal(tgLoaded.ok, true);
    if (!tgLoaded.ok) return;
    const sink = { calls: [] as Array<{ body: Record<string, unknown> }> };
    const transport = createRecordingTelegramDeliveryTransport(sink as never);
    const sent = await processTanbotNotificationOutbox(pool, tgLoaded.config, transport, {
      deliveryEnabled: true,
    });
    assert.equal(sent.sent, 1);
    assert.match(String(sink.calls[0]!.body.text), /FAN1/);
    assert.doesNotMatch(String(sink.calls[0]!.body.text), /\b\d{6}\b/);
  });

  it("delivered dedupes creator=holder; no handoff_confirmed duplicate on route complete", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const user = await createTestUser({
      databaseUrl,
      email: "staff-fanout-solo@test.local",
      password: PASSWORD,
      fullName: "Solo User",
      role: "manager",
    });
    const client = await pool.connect();
    const transferId = "TT-FANOUT-2";
    try {
      await client.query("BEGIN");
      const party = await ensurePartyForUserOnWrite(client, user.id, "Solo User", "+79991110002");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
                                  final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, 'FAN2', 'Solo route', 'waiting', $2, $2, $2, $2, 1, 1)`,
        [transferId, party.id],
      );
      await applyPendingReceiptHandoff(
        client,
        {
          id: transferId,
          holder_party_id: party.id,
          pending_party_id: party.id,
          final_recipient_party_id: party.id,
          handoff_version: 1,
          row_version: 1,
        },
        user.id,
        party.id,
        "test complete route",
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const lk = await pool.query(
      `SELECT event_type, COUNT(*)::int AS c FROM tt_lk_notifications WHERE user_id = $1::uuid AND transfer_id = $2
       GROUP BY event_type ORDER BY event_type`,
      [user.id, transferId],
    );
    const byType = Object.fromEntries(lk.rows.map((r) => [r.event_type, r.c]));
    assert.equal(byType["tan_tracker.handoff_confirmed"], undefined);
    assert.ok(byType["tan_tracker.delivered"] >= 1);
    assert.equal(byType["tan_tracker.delivered"], 1);
  });

  it("continued notifies holder, pending staff, creator with role dedupe", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const holder = await createTestUser({
      databaseUrl,
      email: "staff-fanout-h@test.local",
      password: PASSWORD,
      fullName: "H User",
      role: "manager",
    });
    const pending = await createTestUser({
      databaseUrl,
      email: "staff-fanout-p@test.local",
      password: PASSWORD,
      fullName: "P User",
      role: "manager",
    });
    const client = await pool.connect();
    const transferId = "TT-FANOUT-3";
    try {
      await client.query("BEGIN");
      const hParty = await ensurePartyForUserOnWrite(client, holder.id, "H User", "+79991110003");
      const pParty = await ensurePartyForUserOnWrite(client, pending.id, "P User", "+79991110004");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
                                  final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, 'FAN3', 'Continue item', 'active', $2, $2, $3, $3, 2, 1)`,
        [transferId, hParty.id, pParty.id],
      );
      await notifyRouteContinued(client, {
        transferId,
        publicCode: "FAN3",
        itemTitle: "Continue item",
        holderPartyId: hParty.id,
        newPendingPartyId: pParty.id,
        creatorPartyId: hParty.id,
        handoffVersion: 3,
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const lk = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_lk_notifications WHERE transfer_id = $1 AND event_type = 'tan_tracker.continued'`,
      [transferId],
    );
    assert.equal(lk.rows[0]!.c, 2);
    const out = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tanbot_notification_outbox WHERE event_type = 'tan_tracker.continued' AND payload->>'transferId' = $1`,
      [transferId],
    );
    assert.equal(out.rows[0]!.c, 4);
  });

  it("respects messenger opt-out on delivery", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const user = await createTestUser({
      databaseUrl,
      email: "staff-fanout-optout@test.local",
      password: PASSWORD,
      fullName: "Optout User",
      role: "manager",
    });
    const client = await pool.connect();
    const transferId = "TT-FANOUT-4";
    try {
      await client.query("BEGIN");
      const party = await ensurePartyForUserOnWrite(client, user.id, "Optout User", "+79991110005");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1, 'FAN4', 'Optout', 'active', $2, $2, 1, 1)`,
        [transferId, party.id],
      );
      await client.query(
        `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
         VALUES ($1::uuid, 880201, 880201, FALSE)`,
        [user.id],
      );
      await notifyTransferDelivered(client, {
        transferId,
        publicCode: "FAN4",
        itemTitle: "Optout",
        creatorPartyId: party.id,
        holderPartyId: party.id,
        previousHolderPartyId: party.id,
        handoffVersion: 1,
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const tgOut = await pool.query<{ id: string }>(
      `SELECT id::text FROM tanbot_notification_outbox
       WHERE user_id = $1::uuid AND channel = 'telegram' AND payload->>'transferId' = $2`,
      [user.id, transferId],
    );
    assert.equal(tgOut.rowCount, 1);

    const tgLoaded = loadTanbotTelegramStage2Config();
    assert.equal(tgLoaded.ok, true);
    if (!tgLoaded.ok) return;
    const sink = { calls: [] as unknown[] };
    const transport = createRecordingTelegramDeliveryTransport(sink as never);
    await processTanbotNotificationOutbox(pool, tgLoaded.config, transport, {
      deliveryEnabled: true,
    });
    const tgAfter = await pool.query<{ status: string }>(
      `SELECT status FROM tanbot_notification_outbox WHERE id = $1::uuid`,
      [tgOut.rows[0]!.id],
    );
    assert.equal(tgAfter.rows[0]!.status, "cancelled");
    assert.equal(sink.calls.length, 0);

    const maxOut = await pool.query<{ id: string }>(
      `SELECT id::text FROM tanbot_notification_outbox
       WHERE user_id = $1::uuid AND channel = 'max' AND payload->>'transferId' = $2`,
      [user.id, transferId],
    );
    assert.equal(maxOut.rowCount, 1);

    const maxLoaded = loadTanbotMaxStage2Config();
    assert.equal(maxLoaded.ok, true);
    if (!maxLoaded.ok) return;
    const maxTransport = async () => ({ ok: true as const, result: {} });
    await processTanbotMaxNotificationOutbox(pool, maxLoaded.config, maxTransport, {
      deliveryEnabled: true,
    });
    const maxAfter = await pool.query<{ status: string }>(
      `SELECT status FROM tanbot_notification_outbox WHERE id = $1::uuid`,
      [maxOut.rows[0]!.id],
    );
    assert.equal(maxAfter.rows[0]!.status, "cancelled");
  });

  it("bot code confirmation: actor keeps LK bell but gets no messenger message about own action", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const sender = await createTestUser({
      databaseUrl, email: "staff-fanout-bot-sender@test.local", password: PASSWORD, fullName: "Bot Sender", role: "manager",
    });
    const recipient = await createTestUser({
      databaseUrl, email: "staff-fanout-bot-recipient@test.local", password: PASSWORD, fullName: "Bot Recipient", role: "manager",
    });
    const client = await pool.connect();
    const transferId = "TT-FANOUT-BOT-1";
    try {
      await client.query("BEGIN");
      const sParty = await ensurePartyForUserOnWrite(client, sender.id, "Bot Sender", "+79991110031");
      const rParty = await ensurePartyForUserOnWrite(client, recipient.id, "Bot Recipient", "+79991110032");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
                                  final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, 'FANB1', 'Bot final', 'waiting', $2, $2, $3, $3, 1, 1)`,
        [transferId, sParty.id, rParty.id],
      );
      await applyPendingReceiptHandoff(
        client,
        { id: transferId, holder_party_id: sParty.id, pending_party_id: rParty.id, final_recipient_party_id: rParty.id, handoff_version: 1, row_version: 1 },
        sender.id,
        sParty.id,
        "bot code verify",
        { botActor: { staffUserId: sender.id, partyId: sParty.id } },
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const lk = await pool.query(
      `SELECT user_id::text AS user_id, COUNT(*)::int AS c FROM tt_lk_notifications
       WHERE transfer_id = $1 AND event_type = 'tan_tracker.delivered' GROUP BY user_id`,
      [transferId],
    );
    const lkByUser = Object.fromEntries(lk.rows.map((r) => [r.user_id, r.c]));
    assert.equal(lkByUser[sender.id], 1, "actor still gets the LK bell");
    assert.equal(lkByUser[recipient.id], 1);

    const out = await pool.query(
      `SELECT user_id::text AS user_id, channel FROM tanbot_notification_outbox
       WHERE payload->>'transferId' = $1 ORDER BY user_id, channel`,
      [transferId],
    );
    assert.deepEqual(
      out.rows.map((r) => `${r.user_id === recipient.id ? "recipient" : "sender"}:${r.channel}`),
      ["recipient:max", "recipient:telegram"],
      "no telegram/max message to the actor who confirmed the code in the bot",
    );
  });

  it("intermediate handoff: new staff holder gets one assignment, not handoff_confirmed as well", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const sender = await createTestUser({
      databaseUrl, email: "staff-fanout-mid-sender@test.local", password: PASSWORD, fullName: "Mid Sender", role: "manager",
    });
    const holder = await createTestUser({
      databaseUrl, email: "staff-fanout-mid-holder@test.local", password: PASSWORD, fullName: "Mid Holder", role: "manager",
    });
    const final = await createTestUser({
      databaseUrl, email: "staff-fanout-mid-final@test.local", password: PASSWORD, fullName: "Mid Final", role: "manager",
    });
    const client = await pool.connect();
    const transferId = "TT-FANOUT-MID-1";
    try {
      await client.query("BEGIN");
      const sParty = await ensurePartyForUserOnWrite(client, sender.id, "Mid Sender", "+79991110041");
      const hParty = await ensurePartyForUserOnWrite(client, holder.id, "Mid Holder", "+79991110042");
      const fParty = await ensurePartyForUserOnWrite(client, final.id, "Mid Final", "+79991110043");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
                                  final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, 'FANM1', 'Mid item', 'waiting', $2, $2, $3, $4, 1, 1)`,
        [transferId, sParty.id, hParty.id, fParty.id],
      );
      // LK-originated confirmation (no bot actor): sender keeps own messenger notification.
      await applyPendingReceiptHandoff(
        client,
        { id: transferId, holder_party_id: sParty.id, pending_party_id: hParty.id, final_recipient_party_id: fParty.id, handoff_version: 1, row_version: 1 },
        sender.id,
        sParty.id,
        "lk code verify",
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const rows = await pool.query(
      `SELECT user_id::text AS user_id, event_type, channel FROM tanbot_notification_outbox
       WHERE payload->>'transferId' = $1 ORDER BY user_id, event_type, channel`,
      [transferId],
    );
    const who = (id: string) => (id === sender.id ? "sender" : id === holder.id ? "holder" : "other");
    const summary = rows.rows.map((r) => `${who(r.user_id)}:${r.event_type.replace("tan_tracker.", "")}:${r.channel}`).sort();
    assert.deepEqual(summary, [
      "holder:assignment:max",
      "holder:assignment:telegram",
      "sender:handoff_confirmed:max",
      "sender:handoff_confirmed:telegram",
    ]);
    const lk = await pool.query(
      `SELECT user_id::text AS user_id, event_type FROM tt_lk_notifications WHERE transfer_id = $1 ORDER BY 1, 2`,
      [transferId],
    );
    assert.deepEqual(
      lk.rows.map((r) => `${who(r.user_id)}:${r.event_type.replace("tan_tracker.", "")}`).sort(),
      ["holder:assignment", "sender:handoff_confirmed"],
    );
  });
});
