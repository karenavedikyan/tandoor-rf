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
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

function headers(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Origin: ORIGIN, ...extra };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function loadApp() {
  await resetPoolForTests();
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

describe("tan-tracker linked employee bootstrap", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("GET bootstrap succeeds with employee link and exposes peer on team", async () => {
    const empA = randomUUID();
    const empB = randomUUID();
    const teamId = randomUUID();

    const userA = await createTestUser({
      databaseUrl,
      email: "tt-peer-a@test.local",
      password: PASSWORD,
      fullName: "TT Peer A",
      role: "manager",
    });
    const userB = await createTestUser({
      databaseUrl,
      email: "tt-peer-b@test.local",
      password: PASSWORD,
      fullName: "TT Peer B",
      role: "manager",
    });

    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Peer A', 'Manager', '{}'), ($2::uuid, 'Peer B', 'Manager', '{}')`,
        [empA, empB],
      );
      await client.query(
        `INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
         VALUES ($1::uuid, 'TT team', $2::uuid, 'Peer A')`,
        [teamId, empA],
      );
      await client.query(
        `INSERT INTO onec_wholesale_employee_team_memberships (guid_team, guid_manager, name_team)
         VALUES ($1::uuid, $2::uuid, 'TT team'), ($1::uuid, $3::uuid, 'TT team')`,
        [teamId, empA, empB],
      );
      await client.query(
        `INSERT INTO user_onec_employee_links (user_id, employee_id)
         VALUES ($1::uuid, $2::uuid), ($3::uuid, $4::uuid)`,
        [userA.id, empA, userB.id, empB],
      );
      await ensurePartyForUserOnWrite(client, userA.id, "TT Peer A", "+79991110001");
      await ensurePartyForUserOnWrite(client, userB.id, "TT Peer B", "+79991110002");
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-peer-a@test.local", app);
    const bootstrapRes = await request(app)
      .get("/api/tan-tracker/bootstrap")
      .set(headers(cookie));
    assert.equal(bootstrapRes.status, 200, bootstrapRes.text);
    assert.equal(bootstrapRes.body.lkMode, true);
    assert.ok(bootstrapRes.body.actorContact);
    assert.equal(bootstrapRes.body.actorContact.kind, "user");
    assert.equal(bootstrapRes.body.linkedEmployeeId, empA);

    const peerContact = bootstrapRes.body.contacts.find(
      (c: { name: string }) => c.name === "TT Peer B",
    );
    assert.ok(peerContact, "colleague party must appear in contact picker scope");
    assert.equal(peerContact.kind, "user");
  });

  it("POST create returns bootstrap and staging upload accepts raw body", async () => {
    const emp = randomUUID();
    const user = await createTestUser({
      databaseUrl,
      email: "tt-create-linked@test.local",
      password: PASSWORD,
      fullName: "TT Create Linked",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let peerPartyId = "";
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Creator', 'Manager', '{}')`,
        [emp],
      );
      await client.query(`INSERT INTO user_onec_employee_links (user_id, employee_id) VALUES ($1::uuid, $2::uuid)`, [
        user.id,
        emp,
      ]);
      const party = await ensurePartyForUserOnWrite(client, user.id, "TT Create Linked", "+79992220001");
      peerPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Ext peer', '+79992220002', $1::uuid) RETURNING id::text`,
          [user.id],
        )
      ).rows[0].id;
      assert.ok(party.id);
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-create-linked@test.local", app);

    const stageRes = await request(app)
      .post("/api/tan-tracker/staging-attachments")
      .set(headers(cookie, { "X-TT-Filename": encodeURIComponent("Договор.txt"), "X-TT-Mime-Type": "text/plain" }))
      .send(Buffer.from("hello", "utf8"));
    assert.equal(stageRes.status, 201, stageRes.text);
    assert.equal(stageRes.body.name, "Договор.txt");

    const createRes = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie, { "Content-Type": "application/json" }))
      .send({
        item: "Короб",
        finalRecipientPartyId: peerPartyId,
        stagingAttachmentIds: [stageRes.body.id],
      });
    assert.equal(createRes.status, 201, createRes.text);
    assert.ok(createRes.body.bootstrap);
    assert.ok(
      createRes.body.bootstrap.orders.some((o: { item: string }) => o.item === "Короб"),
      "created transfer visible in bootstrap",
    );
  });

  it("user without employee link is internal actor, not external shell", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "tt-unlinked@test.local",
      password: PASSWORD,
      fullName: "TT Unlinked",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      await ensurePartyForUserOnWrite(client, user.id, "TT Unlinked", "+79993330001");
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-unlinked@test.local", app);
    const res = await request(app).get("/api/tan-tracker/bootstrap").set(headers(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.linkedEmployeeId, null);
    assert.equal(res.body.actorContact.kind, "user");
    const self = res.body.contacts.find((c: { id: string }) => c.id === res.body.actorPartyId);
    assert.ok(self);
    assert.equal(self.kind, "user");
    assert.equal(self.employeeId, null);
  });
});
