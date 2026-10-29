import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

/** Minimal valid 1×1 JPEG */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=",
  "base64",
);

function headers(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Origin: ORIGIN, ...extra };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function loadApp() {
  await resetPoolForTests();
  process.env.TT_ATTACHMENTS_BACKEND = "postgres";
  process.env.TT_ATTACHMENTS_DIR = "var/tt-lk-write-capability-test";
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, app: Awaited<ReturnType<typeof loadApp>>) {
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("tan-tracker LK write capability (HTTP)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  it("technical admin bootstrap exposes canWrite=false", async () => {
    await createTestUser({
      databaseUrl,
      email: "tt-admin-cap@test.local",
      password: PASSWORD,
      fullName: "TT Admin Cap",
      role: "admin",
    });
    const app = await loadApp();
    const cookie = await login("tt-admin-cap@test.local", app);
    const res = await request(app).get("/api/tan-tracker/bootstrap").set(headers(cookie));
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.capabilities?.canWrite, false);
    assert.equal(res.body.previewReadOnly, false);
    assert.equal(res.body.actorPartyId, null);
  });

  it("linked manager bootstrap exposes canWrite=true", async () => {
    const emp = randomUUID();
    await createTestUser({
      databaseUrl,
      email: "tt-mgr-cap@test.local",
      password: PASSWORD,
      fullName: "TT Mgr Cap",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Mgr Cap', 'Manager', '{}')`,
        [emp],
      );
      const user = (
        await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, ["tt-mgr-cap@test.local"])
      ).rows[0];
      await linkUserToEmployee({
        databaseUrl,
        userId: user.id,
        employeeId: emp,
        confirmedByUserId: user.id,
      });
      await ensurePartyForUserOnWrite(client, user.id, "TT Mgr Cap", "+79995556601");
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-mgr-cap@test.local", app);
    const res = await request(app).get("/api/tan-tracker/bootstrap").set(headers(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.capabilities?.canWrite, true);
    assert.ok(res.body.actorPartyId);
  });

  it("admin POST create is rejected without weakening server guard", async () => {
    const app = await loadApp();
    const cookie = await login("tt-admin-cap@test.local", app);
    const res = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie, { "Content-Type": "application/json" }))
      .send({ item: "Blocked", finalRecipientExternal: { name: "X", phone: "+79990001122" } });
    assert.equal(res.status, 403, res.text);
  });

  it("manager creates transfer with JPEG staging and bytes are retrievable", async () => {
    const pool = getPool();
    assert.ok(pool);
    const peerPartyId = (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM tt_parties WHERE display_name = 'Ext Cap Peer' LIMIT 1`,
      )
    ).rows[0]?.id;
    let finalPeer = peerPartyId;
    if (!finalPeer) {
      const client = await pool.connect();
      try {
        const user = (
          await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, ["tt-mgr-cap@test.local"])
        ).rows[0];
        finalPeer = (
          await client.query<{ id: string }>(
            `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
             VALUES ('external', 'Ext Cap Peer', '+79995556602', $1::uuid) RETURNING id::text`,
            [user.id],
          )
        ).rows[0].id;
      } finally {
        client.release();
      }
    }

    const app = await loadApp();
    const cookie = await login("tt-mgr-cap@test.local", app);

    const stageRes = await request(app)
      .post("/api/tan-tracker/staging-attachments")
      .set(
        headers(cookie, {
          "Content-Type": "image/jpeg",
          "X-TT-Filename": encodeURIComponent("фото.jpg"),
          "X-TT-Mime-Type": "image/jpeg",
        }),
      )
      .send(TINY_JPEG);
    assert.equal(stageRes.status, 201, stageRes.text);
    assert.equal(stageRes.body.name, "фото.jpg");

    const createRes = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie, { "Content-Type": "application/json" }))
      .send({
        item: "Короб с фото",
        finalRecipientPartyId: finalPeer,
        stagingAttachmentIds: [stageRes.body.id],
      });
    assert.equal(createRes.status, 201, createRes.text);
    const code = createRes.body.publicCode as string;
    assert.ok(code);
    assert.ok(createRes.body.bootstrap?.orders?.some((o: { id: string }) => o.id === code));

    const order = createRes.body.bootstrap.orders.find((o: { id: string }) => o.id === code);
    assert.equal(order.attachments?.length, 1);
    const attId = order.attachments[0].id;

    const dl = await request(app)
      .get(`/api/tan-tracker/transfers/${encodeURIComponent(code)}/attachments/${encodeURIComponent(attId)}`)
      .set(headers(cookie));
    assert.equal(dl.status, 200);
    assert.ok(dl.body.equals(TINY_JPEG), "attachment bytes must match staged JPEG");

    const bootstrap2 = await request(app).get("/api/tan-tracker/bootstrap").set(headers(cookie));
    assert.equal(bootstrap2.status, 200);
    assert.ok(bootstrap2.body.orders.some((o: { id: string }) => o.id === code));
  });

  it("manager creates transfer without attachments", async () => {
    const pool = getPool();
    assert.ok(pool);
    const finalPeer = (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM tt_parties WHERE display_name = 'Ext Cap Peer' LIMIT 1`,
      )
    ).rows[0]?.id;
    assert.ok(finalPeer);

    const app = await loadApp();
    const cookie = await login("tt-mgr-cap@test.local", app);
    const createRes = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie, { "Content-Type": "application/json" }))
      .send({ item: "Без файлов", finalRecipientPartyId: finalPeer });
    assert.equal(createRes.status, 201, createRes.text);
    assert.ok(createRes.body.publicCode);
  });
});
