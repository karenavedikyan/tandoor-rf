import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";

describe("tan-tracker registry cleanup (isolated PG)", { concurrency: false }, () => {
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  let pool: Pool;
  let adminCookie = "";
  let transferPublicCode = "";
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    await createTestUser({
      databaseUrl,
      email: "registry-cleanup-admin@test.local",
      password: PASSWORD,
      fullName: "Registry Admin",
      role: "admin",
    });
    const { createApp } = await import("../../src/server");
    app = createApp();
    pool = new Pool({ connectionString: databaseUrl });
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "registry-cleanup-admin@test.local", password: PASSWORD });
    adminCookie = login.headers["set-cookie"]![0]!.split(";")[0]!;

    const adminUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "registry-cleanup-admin@test.local",
      ])
    ).rows[0]!.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const party = await ensurePartyForUserOnWrite(client, adminUserId, "Registry Admin", null);
      transferPublicCode = "REGCLN1";
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          handoff_version, row_version, completed_at)
         VALUES ($1, $2, 'Archive cleanup box', 'completed', $3, $3, 1, 1, NOW())`,
        ["tt-reg-cleanup-1", transferPublicCode, party.id],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool.end();
    await closePool();
  });

  it("personal archive persists in bootstrap lists", async () => {
    const archive = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({ action: "personal", transferIds: [transferPublicCode] });
    assert.equal(archive.status, 200, archive.text);
    assert.deepEqual(archive.body.applied, [transferPublicCode]);

    const boot = await request(app)
      .get("/api/tan-tracker/bootstrap")
      .set({ Origin: ORIGIN, Cookie: adminCookie });
    assert.equal(boot.status, 200);
    assert.ok(boot.body.registryPersonal?.archivedTransferIds?.includes(transferPublicCode));
  });

  it("technical admin deletes completed track with durable audit", async () => {
    const adminUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "registry-cleanup-admin@test.local",
      ])
    ).rows[0]!.id;
    const del = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: [transferPublicCode], deleteAck: "УДАЛИТЬ" });
    assert.equal(del.status, 200, del.text);
    assert.deepEqual(del.body.applied, [transferPublicCode]);
    const gone = await pool.query(`SELECT 1 FROM tt_transfers WHERE public_code = $1`, [transferPublicCode]);
    assert.equal(gone.rowCount, 0);
    const audit = await pool.query<{ actor_user_id: string; transfer_public_code: string }>(
      `SELECT actor_user_id::text, transfer_public_code FROM tt_transfer_delete_audit WHERE transfer_public_code = $1`,
      [transferPublicCode],
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0]!.actor_user_id, adminUserId);
  });

  it("ROP personal-archives team member completed transfer in team scope", async () => {
    const empR = randomUUID();
    const empM = randomUUID();
    const teamId = randomUUID();
    const rop = await createTestUser({
      databaseUrl,
      email: "registry-cleanup-rop@test.local",
      password: PASSWORD,
      fullName: "ROP Cleanup",
      role: "rop",
    });
    const member = await createTestUser({
      databaseUrl,
      email: "registry-cleanup-member@test.local",
      password: PASSWORD,
      fullName: "Member Cleanup",
      role: "manager",
    });
    const client = await pool.connect();
    let memberCode = "REGROP1";
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'ROP Cleanup', 'ROP', '{}'), ($2::uuid, 'Member Cleanup', 'Manager', '{}')`,
        [empR, empM],
      );
      await client.query(
        `INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
         VALUES ($1::uuid, 'Cleanup team', $2::uuid, 'ROP Cleanup')`,
        [teamId, empR],
      );
      await client.query(
        `INSERT INTO onec_wholesale_employee_team_memberships (guid_team, guid_manager, name_team)
         VALUES ($1::uuid, $2::uuid, 'Cleanup team')`,
        [teamId, empM],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: rop.id,
        employeeId: empR,
        confirmedByUserId: rop.id,
      });
      await linkUserToEmployee({
        databaseUrl,
        userId: member.id,
        employeeId: empM,
        confirmedByUserId: member.id,
      });
      await ensurePartyForUserOnWrite(client, rop.id, "ROP Cleanup", null);
      const memberParty = await ensurePartyForUserOnWrite(client, member.id, "Member Cleanup", null);
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          handoff_version, row_version, completed_at)
         VALUES ($1, $2, 'Team completed', 'completed', $3, $3, 1, 1, NOW())`,
        ["tt-reg-rop-1", memberCode, memberParty.id],
      );
    } finally {
      client.release();
    }
    const ropLogin = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "registry-cleanup-rop@test.local", password: PASSWORD });
    const ropCookie = ropLogin.headers["set-cookie"]![0]!.split(";")[0]!;
    const boot = await request(app)
      .get("/api/tan-tracker/bootstrap")
      .set({ Origin: ORIGIN, Cookie: ropCookie });
    assert.equal(boot.status, 200);
    assert.ok(boot.body.orders.some((o: { id: string }) => o.id === memberCode));
    const archive = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: ropCookie, "Content-Type": "application/json" })
      .send({ action: "personal", transferIds: [memberCode] });
    assert.equal(archive.status, 200, archive.text);
    assert.deepEqual(archive.body.applied, [memberCode]);
  });

  it("bootstrap canDeleteBeforeReceipt is false after first_custody_at", async () => {
    const adminUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "registry-cleanup-admin@test.local",
      ])
    ).rows[0]!.id;
    const client = await pool.connect();
    const code = "REGRCVD1";
    try {
      const party = await ensurePartyForUserOnWrite(client, adminUserId, "Registry Admin", null);
      const other = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Holder ext', '+79990003344', $1::uuid) RETURNING id::text`,
          [adminUserId],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          handoff_version, row_version, first_custody_at)
         VALUES ($1, $2, 'Received track', 'active', $3, $4, 1, 1, NOW())`,
        ["tt-reg-rcvd-1", code, party.id, other],
      );
    } finally {
      client.release();
    }
    const boot = await request(app)
      .get("/api/tan-tracker/bootstrap")
      .set({ Origin: ORIGIN, Cookie: adminCookie });
    const order = boot.body.orders.find((o: { id: string }) => o.id === code);
    assert.equal(order?.canDeleteBeforeReceipt, false);
  });

  it("bootstrap canDeleteBeforeReceipt is false for legacy audit without first_custody_at", async () => {
    const adminUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "registry-cleanup-admin@test.local",
      ])
    ).rows[0]!.id;
    const client = await pool.connect();
    const code = "REGLEG1";
    const transferId = "tt-reg-leg-audit-1";
    try {
      const party = await ensurePartyForUserOnWrite(client, adminUserId, "Registry Admin", null);
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          handoff_version, row_version, first_custody_at)
         VALUES ($1, $2, 'Legacy audit', 'active', $3, $3, 1, 1, NULL)`,
        [transferId, code, party.id],
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1, $2::uuid, $3, 'code_verify_ok', '{}'::jsonb)`,
        [transferId, adminUserId, party.id],
      );
    } finally {
      client.release();
    }
    const boot = await request(app)
      .get("/api/tan-tracker/bootstrap")
      .set({ Origin: ORIGIN, Cookie: adminCookie });
    const order = boot.body.orders.find((o: { id: string }) => o.id === code);
    assert.equal(order?.canDeleteBeforeReceipt, false);
  });

  it("admin can delete pending transfer before first receipt (bootstrap hint + API)", async () => {
    const adminUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "registry-cleanup-admin@test.local",
      ])
    ).rows[0]!.id;
    const client = await pool.connect();
    const pendingCode = "REGPEND1";
    try {
      const party = await ensurePartyForUserOnWrite(client, adminUserId, "Registry Admin", null);
      const ext = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external', 'Pending ext', '+79990001122', $1::uuid) RETURNING id::text`,
          [adminUserId],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, $2, 'Pending delete', 'waiting', $3, $3, $4, $4, 1, 1)`,
        ["tt-reg-pending-1", pendingCode, party.id, ext],
      );
    } finally {
      client.release();
    }
    const boot = await request(app)
      .get("/api/tan-tracker/bootstrap")
      .set({ Origin: ORIGIN, Cookie: adminCookie });
    const order = boot.body.orders.find((o: { id: string }) => o.id === pendingCode);
    assert.ok(order?.canAdminDeleteTransfer, "admin bootstrap must expose force delete eligibility");
    const del = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: [pendingCode], deleteAck: "УДАЛИТЬ" });
    assert.equal(del.status, 200, del.text);
    assert.deepEqual(del.body.applied, [pendingCode]);
  });
});
