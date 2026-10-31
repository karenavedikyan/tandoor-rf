import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { buildTanTrackerStaffOutboxMessage } from "../../src/tan-tracker/tan-tracker-outbox-messages";
import { parseHandoffCodePaste } from "../../src/tan-tracker/handoff-code-paste-parse";
import { notifyTransferAssignment } from "../../src/tan-tracker/transfer-lk-notify";
import { processExternalPersonMessageOutbox } from "../../src/tan-tracker/external-person/outbox-worker";
import { notifyExternalPartyHandoffCode } from "../../src/tan-tracker/transfer-external-messenger-notify";
import { externalPersonHandoffCodeCopyIdempotencyKey } from "../../src/tan-tracker/external-person/external-person-notify";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const SYNTH_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
const databaseUrl = getIntegrationDatabaseUrl();

function setEnv(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_TELEGRAM_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_BOT_TOKEN = SYNTH_TOKEN;
  process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
  process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
}

describe("tan-tracker notification context", { concurrency: false }, () => {
  before(async () => {
    setEnv();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("legacy outbox payload without route names renders safely", () => {
    const text = buildTanTrackerStaffOutboxMessage(
      "tan_tracker.assignment",
      {
        transferId: "tt-leg",
        publicCode: "LEG-1",
        itemTitle: "Legacy item",
        handoffVersion: 1,
      },
      ORIGIN,
    );
    assert.match(text, /Передача LEG-1/);
    assert.doesNotMatch(text, /От:/);
    assert.doesNotMatch(text, /\b\d{6}\b/);
  });

  it("queued payload keeps event-time route after holder mutation", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const a = await createTestUser({
      databaseUrl,
      email: "ctx-snap-a@test.local",
      password: PASSWORD,
      fullName: "Snap Alpha",
      role: "manager",
    });
    const b = await createTestUser({
      databaseUrl,
      email: "ctx-snap-b@test.local",
      password: PASSWORD,
      fullName: "Snap Beta",
      role: "manager",
    });
    const client = await pool.connect();
    const transferId = "TT-CTX-SNAP";
    try {
      await client.query("BEGIN");
      const partyA = await ensurePartyForUserOnWrite(client, a.id, "Snap Alpha", "+79992220001");
      const partyB = await ensurePartyForUserOnWrite(client, b.id, "Snap Beta", "+79992220002");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1, 'CTXSNAP', 'Snap box', 'waiting', $2, $2, 1, 1)`,
        [transferId, partyA.id],
      );
      await client.query(
        `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
         VALUES ($1::uuid, 990001, 990001, TRUE)`,
        [a.id],
      );
      await notifyTransferAssignment(client, {
        transferId,
        publicCode: "CTXSNAP",
        itemTitle: "Snap box",
        holderUserId: a.id,
        holderPartyId: partyA.id,
        fromPartyId: partyB.id,
        handoffVersion: 1,
      });
      await client.query(`UPDATE tt_transfers SET holder_party_id = $2 WHERE id = $1`, [transferId, partyB.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const stored = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM tanbot_notification_outbox
       WHERE channel = 'telegram' AND event_type = 'tan_tracker.assignment' AND payload->>'publicCode' = 'CTXSNAP'
       LIMIT 1`,
    );
    assert.equal(stored.rowCount, 1);
    const text = buildTanTrackerStaffOutboxMessage(
      "tan_tracker.assignment",
      stored.rows[0]!.payload,
      ORIGIN,
    );
    assert.match(text, /От: Snap Beta/);
    assert.match(text, /Кому: Snap Alpha/);
    assert.doesNotMatch(text, /\b\d{6}\b/);
  });

  it("two simultaneous transfers produce distinct context in outbox payloads", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const holder = await createTestUser({
      databaseUrl,
      email: "ctx-two-holder@test.local",
      password: PASSWORD,
      fullName: "Two Holder",
      role: "manager",
    });
    const p1 = await createTestUser({
      databaseUrl,
      email: "ctx-two-p1@test.local",
      password: PASSWORD,
      fullName: "Pending One",
      role: "manager",
    });
    const p2 = await createTestUser({
      databaseUrl,
      email: "ctx-two-p2@test.local",
      password: PASSWORD,
      fullName: "Pending Two",
      role: "manager",
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const hParty = await ensurePartyForUserOnWrite(client, holder.id, "Two Holder", "+79993330001");
      const p1Party = await ensurePartyForUserOnWrite(client, p1.id, "Pending One", "+79993330002");
      const p2Party = await ensurePartyForUserOnWrite(client, p2.id, "Pending Two", "+79993330003");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ('TT-CTX-1','CTX1','Alpha item','waiting',$1,$1,$2,$2,1,1),
                ('TT-CTX-2','CTX2','Beta item','waiting',$1,$1,$3,$3,1,1)`,
        [hParty.id, p1Party.id, p2Party.id],
      );
      const { notifyCodeGenerated } = await import("../../src/tan-tracker/transfer-lk-notify");
      await notifyCodeGenerated(client, {
        transferId: "TT-CTX-1",
        publicCode: "CTX1",
        itemTitle: "Alpha item",
        holderPartyId: hParty.id,
        pendingPartyId: p1Party.id,
        handoffVersion: 1,
      });
      await notifyCodeGenerated(client, {
        transferId: "TT-CTX-2",
        publicCode: "CTX2",
        itemTitle: "Beta item",
        holderPartyId: hParty.id,
        pendingPartyId: p2Party.id,
        handoffVersion: 1,
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const rows = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM tanbot_notification_outbox
       WHERE channel = 'telegram' AND event_type = 'tan_tracker.code_obtained' AND payload->>'publicCode' IN ('CTX1', 'CTX2')
       ORDER BY payload->>'publicCode'`,
      [],
    );
    assert.equal(rows.rowCount, 2);
    const t1 = buildTanTrackerStaffOutboxMessage(
      "tan_tracker.code_obtained",
      rows.rows[0]!.payload,
      ORIGIN,
    );
    const t2 = buildTanTrackerStaffOutboxMessage(
      "tan_tracker.code_obtained",
      rows.rows[1]!.payload,
      ORIGIN,
    );
    assert.match(t1, /CTX1/);
    assert.match(t1, /Кому: Pending One/);
    assert.match(t2, /CTX2/);
    assert.match(t2, /Кому: Pending Two/);
    assert.notEqual(t1, t2);
  });

  it("copy-only six-digit messenger body roundtrips paste parser", () => {
    assert.deepEqual(parseHandoffCodePaste("012345"), { ok: true, code: "012345" });
    assert.deepEqual(parseHandoffCodePaste("045678"), { ok: true, code: "045678" });
  });

  it("external handoff_code outbox delivers context then copy-only code", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const staff = await createTestUser({
      databaseUrl,
      email: "ctx-ext-staff@test.local",
      password: PASSWORD,
      fullName: "Ext Staff",
      role: "manager",
    });
    const client = await pool.connect();
    const primaryKey = "tt-ext-msg:handoff_code:tt-ext-ctx:hv:1:telegram";
    let externalPartyId: string;
    try {
      await client.query("BEGIN");
      const staffParty = await ensurePartyForUserOnWrite(client, staff.id, "Ext Staff", "+79994440002");
      externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Ext Client', '+79994440001') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id, handoff_version, row_version, from_external)
         VALUES ('tt-ext-ctx','EXTCTX','Ext item','waiting',$1,$1,$2,1,1,TRUE)`,
        [staffParty.id, externalPartyId],
      );
      const personId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_persons (party_id, display_name, phone_e164) VALUES ($1::uuid, 'Ext Client', '+79994440001') RETURNING id::text`,
          [externalPartyId],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id, notifications_enabled)
         VALUES ($1::uuid, 'telegram', '991001', '991001', TRUE)`,
        [personId],
      );
      await notifyExternalPartyHandoffCode(client, {
        externalPartyId,
        transferId: "tt-ext-ctx",
        handoffVersion: 1,
        code: "012345",
        preferredChannel: "telegram",
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const outRows = await pool.query<{ event_type: string; body: string }>(
      `SELECT event_type, body FROM tt_external_person_message_outbox WHERE idempotency_key IN ($1, $2) ORDER BY idempotency_key`,
      [primaryKey, externalPersonHandoffCodeCopyIdempotencyKey(primaryKey)],
    );
    assert.equal(outRows.rowCount, 2);
    assert.doesNotMatch(outRows.rows.find((r) => r.event_type === "external_person.handoff_code")!.body, /\b012345\b/);
    assert.equal(outRows.rows.find((r) => r.event_type === "external_person.handoff_code_copy")!.body, "012345");

    const texts: string[] = [];
    const transport = async (input: { text: string }) => {
      texts.push(input.text);
      return { ok: true as const };
    };
    const result = await processExternalPersonMessageOutbox(pool, {
      channel: "telegram",
      botToken: SYNTH_TOKEN,
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      transport,
      deliveryEnabled: true,
      limit: 5,
    });
    assert.equal(result.sent, 2);
    assert.equal(texts.length, 2);
    assert.match(texts[0]!, /EXTCTX/);
    assert.doesNotMatch(texts[0]!, /\b012345\b/);
    assert.equal(texts[1], "012345");
  });
});
