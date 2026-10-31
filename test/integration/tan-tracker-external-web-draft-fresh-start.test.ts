import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { confirmExternalRequestDraft } from "../../src/tan-tracker/external-request/confirm";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
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
const FIXTURE_A = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-admin-wizard.png"),
);
const FIXTURE_B = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-external-photo-b.png"),
);

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

function draftPost(app: Awaited<ReturnType<typeof loadApp>>, est: string, body: Record<string, unknown>) {
  return request(app)
    .post("/api/tan-tracker/public/external/request/draft")
    .set("Origin", ORIGIN)
    .set("X-TT-External-Est", est)
    .send(body);
}

function photoPost(app: Awaited<ReturnType<typeof loadApp>>, est: string, draftId: string, buf: Buffer, name: string) {
  return request(app)
    .post(`/api/tan-tracker/public/external/request/photo?draftId=${encodeURIComponent(draftId)}`)
    .set("Origin", ORIGIN)
    .set("X-TT-External-Est", est)
    .set("X-TT-Filename", encodeURIComponent(name))
    .set("Content-Type", "application/octet-stream")
    .send(buf);
}

describe("external web draft startFresh", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    process.env.TT_ATTACHMENTS_BACKEND = "postgres";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  it("startFresh discards prior unconfirmed draft files and replaces draft id", async () => {
    const app = await loadApp();
    const pool = getPool()!;
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-fresh-staff@test.local",
      password: PASSWORD,
      fullName: "Fresh Staff",
      role: "manager",
    });
    await pool.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Fresh Staff", "+79991112201");
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Fresh Ext', '+79991112202') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991112202', 'Fresh Ext', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', '881001', '881001')`,
      [person],
    );
    const client = await pool.connect();
    let est = "";
    try {
      est = await createPersonBrowserSession(client, person, "telegram");
    } finally {
      client.release();
    }

    const first = await draftPost(app, est, { step: "item", payload: {}, startFresh: true });
    assert.equal(first.status, 200);
    const draftA = first.body.draftId as string;
    assert.ok(draftA);
    const upA = await photoPost(app, est, draftA, FIXTURE_A, "a.png");
    assert.equal(upA.status, 201);

    const fresh = await draftPost(app, est, { step: "item", payload: {}, startFresh: true });
    assert.equal(fresh.status, 200);
    const draftB = fresh.body.draftId as string;
    assert.notEqual(draftB, draftA);

    const staleUp = await photoPost(app, est, draftA, FIXTURE_A, "stale.png");
    assert.ok(staleUp.status === 409 || staleUp.status === 404);

    const upB = await photoPost(app, est, draftB, FIXTURE_B, "b.png");
    assert.equal(upB.status, 201);

    const filesOnB = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
      [draftB],
    );
    assert.equal(filesOnB.rows[0]?.c, 1);
    const filesOnA = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
      [draftA],
    );
    assert.equal(filesOnA.rows[0]?.c, 0);
  });

  it("rejects startFresh discard when active draft owned by another person", async () => {
    const app = await loadApp();
    const pool = getPool()!;
    const chatId = "881002";
    const otherParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Other Fresh', '+79991112203') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const otherPerson = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991112203', 'Other Fresh', $1::uuid) RETURNING id::text`,
        [otherParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
       VALUES ('telegram', $1, $2::uuid, 'item', '{}'::jsonb)`,
      [chatId, otherPerson],
    );
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Fresh Ext2', '+79991112204') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991112204', 'Fresh Ext2', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', '881002', $2)`,
      [person, chatId],
    );
    const client = await pool.connect();
    let est = "";
    try {
      est = await createPersonBrowserSession(client, person, "telegram");
    } finally {
      client.release();
    }
    const res = await draftPost(app, est, { step: "item", payload: {}, startFresh: true });
    assert.equal(res.status, 403);
  });

  it("rejects unauthenticated draft upsert", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post("/api/tan-tracker/public/external/request/draft")
      .set("Origin", ORIGIN)
      .send({ step: "item", payload: {}, startFresh: true });
    assert.equal(res.status, 403);
  });

  it("rejects saveDraft when draftId is obsolete after startFresh", async () => {
    const app = await loadApp();
    const pool = getPool()!;
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Fresh Ext5', '+79991112209') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991112209', 'Fresh Ext5', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', '881005', '881005')`,
      [person],
    );
    const client = await pool.connect();
    let est = "";
    try {
      est = await createPersonBrowserSession(client, person, "telegram");
    } finally {
      client.release();
    }
    const first = await draftPost(app, est, { step: "item", payload: {}, startFresh: true });
    const staleId = first.body.draftId as string;
    const second = await draftPost(app, est, { step: "item", payload: {}, startFresh: true });
    const activeId = second.body.draftId as string;
    assert.notEqual(staleId, activeId);
    const staleSave = await draftPost(app, est, {
      step: "photo",
      draftId: staleId,
      payload: { item: "Stale overwrite", dueMode: "today" },
    });
    assert.ok(staleSave.status === 404 || staleSave.status === 409);
    const activeRow = await pool.query<{ item: string }>(
      `SELECT payload->>'item' AS item FROM tt_external_request_drafts WHERE id = $1::uuid`,
      [activeId],
    );
    assert.notEqual(activeRow.rows[0]?.item, "Stale overwrite");
  });

  it("confirms transfer with only photos on active draft after startFresh", async () => {
    const app = await loadApp();
    const pool = getPool()!;
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-fresh-staff3@test.local",
      password: PASSWORD,
      fullName: "Fresh Staff3",
      role: "manager",
    });
    await pool.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Fresh Staff3", "+79991112207");
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Fresh Ext4', '+79991112208') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991112208', 'Fresh Ext4', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', '881004', '881004')`,
      [person],
    );
    const client = await pool.connect();
    let est = "";
    try {
      est = await createPersonBrowserSession(client, person, "telegram");
    } finally {
      client.release();
    }
    const created = await draftPost(app, est, { step: "item", payload: {}, startFresh: true });
    const draftId = created.body.draftId as string;
    await photoPost(app, est, draftId, FIXTURE_B, "only-b.png");
    await draftPost(app, est, {
      step: "summary",
      payload: { item: "Only B", recipientUserId: staff.id, dueMode: "today", comment: "" },
    });
    const confirm = await request(app)
      .post("/api/tan-tracker/public/external/request/confirm")
      .set("Origin", ORIGIN)
      .set("X-TT-External-Est", est)
      .send({ draftId });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    const att = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_transfer_attachments WHERE transfer_id = $1`, [
      confirm.body.publicCode,
    ]);
    assert.equal(att.rows[0]?.c, 1);
  });

  it("upload rejects confirmed draft id", async () => {
    const app = await loadApp();
    const pool = getPool()!;
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-fresh-staff2@test.local",
      password: PASSWORD,
      fullName: "Fresh Staff2",
      role: "manager",
    });
    await pool.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Fresh Staff2", "+79991112206");
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Fresh Ext3', '+79991112205') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991112205', 'Fresh Ext3', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', '881003', '881003')`,
      [person],
    );
    const client = await pool.connect();
    let est = "";
    try {
      est = await createPersonBrowserSession(client, person, "telegram");
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
         VALUES ('telegram', '881003', $1::uuid, 'summary', $2::jsonb)
         RETURNING id::text`,
        [person, JSON.stringify({ item: "X", recipientUserId: staff.id, dueMode: "today" })],
      );
      const draftRow = await client.query<{ id: string }>(
        `SELECT id::text FROM tt_external_request_drafts WHERE person_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
        [person],
      );
      const draftId = draftRow.rows[0]!.id;
      const confirmed = await confirmExternalRequestDraft(client, {
        personId: person,
        externalPartyId: extParty,
        draftId,
        idempotencyKey: `ext-req:${draftId}`,
      });
      assert.ok(confirmed.publicCode);
      await client.query("COMMIT");
      const up = await photoPost(app, est, draftId, FIXTURE_A, "after-confirm.png");
      assert.equal(up.status, 409);
    } finally {
      client.release();
    }
  });
});
