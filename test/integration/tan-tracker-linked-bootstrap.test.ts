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
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { peekTestPhoneVerificationCode } from "../../src/tan-tracker/phone-verification";

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
      await linkUserToEmployee({
        databaseUrl,
        userId: userA.id,
        employeeId: empA,
        confirmedByUserId: userA.id,
      });
      await linkUserToEmployee({
        databaseUrl,
        userId: userB.id,
        employeeId: empB,
        confirmedByUserId: userB.id,
      });
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
      await linkUserToEmployee({
        databaseUrl,
        userId: user.id,
        employeeId: emp,
        confirmedByUserId: user.id,
      });
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

  it("public QR handoff completes waiting transfer after phone verify (test SMS)", async () => {
    const emp = randomUUID();
    const holder = await createTestUser({
      databaseUrl,
      email: "tt-qr-holder@test.local",
      password: PASSWORD,
      fullName: "QR Holder",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let pendingPartyId = "";
    let publicCode = "";
    try {
      await linkUserToEmployee({
        databaseUrl,
        userId: holder.id,
        employeeId: emp,
        confirmedByUserId: holder.id,
      });
      const holderParty = await ensurePartyForUserOnWrite(client, holder.id, "QR Holder", "+79994440001");
      pendingPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'QR Pending', '+79994440002', $1::uuid) RETURNING id::text`,
          [holder.id],
        )
      ).rows[0].id;
      publicCode = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_transfers (
            id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
            final_recipient_party_id, handoff_version
          ) VALUES ('TT-T-QR-1','TT-T-QR-1','QR item','waiting',$1,$1,$2,$2,1)
          RETURNING public_code`,
          [holderParty.id, pendingPartyId],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
         VALUES ($1,1,$2,$3,'QR item')`,
        [publicCode, holderParty.id, pendingPartyId],
      );
    } finally {
      client.release();
    }

    const app = await loadApp();
    const inviteRes = await request(app)
      .get("/api/tan-tracker/bootstrap")
      .set(headers(await login("tt-qr-holder@test.local", app)));
    const order = inviteRes.body.orders.find((o: { id: string }) => o.id === publicCode);
    assert.ok(order?.activeInvitation?.invitationToken);

    const token = order.activeInvitation.invitationToken;
    const sendRes = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/send")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ invitationToken: token });
    assert.equal(sendRes.status, 200, sendRes.text);

    const otp = peekTestPhoneVerificationCode(publicCode, pendingPartyId);
    assert.ok(otp);
    const verifyRes = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/verify")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ invitationToken: token, code: otp });
    assert.equal(verifyRes.status, 200, verifyRes.text);

    const confirmRes = await request(app)
      .post("/api/tan-tracker/public/recipient/handoff/qr-confirm")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ invitationToken: token, phoneSessionToken: verifyRes.body.phoneSessionToken });
    assert.equal(confirmRes.status, 200, confirmRes.text);

    const after = await pool!.query(
      `SELECT status, holder_party_id::text FROM tt_transfers WHERE public_code = $1`,
      [publicCode],
    );
    assert.equal(after.rows[0].status, "completed");
    assert.equal(after.rows[0].holder_party_id, pendingPartyId);
  });

  it("POST create returns refreshRequired when bootstrap rebuild is injected to fail", async () => {
    process.env.TT_TEST_BOOTSTRAP_FAIL_AFTER_CREATE = "1";
    const user = await createTestUser({
      databaseUrl,
      email: "tt-refresh-fault@test.local",
      password: PASSWORD,
      fullName: "Refresh Fault",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let peerPartyId = "";
    try {
      await ensurePartyForUserOnWrite(client, user.id, "Refresh Fault", "+79995550001");
      peerPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Peer', '+79995550002', $1::uuid) RETURNING id::text`,
          [user.id],
        )
      ).rows[0].id;
    } finally {
      client.release();
    }
    const app = await loadApp();
    const cookie = await login("tt-refresh-fault@test.local", app);
    const createRes = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie, { "Content-Type": "application/json" }))
      .send({ item: "Fault box", finalRecipientPartyId: peerPartyId });
    delete process.env.TT_TEST_BOOTSTRAP_FAIL_AFTER_CREATE;
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.refreshRequired, true);
    assert.equal(createRes.body.bootstrap, null);
    assert.ok(createRes.body.publicCode);
  });
});
