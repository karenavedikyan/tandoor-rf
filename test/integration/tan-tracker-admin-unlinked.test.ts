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
import { TT_PENDING_USER_PARTY_PREFIX } from "../../src/tan-tracker/recipient-catalog";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

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
  process.env.TT_ATTACHMENTS_DIR = "var/tt-admin-unlinked-test";
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

describe("tan-tracker admin without employee link", { concurrency: false }, () => {
  let adminCookie = "";
  let mgrCookie = "";
  let freshMgrId = "";
  let disabledMgrId = "";

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);

    await createTestUser({
      databaseUrl,
      email: "tt-admin-unlinked@test.local",
      password: PASSWORD,
      fullName: "Admin Unlinked",
      role: "admin",
    });
    freshMgrId = (
      await createTestUser({
        databaseUrl,
        email: "tt-fresh-recipient@test.local",
        password: PASSWORD,
        fullName: "Fresh Recipient",
        role: "manager",
      })
    ).id;
    disabledMgrId = (
      await createTestUser({
        databaseUrl,
        email: "tt-disabled-recipient@test.local",
        password: PASSWORD,
        fullName: "Disabled Recipient",
        role: "manager",
      })
    ).id;
    const pool = getPool();
    assert.ok(pool);
    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1::uuid`, [disabledMgrId]);

    const emp = randomUUID();
    await createTestUser({
      databaseUrl,
      email: "tt-mgr-peer@test.local",
      password: PASSWORD,
      fullName: "Mgr Peer",
      role: "manager",
    });
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Mgr Peer', 'Manager', '{}')`,
        [emp],
      );
      const mgr = (await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "tt-mgr-peer@test.local",
      ])).rows[0];
      const { linkUserToEmployee } = await import("../helpers/access-db-fixtures");
      await linkUserToEmployee({
        databaseUrl,
        userId: mgr.id,
        employeeId: emp,
        confirmedByUserId: mgr.id,
      });
      const { ensurePartyForUserOnWrite } = await import("../../src/tan-tracker/repository");
      await ensurePartyForUserOnWrite(client, mgr.id, "Mgr Peer", "+79996667701");
    } finally {
      client.release();
    }

    const app = await loadApp();
    adminCookie = await login("tt-admin-unlinked@test.local", app);
    mgrCookie = await login("tt-mgr-peer@test.local", app);
  });

  after(async () => {
    await closePool();
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  it("bootstrap: admin canWrite with catalog including user without tt_party", async () => {
    const app = await loadApp();
    const res = await request(app).get("/api/tan-tracker/bootstrap").set(headers(adminCookie));
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.capabilities?.canWrite, true);
    assert.equal(res.body.linkedEmployeeId, null);
    const fresh = res.body.contacts.find(
      (c: { name: string }) => c.name === "Fresh Recipient",
    );
    assert.ok(fresh, "fresh manager must appear in recipient catalog");
    assert.equal(fresh.id, `${TT_PENDING_USER_PARTY_PREFIX}${freshMgrId}`);
    assert.ok(res.body.orders.length >= 0);
  });

  it("admin creates transfer with JPEG to fresh user; party materialized; reload visible", async () => {
    const app = await loadApp();
    const stage = await request(app)
      .post("/api/tan-tracker/staging-attachments")
      .set(
        headers(adminCookie, {
          "Content-Type": "image/jpeg",
          "X-TT-Filename": encodeURIComponent("admin-photo.jpg"),
          "X-TT-Mime-Type": "image/jpeg",
        }),
      )
      .send(TINY_JPEG);
    assert.equal(stage.status, 201, stage.text);

    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(adminCookie, { "Content-Type": "application/json" }))
      .send({
        item: "Admin box",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshMgrId}`,
        stagingAttachmentIds: [stage.body.id],
      });
    assert.equal(create.status, 201, create.text);
    const code = create.body.publicCode as string;
    assert.ok(create.body.bootstrap?.actorPartyId);

    const pool = getPool();
    const party = await pool!.query(
      `SELECT id FROM tt_parties WHERE user_id = $1::uuid AND kind = 'user'`,
      [freshMgrId],
    );
    assert.equal(party.rowCount, 1, "recipient party materialized on write");

    const attId = create.body.bootstrap.orders.find((o: { id: string }) => o.id === code).attachments[0].id;
    const dl = await request(app)
      .get(`/api/tan-tracker/transfers/${encodeURIComponent(code)}/attachments/${encodeURIComponent(attId)}`)
      .set(headers(adminCookie));
    assert.equal(dl.status, 200);
    assert.ok(dl.body.equals(TINY_JPEG));

    const reload = await request(app).get("/api/tan-tracker/bootstrap").set(headers(adminCookie));
    assert.ok(reload.body.orders.some((o: { id: string }) => o.id === code));
  });

  it("rejects disabled user as recipient via tampered party ref", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(adminCookie, { "Content-Type": "application/json" }))
      .send({
        item: "Bad recipient",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${disabledMgrId}`,
      });
    assert.equal(res.status, 403, res.text);
  });

  it("handoff: recipient generates code, holder admin verifies; recipient cannot verify as holder", async () => {
    const app = await loadApp();
    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(adminCookie, { "Content-Type": "application/json" }))
      .send({
        item: "Handoff path",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshMgrId}`,
      });
    assert.equal(create.status, 201);
    const transferId = create.body.publicCode as string;

    const freshCookie = await login("tt-fresh-recipient@test.local", app);
    const gen = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/generate`)
      .set(headers(freshCookie, { "Content-Type": "application/json" }))
      .send({});
    assert.equal(gen.status, 200, gen.text);
    const code = gen.body.code as string;
    assert.match(code, /^\d{6}$/);

    const forged = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
      .set(headers(freshCookie, { "Content-Type": "application/json" }))
      .send({ code });
    assert.equal(forged.status, 403, "pending recipient cannot verify as holder");

    const ok = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
      .set(headers(adminCookie, { "Content-Type": "application/json" }))
      .send({ code });
    assert.equal(ok.status, 200, ok.text);
  });

  it("manager scope unchanged: unrelated manager still cannot create for foreign party", async () => {
    const app = await loadApp();
    const pool = getPool();
    const foreignParty = (
      await pool!.query<{ id: string }>(
        `SELECT id::text FROM tt_parties WHERE user_id = $1::uuid`,
        [freshMgrId],
      )
    ).rows[0]?.id;
    assert.ok(foreignParty);
    const res = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(mgrCookie, { "Content-Type": "application/json" }))
      .send({ item: "Nope", finalRecipientPartyId: foreignParty });
    assert.equal(res.status, 403);
  });
});
