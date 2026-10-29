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

async function publicPhoneFlow(
  app: Awaited<ReturnType<typeof loadApp>>,
  publicCode: string,
  pendingPartyId: string,
  invitationToken: string,
) {
  const sendRes = await request(app)
    .post("/api/tan-tracker/public/recipient/phone/send")
    .set(headers(undefined, { "Content-Type": "application/json" }))
    .send({ invitationToken });
  assert.equal(sendRes.status, 200, sendRes.text);
  const otp = peekTestPhoneVerificationCode(publicCode, pendingPartyId);
  assert.ok(otp);
  const verifyRes = await request(app)
    .post("/api/tan-tracker/public/recipient/phone/verify")
    .set(headers(undefined, { "Content-Type": "application/json" }))
    .send({ invitationToken, code: otp });
  assert.equal(verifyRes.status, 200, verifyRes.text);
  return verifyRes.body.phoneSessionToken as string;
}

describe("tan-tracker P1 regression", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("RELAY-01: external relay holder stays active, holder token reload, send-to-final, final completes", async () => {
    const emp = randomUUID();
    const creator = await createTestUser({
      databaseUrl,
      email: "tt-relay-creator@test.local",
      password: PASSWORD,
      fullName: "Relay Creator",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let relayPartyId = "";
    let finalPartyId = "";
    let publicCode = "";
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Relay Creator', 'Manager', '{}')`,
        [emp],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: creator.id,
        employeeId: emp,
        confirmedByUserId: creator.id,
      });
      const holderParty = await ensurePartyForUserOnWrite(client, creator.id, "Relay Creator", "+79996661001");
      relayPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Relay Ext', '+79996661002', $1::uuid) RETURNING id::text`,
          [creator.id],
        )
      ).rows[0].id;
      finalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Final Ext', '+79996661003', $1::uuid) RETURNING id::text`,
          [creator.id],
        )
      ).rows[0].id;
      publicCode = (
        await client.query<{ public_code: string }>(
          `INSERT INTO tt_transfers (
            id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
            final_recipient_party_id, handoff_version
          ) VALUES ($1,$1,'Relay chain','waiting',$2,$2,$3,$4,1)
          RETURNING public_code`,
          [`TT-T-REL-${randomUUID().slice(0, 8)}`, holderParty.id, relayPartyId, finalPartyId],
        )
      ).rows[0].public_code;
      await client.query(
        `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
         VALUES ($1,1,$2,$3,'Relay chain')`,
        [publicCode, holderParty.id, relayPartyId],
      );
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-relay-creator@test.local", app);
    const bootstrap = await request(app).get("/api/tan-tracker/bootstrap").set(headers(cookie));
    const order = bootstrap.body.orders.find((o: { id: string }) => o.id === publicCode);
    assert.ok(order?.activeInvitation?.invitationToken);
    const relayToken = order.activeInvitation.invitationToken as string;

    const phoneSession = await publicPhoneFlow(app, publicCode, relayPartyId, relayToken);
    const confirmRes = await request(app)
      .post("/api/tan-tracker/public/recipient/handoff/qr-confirm")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ invitationToken: relayToken, phoneSessionToken: phoneSession });
    assert.equal(confirmRes.status, 200, confirmRes.text);
    assert.equal(confirmRes.body.receipt.routeComplete, false);
    assert.equal(confirmRes.body.receipt.transferStatus, "active");
    assert.ok(confirmRes.body.receipt.holderAccessToken);

    const db = getPool();
    assert.ok(db);
    const afterRelay = await db.query(
      `SELECT status, holder_party_id::text, pending_party_id, completed_at
       FROM tt_transfers WHERE public_code = $1`,
      [publicCode],
    );
    assert.equal(afterRelay.rows[0].status, "active");
    assert.equal(afterRelay.rows[0].holder_party_id, relayPartyId);
    assert.equal(afterRelay.rows[0].pending_party_id, null);
    assert.equal(afterRelay.rows[0].completed_at, null);

    const holderTok = confirmRes.body.receipt.holderAccessToken as string;
    const ctxRes = await request(app)
      .get("/api/tan-tracker/public/holder/context")
      .query({ holderAccessToken: holderTok });
    assert.equal(ctxRes.status, 200, ctxRes.text);
    assert.equal(ctxRes.body.publicHolder, true);
    assert.equal(ctxRes.body.orders[0].status, "active");

    const staleCtx = await request(app)
      .get("/api/tan-tracker/public/recipient/context")
      .query({ invitationToken: relayToken });
    assert.equal(staleCtx.status, 404);

    const sendFinal = await request(app)
      .post("/api/tan-tracker/public/holder/send-to-final")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ holderAccessToken: holderTok });
    assert.equal(sendFinal.status, 200, sendFinal.text);
    assert.equal(sendFinal.body.orders[0].status, "waiting");
    assert.ok(sendFinal.body.orders[0].activeInvitation?.invitationToken);
    assert.ok(sendFinal.body.holderAccessToken);
    const reloadCtx = await request(app)
      .get("/api/tan-tracker/public/holder/context")
      .query({ holderAccessToken: sendFinal.body.holderAccessToken });
    assert.equal(reloadCtx.status, 200, reloadCtx.text);

    const finalToken = sendFinal.body.orders[0].activeInvitation.invitationToken as string;
    const finalPhone = await publicPhoneFlow(app, publicCode, finalPartyId, finalToken);
    const finalConfirm = await request(app)
      .post("/api/tan-tracker/public/recipient/handoff/qr-confirm")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ invitationToken: finalToken, phoneSessionToken: finalPhone });
    assert.equal(finalConfirm.status, 200, finalConfirm.text);
    assert.equal(finalConfirm.body.receipt.routeComplete, true);
    assert.equal(finalConfirm.body.receipt.transferStatus, "completed");

    const done = await db.query(
      `SELECT status, holder_party_id::text, completed_at IS NOT NULL AS done FROM tt_transfers WHERE public_code = $1`,
      [publicCode],
    );
    assert.equal(done.rows[0].status, "completed");
    assert.equal(done.rows[0].holder_party_id, finalPartyId);
    assert.equal(done.rows[0].done, true);
  });

  it("CODE-01: public recipient code generate works without auth cookie after SMS", async () => {
    const emp = randomUUID();
    const creator = await createTestUser({
      databaseUrl,
      email: "tt-code-pub@test.local",
      password: PASSWORD,
      fullName: "Code Pub Creator",
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
        userId: creator.id,
        employeeId: emp,
        confirmedByUserId: creator.id,
      });
      const holderParty = await ensurePartyForUserOnWrite(client, creator.id, "Code Pub Creator", "+79997771001");
      pendingPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Code Final', '+79997771002', $1::uuid) RETURNING id::text`,
          [creator.id],
        )
      ).rows[0].id;
      publicCode = (
        await client.query<{ public_code: string }>(
          `INSERT INTO tt_transfers (
            id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
            final_recipient_party_id, handoff_version
          ) VALUES ($1,$1,'Code item','waiting',$2,$2,$3,$3,1)
          RETURNING public_code`,
          [`TT-T-CODE-${randomUUID().slice(0, 8)}`, holderParty.id, pendingPartyId],
        )
      ).rows[0].public_code;
      await client.query(
        `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
         VALUES ($1,1,$2,$3,'Code item')`,
        [publicCode, holderParty.id, pendingPartyId],
      );
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-code-pub@test.local", app);
    const bootstrap = await request(app).get("/api/tan-tracker/bootstrap").set(headers(cookie));
    const order = bootstrap.body.orders.find((o: { id: string }) => o.id === publicCode);
    const token = order.activeInvitation.invitationToken as string;

    const unauth = await request(app)
      .post("/api/tan-tracker/public/recipient/code/generate")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ invitationToken: token });
    assert.equal(unauth.status, 403);

    const phoneSession = await publicPhoneFlow(app, publicCode, pendingPartyId, token);
    const genRes = await request(app)
      .post("/api/tan-tracker/public/recipient/code/generate")
      .set(headers(undefined, { "Content-Type": "application/json" }))
      .send({ invitationToken: token, phoneSessionToken: phoneSession });
    assert.equal(genRes.status, 200, genRes.text);
    assert.match(genRes.body.code, /^\d{6}$/);
  });

  it("SCOPE-01: ROP sees team member transfer via 1C team without legacy rop_team_members", async () => {
    const empR = randomUUID();
    const empB = randomUUID();
    const teamA = randomUUID();
    const teamB = randomUUID();

    const rop = await createTestUser({
      databaseUrl,
      email: "tt-rop-scope@test.local",
      password: PASSWORD,
      fullName: "ROP Scope",
      role: "rop",
    });
    const memberB = await createTestUser({
      databaseUrl,
      email: "tt-member-b@test.local",
      password: PASSWORD,
      fullName: "Member B",
      role: "manager",
    });
    const outsider = await createTestUser({
      databaseUrl,
      email: "tt-outsider@test.local",
      password: PASSWORD,
      fullName: "Outsider M",
      role: "manager",
    });

    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let extPartyB = "";
    let extPartyOut = "";
    let memberPublicCode = "";
    let outsiderPublicCode = "";
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'ROP Scope', 'ROP', '{}'), ($2::uuid, 'Member B', 'Manager', '{}'), ($3::uuid, 'Outsider', 'Manager', '{}')`,
        [empR, empB, randomUUID()],
      );
      await client.query(
        `INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
         VALUES ($1::uuid, 'QA team A', $2::uuid, 'ROP Scope'), ($3::uuid, 'QA team B', $2::uuid, 'ROP Scope')`,
        [teamA, empR, teamB],
      );
      await client.query(
        `INSERT INTO onec_wholesale_employee_team_memberships (guid_team, guid_manager, name_team)
         VALUES ($1::uuid, $2::uuid, 'QA team A'), ($3::uuid, $2::uuid, 'QA team B')`,
        [teamA, empB, teamB],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: rop.id,
        employeeId: empR,
        confirmedByUserId: rop.id,
      });
      await linkUserToEmployee({
        databaseUrl,
        userId: memberB.id,
        employeeId: empB,
        confirmedByUserId: memberB.id,
      });
      const bParty = await ensurePartyForUserOnWrite(client, memberB.id, "Member B", "+79998881001");
      const outParty = await ensurePartyForUserOnWrite(client, outsider.id, "Outsider M", "+79998882001");
      extPartyB = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Ext client B', '+79998883001', $1::uuid) RETURNING id::text`,
          [memberB.id],
        )
      ).rows[0].id;
      extPartyOut = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Ext client Out', '+79998883099', $1::uuid) RETURNING id::text`,
          [outsider.id],
        )
      ).rows[0].id;
      memberPublicCode = (
        await client.query<{ public_code: string }>(
          `INSERT INTO tt_transfers (
            id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
            final_recipient_party_id, handoff_version
          ) VALUES ($1,$1,'B transfer','waiting',$2,$2,$3,$3,1)
          RETURNING public_code`,
          [`TT-T-B-${randomUUID().slice(0, 8)}`, bParty.id, extPartyB],
        )
      ).rows[0].public_code;
      outsiderPublicCode = (
        await client.query<{ public_code: string }>(
          `INSERT INTO tt_transfers (
            id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
            final_recipient_party_id, handoff_version
          ) VALUES ($1,$1,'Out transfer','waiting',$2,$2,$3,$3,1)
          RETURNING public_code`,
          [`TT-T-O-${randomUUID().slice(0, 8)}`, outParty.id, extPartyOut],
        )
      ).rows[0].public_code;
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-rop-scope@test.local", app);
    const bootstrap = await request(app).get("/api/tan-tracker/bootstrap").set(headers(cookie));
    assert.equal(bootstrap.status, 200, bootstrap.text);
    const ids = bootstrap.body.orders.map((o: { id: string }) => o.id);
    assert.ok(ids.includes(memberPublicCode), "ROP must see member B transfer via 1C team");
    assert.equal(
      ids.filter((id: string) => id === memberPublicCode).length,
      1,
      "transfer listed once",
    );
    assert.ok(!ids.includes(outsiderPublicCode), "ROP must not see unrelated manager transfer");
  });

  it("FILES-01: create rejects more than 10 staging attachments", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "tt-files11@test.local",
      password: PASSWORD,
      fullName: "Files Eleven",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let peerPartyId = "";
    const stagingIds: string[] = [];
    try {
      await ensurePartyForUserOnWrite(client, user.id, "Files Eleven", "+79999991001");
      peerPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Peer', '+79999991002', $1::uuid) RETURNING id::text`,
          [user.id],
        )
      ).rows[0].id;
      for (let i = 0; i < 11; i++) {
        const row = await client.query<{ id: string }>(
          `INSERT INTO tt_staged_attachments (owner_user_id, storage_key, original_name, mime_type, byte_size)
           VALUES ($1::uuid,$2,$3,'text/plain',5) RETURNING id::text`,
          [user.id, `st-${randomUUID()}`, `f${i}.txt`],
        );
        stagingIds.push(row.rows[0].id);
      }
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("tt-files11@test.local", app);
    const createRes = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie, { "Content-Type": "application/json" }))
      .send({
        item: "Too many files",
        finalRecipientPartyId: peerPartyId,
        stagingAttachmentIds: stagingIds,
      });
    assert.equal(createRes.status, 400, createRes.text);
    const dbAfter = getPool();
    assert.ok(dbAfter);
    const count = await dbAfter.query(
      `SELECT COUNT(*)::int AS n FROM tt_transfers WHERE item_title = 'Too many files'`,
    );
    assert.equal(count.rows[0].n, 0);
  });
});
