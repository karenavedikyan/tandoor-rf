import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";
import { confirmExternalRequestDraft } from "../../src/tan-tracker/external-request/confirm";
import { loadExternalPersonOrders } from "../../src/tan-tracker/external-person/external-person-orders";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

describe("external person blocker fixes", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("rejects employee phone collision on bot verify", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-emp-phone@test.local",
      password: PASSWORD,
      fullName: "Emp Phone",
      role: "manager",
      phone: "+79990003344",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensurePartyForUserOnWrite(client, staff.id, "Emp Phone", "+79990003344");
      await assert.rejects(
        () =>
          upsertVerifiedPerson(client, {
            channel: "telegram",
            messengerUserId: 900002n,
            messengerChatId: 900002n,
            phoneRaw: "+79990003344",
            displayName: "Should Fail",
          }),
        (err: Error & { http?: number }) => err.http === 403,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("rejects unknown phone self-registration on bot verify", async () => {
    const pool = getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assert.rejects(
        () =>
          upsertVerifiedPerson(client, {
            channel: "telegram",
            messengerUserId: 900001n,
            messengerChatId: 900001n,
            phoneRaw: "+79990001122",
            displayName: "Stranger",
          }),
        (err: Error & { http?: number }) => {
          assert.equal(err.http, 403);
          return true;
        },
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("confirm allows prior relationship when intake flag is off", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-prior-rel@test.local",
      password: PASSWORD,
      fullName: "Prior Staff",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    const personId = randomUUID();
    const draftId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET accepts_external_tt_intake = FALSE WHERE id = $1::uuid`, [staff.id]);
      const staffPartyId = (await ensurePartyForUserOnWrite(client, staff.id, "Prior Staff", "+79995556601")).id;
      const externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Prior Ext', '+79995556602') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version)
         VALUES ('PRIOR1','PRIOR1','link','completed',TRUE,$1,$2,$2,$2,1)`,
        [externalPartyId, staffPartyId],
      );
      await client.query(
        `INSERT INTO tt_external_persons (id, phone_e164, display_name, party_id) VALUES ($1::uuid, '+79995556602', 'Prior Ext', $2::uuid)`,
        [personId, externalPartyId],
      );
      await client.query(
        `INSERT INTO tt_external_request_drafts (id, person_id, channel, messenger_chat_id, step, payload)
         VALUES ($1::uuid, $2::uuid, 'max', '2', 'summary', $3::jsonb)`,
        [draftId, personId, JSON.stringify({ item: "Doc", recipientUserId: staff.id, dueMode: "tomorrow" })],
      );
      const created = await confirmExternalRequestDraft(client, {
        personId,
        externalPartyId,
        draftId,
        idempotencyKey: `ext-req:${draftId}`,
      });
      assert.ok(created.publicCode);
      await client.query("ROLLBACK");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  it("confirm allows intake OR prior relationship and idempotent replay", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-intake-or@test.local",
      password: "StrongPass123!",
      fullName: "Intake Staff",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    const personId = randomUUID();
    const draftId = randomUUID();
    let externalPartyId = "";
    let staffPartyId = "";
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
      staffPartyId = (await ensurePartyForUserOnWrite(client, staff.id, "Intake Staff", "+79991112201")).id;
      externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Known Ext', '+79991112202') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_persons (id, phone_e164, display_name, party_id) VALUES ($1::uuid, '+79991112202', 'Known Ext', $2::uuid)`,
        [personId, externalPartyId],
      );
      await client.query(
        `INSERT INTO tt_external_request_drafts (id, person_id, channel, messenger_chat_id, step, payload)
         VALUES ($1::uuid, $2::uuid, 'telegram', '1', 'summary', $3::jsonb)`,
        [draftId, personId, JSON.stringify({ item: "Box", recipientUserId: staff.id, dueMode: "today" })],
      );
      const idem = `ext-req:${draftId}`;
      const first = await confirmExternalRequestDraft(client, {
        personId,
        externalPartyId,
        draftId,
        idempotencyKey: idem,
      });
      const second = await confirmExternalRequestDraft(client, {
        personId,
        externalPartyId,
        draftId,
        idempotencyKey: idem,
      });
      assert.equal(first.publicCode, second.publicCode);
      const dup = await client.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM tt_transfers WHERE id = $1`, [
        first.publicCode,
      ]);
      assert.equal(dup.rows[0]?.c, 1);
      await client.query("ROLLBACK");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  it("open request limit locks person row (serial confirms)", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-limit@test.local",
      password: "StrongPass123!",
      fullName: "Limit Staff",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    const personId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
      const staffParty = await ensurePartyForUserOnWrite(client, staff.id, "Limit Staff", "+79992223301");
      const externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Limit Ext', '+79992223302') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_persons (id, phone_e164, display_name, party_id) VALUES ($1::uuid, '+79992223302', 'Limit Ext', $2::uuid)`,
        [personId, externalPartyId],
      );
      for (let i = 0; i < 5; i++) {
        await client.query(
          `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version)
           VALUES ($1,$1,'x','waiting',TRUE,$2,$2,$3,$3,1)`,
          [`LIM${i}`, externalPartyId, staffParty.id],
        );
      }
      const draftId = randomUUID();
      await client.query(
        `INSERT INTO tt_external_request_drafts (id, person_id, channel, messenger_chat_id, step, payload)
         VALUES ($1::uuid, $2::uuid, 'telegram', '9', 'summary', '{"item":"y","recipientUserId":"${staff.id}"}'::jsonb)`,
        [draftId, personId],
      );
      await assert.rejects(
        () =>
          confirmExternalRequestDraft(client, {
            personId,
            externalPartyId,
            draftId,
            idempotencyKey: `ext-req:${draftId}`,
          }),
        (err: Error & { http?: number }) => err.http === 409,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("max channel accepts known external party same as telegram", async () => {
    const pool = getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const partyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Max Known', '+79994445501') RETURNING id::text`,
        )
      ).rows[0]!.id;
      const person = await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: 88001n,
        messengerChatId: 88001n,
        phoneRaw: "+79994445501",
        displayName: "Max Known",
      });
      assert.equal(person.party_id, partyId);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("bootstrap excludes timeline-only transfers and foreign timeline rows", async () => {
    const pool = getPool()!;
    const client = await pool.connect();
    const extParty = (
      await client.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Vis Ext', '+79993334401') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const otherParty = (
      await client.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Other', '+79993334402') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const hiddenId = "tt-ext-hidden-1";
    const visibleId = "tt-ext-visible-1";
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version)
         VALUES ($1,'HID','H','active',$2,$3,1)`,
        [hiddenId, otherParty, otherParty],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note)
         VALUES ($1,$2,$3,'mention only')`,
        [hiddenId, extParty, otherParty],
      );
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version)
         VALUES ($1,'VIS','V','waiting',TRUE,$2,$2,$3,$3,1)`,
        [visibleId, extParty, otherParty],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note)
         VALUES ($1,$2,$3,'created'), ($1,$3,$2,'staff reply')`,
        [visibleId, extParty, otherParty],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const orders = await loadExternalPersonOrders(pool, extParty);
    assert.equal(orders.length, 1);
    assert.equal(orders[0]!.id, "VIS");
    assert.ok(orders[0]!.timeline.every((t) => t.from === extParty || t.to === extParty));
  });

  it("decline writes audit and external messenger outbox (not holder self timeline)", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-decline@test.local",
      password: PASSWORD,
      fullName: "Decline Staff",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    const personId = randomUUID();
    let externalPartyId = "";
    let transferId = "EXTDECL1";
    try {
      await client.query("BEGIN");
      const staffParty = await ensurePartyForUserOnWrite(client, staff.id, "Decline Staff", "+79997778801");
      externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Decline Ext', '+79997778802') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_persons (id, phone_e164, display_name, party_id) VALUES ($1::uuid, '+79997778802', 'Decline Ext', $2::uuid)`,
        [personId, externalPartyId],
      );
      await client.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
         VALUES ($1::uuid, 'telegram', '7001', '7001')`,
        [personId],
      );
      await client.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
         VALUES ($1::uuid, 'max', '7002', '7002')`,
        [personId],
      );
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version)
         VALUES ($1,$1,'Decline me','waiting',TRUE,$2,$2,$3,$3,1)`,
        [transferId, externalPartyId, staffParty.id],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const app = await loadApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "ext-decline@test.local", password: PASSWORD });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"];

    const declined = await request(app)
      .post(`/api/tan-tracker/transfers/${transferId}/external-decline`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookie)
      .send({ reason: "Не могу принять" });
    assert.equal(declined.status, 200);

    const audit = await pool.query(
      `SELECT action FROM tt_audit_log WHERE transfer_id = $1 AND action = 'external_decline'`,
      [transferId],
    );
    assert.equal(audit.rowCount, 1);

    const badTimeline = await pool.query(
      `SELECT 1 FROM tt_transfer_timeline WHERE transfer_id = $1 AND from_party_id = to_party_id`,
      [transferId],
    );
    assert.equal(badTimeline.rowCount, 0);

    const outbox = await pool.query(
      `SELECT channel FROM tt_external_person_message_outbox WHERE person_id = $1::uuid ORDER BY channel`,
      [personId],
    );
    assert.equal(outbox.rowCount, 2);
    assert.deepEqual(
      outbox.rows.map((r) => r.channel),
      ["max", "telegram"],
    );
  });
});
