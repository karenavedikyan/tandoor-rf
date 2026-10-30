import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { getPool } from "../../src/db/pool";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

function headers(cookie?: string): Record<string, string> {
  const h: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, app: Awaited<ReturnType<typeof loadApp>>) {
  const res = await request(app).post("/api/auth/login").set(headers()).send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("tan-tracker HTTP mutation guards", { concurrency: false }, () => {
  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("POST /transfers reuses global external party by id and phone without rename", async () => {
    const m1 = await createTestUser({
      databaseUrl,
      email: "http-m1@test.local",
      password: PASSWORD,
      fullName: "HTTP M1",
      role: "manager",
    });
    const m2 = await createTestUser({
      databaseUrl,
      email: "http-m2@test.local",
      password: PASSWORD,
      fullName: "HTTP M2",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let secretPartyId = "";
    try {
      await ensurePartyForUserOnWrite(client, m1.id, "HTTP M1", "+79991112233");
      await ensurePartyForUserOnWrite(client, m2.id, "HTTP M2", "+79992223344");
      secretPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external','Secret','+79993334455',$1::uuid) RETURNING id::text`,
          [m2.id],
        )
      ).rows[0].id;
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("http-m1@test.local", app);
    const byId = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie))
      .send({ item: "Box by id", finalRecipientPartyId: secretPartyId });
    assert.equal(byId.status, 201, byId.text);
    const byPhone = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie))
      .send({
        item: "Box by phone",
        finalRecipientExternal: { name: "Secret", phone: "+79993334455" },
      });
    assert.equal(byPhone.status, 201, byPhone.text);

    const poolAfterApp = getPool();
    assert.ok(poolAfterApp);
    const rows = await poolAfterApp.query<{ final_recipient_party_id: string; display_name: string }>(
      `SELECT t.final_recipient_party_id::text, p.display_name
       FROM tt_transfers t
       JOIN tt_parties p ON p.id = t.final_recipient_party_id
       WHERE t.item_title IN ('Box by id', 'Box by phone')`,
    );
    assert.equal(rows.rowCount, 2);
    for (const row of rows.rows) {
      assert.equal(row.final_recipient_party_id, secretPartyId);
      assert.equal(row.display_name, "Secret");
    }
  });

  it("POST /transfers rejects unknown recipient party and ineligible staff user", async () => {
    const m1 = await createTestUser({
      databaseUrl,
      email: "http-guard-m1@test.local",
      password: PASSWORD,
      fullName: "Guard M1",
      role: "manager",
    });
    const m2 = await createTestUser({
      databaseUrl,
      email: "http-guard-m2@test.local",
      password: PASSWORD,
      fullName: "Guard M2",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let peerUserPartyId = "";
    try {
      await ensurePartyForUserOnWrite(client, m1.id, "Guard M1", "+79994445501");
      const peerParty = await ensurePartyForUserOnWrite(client, m2.id, "Guard M2", "+79994445502");
      peerUserPartyId = peerParty.id;
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("http-guard-m1@test.local", app);
    const missing = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie))
      .send({ item: "Ghost", finalRecipientPartyId: randomUUID() });
    assert.equal(missing.status, 403, missing.text);

    const staffPeer = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie))
      .send({ item: "Wrong staff", finalRecipientPartyId: peerUserPartyId });
    assert.equal(staffPeer.status, 403, staffPeer.text);
  });

  it("POST /transfers/:id/pending/cancel rejects non-holder manager", async () => {
    const owner = await createTestUser({
      databaseUrl,
      email: "http-owner@test.local",
      password: PASSWORD,
      fullName: "HTTP Owner",
      role: "manager",
    });
    const intruder = await createTestUser({
      databaseUrl,
      email: "http-intruder@test.local",
      password: PASSWORD,
      fullName: "HTTP Intruder",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let publicCode = "";
    let extPartyId = "";
    try {
      const holderParty = await ensurePartyForUserOnWrite(client, owner.id, "HTTP Owner", "+79995556601");
      await ensurePartyForUserOnWrite(client, intruder.id, "HTTP Intruder", "+79995556602");
      extPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external','Ext peer','+79995556603',$1::uuid) RETURNING id::text`,
          [owner.id],
        )
      ).rows[0].id;
      publicCode = (
        await client.query<{ public_code: string }>(
          `INSERT INTO tt_transfers (
            id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
            final_recipient_party_id, handoff_version
          ) VALUES ($1,$1,'Owned','waiting',$2,$2,$3,$3,1)
          RETURNING public_code`,
          [`TT-GUARD-${randomUUID().slice(0, 8)}`, holderParty.id, extPartyId],
        )
      ).rows[0].public_code;
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("http-intruder@test.local", app);
    const res = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(publicCode)}/pending/cancel`)
      .set(headers(cookie))
      .send({});
    assert.equal(res.status, 403, res.text);
  });

  it("POST /transfers rejects marketer role", async () => {
    await createTestUser({
      databaseUrl,
      email: "http-marketer@test.local",
      password: PASSWORD,
      fullName: "Marketer",
      role: "marketer",
    });
    const app = await loadApp();
    const cookie = await login("http-marketer@test.local", app);
    const res = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie))
      .send({
        item: "Box",
        finalRecipientExternal: { name: "X", phone: "+79001112233" },
      });
    assert.equal(res.status, 403);
  });
});
