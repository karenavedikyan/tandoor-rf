import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
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

describe("tan-tracker admin force delete (isolated PG)", { concurrency: false }, () => {
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  let pool: Pool;
  let adminCookie = "";
  let directorCookie = "";
  let managerCookie = "";
  let adminUserId = "";
  let managerUserId = "";
  let managerPartyId = "";
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    await createTestUser({
      databaseUrl,
      email: "admin-force-del@test.local",
      password: PASSWORD,
      fullName: "Force Delete Admin",
      role: "admin",
    });
    const director = await createTestUser({
      databaseUrl,
      email: "director-force-del@test.local",
      password: PASSWORD,
      fullName: "Force Delete Director",
      role: "director",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-force-del@test.local",
      password: PASSWORD,
      fullName: "Force Delete Manager",
      role: "manager",
    });
    managerUserId = manager.id;
    const { createApp } = await import("../../src/server");
    app = createApp();
    pool = new Pool({ connectionString: databaseUrl });

    adminUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, ["admin-force-del@test.local"])
    ).rows[0]!.id;
    const client = await pool.connect();
    try {
      managerPartyId = (await ensurePartyForUserOnWrite(client, managerUserId, "Force Delete Manager", null)).id;
      await ensurePartyForUserOnWrite(client, adminUserId, "Force Delete Admin", null);
      await ensurePartyForUserOnWrite(client, director.id, "Force Delete Director", null);
    } finally {
      client.release();
    }

    const loginAdmin = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "admin-force-del@test.local", password: PASSWORD });
    adminCookie = loginAdmin.headers["set-cookie"]![0]!.split(";")[0]!;
    const loginDirector = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "director-force-del@test.local", password: PASSWORD });
    directorCookie = loginDirector.headers["set-cookie"]![0]!.split(";")[0]!;
    const loginManager = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "manager-force-del@test.local", password: PASSWORD });
    managerCookie = loginManager.headers["set-cookie"]![0]!.split(";")[0]!;
  });

  after(async () => {
    await pool.end();
    await closePool();
  });

  async function insertTransfer(opts: {
    id: string;
    code: string;
    status: string;
    creatorPartyId: string;
    holderPartyId: string;
    firstCustodyAt?: "now" | null;
    completedAt?: "now";
    generalArchivedAt?: "now";
    withMessengerSession?: boolean;
    withLegacyAudit?: boolean;
  }) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          handoff_version, row_version, first_custody_at, completed_at, general_archived_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $8, $9)`,
        [
          opts.id,
          opts.code,
          "Force delete item",
          opts.status,
          opts.creatorPartyId,
          opts.holderPartyId,
          opts.firstCustodyAt === "now" ? new Date() : opts.firstCustodyAt === null ? null : null,
          opts.completedAt === "now" ? new Date() : null,
          opts.generalArchivedAt === "now" ? new Date() : null,
        ],
      );
      if (opts.withMessengerSession) {
        await client.query(
          `INSERT INTO tt_external_messenger_sessions (transfer_id, pending_party_id, handoff_version, token_hash, expires_at)
           VALUES ($1, $2, 1, decode($3, 'hex'), NOW() + interval '1 day')`,
          [opts.id, opts.holderPartyId, `${opts.id.replace(/-/g, "").slice(0, 16)}00000000`],
        );
      }
      if (opts.withLegacyAudit) {
        await client.query(
          `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
           VALUES ($1, $2::uuid, $3, 'code_verify_ok', '{}'::jsonb)`,
          [opts.id, adminUserId, opts.creatorPartyId],
        );
      }
    } finally {
      client.release();
    }
  }

  it("admin deletes received, completed, and archived tracks without orphan sessions", async () => {
    const cases = [
      { id: "tt-adm-del-rcvd", code: "ADMDELRCV", status: "active", firstCustodyAt: "now" as const },
      { id: "tt-adm-del-done", code: "ADMDELDONE", status: "completed", completedAt: "now" as const },
      {
        id: "tt-adm-del-arch",
        code: "ADMDELARCH",
        status: "delivered",
        generalArchivedAt: "now" as const,
        withMessengerSession: true,
      },
    ];
    for (const c of cases) {
      await insertTransfer({
        ...c,
        creatorPartyId: managerPartyId,
        holderPartyId: managerPartyId,
      });
    }
    for (const code of cases.map((c) => c.code)) {
      const del = await request(app)
        .post("/api/tan-tracker/registry/cleanup")
        .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
        .send({ action: "delete", transferIds: [code], deleteAck: "УДАЛИТЬ", adminForceDelete: true });
      assert.equal(del.status, 200, del.text);
      assert.deepEqual(del.body.applied, [code]);
      const row = await pool.query(`SELECT 1 FROM tt_transfers WHERE public_code = $1`, [code]);
      assert.equal(row.rowCount, 0);
      const sessions = await pool.query(`SELECT 1 FROM tt_external_messenger_sessions WHERE transfer_id = $1`, [
        cases.find((c) => c.code === code)!.id,
      ]);
      assert.equal(sessions.rowCount, 0);
      const audit = await pool.query(
        `SELECT actor_user_id::text FROM tt_transfer_delete_audit WHERE transfer_public_code = $1`,
        [code],
      );
      assert.equal(audit.rowCount, 1);
      assert.equal(audit.rows[0]!.actor_user_id, adminUserId);
    }
  });

  it("admin deletes legacy-audit track with null first_custody_at", async () => {
    await insertTransfer({
      id: "tt-adm-del-leg",
      code: "ADMDELLEG",
      status: "active",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      firstCustodyAt: null,
      withLegacyAudit: true,
    });
    const del = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["ADMDELLEG"], deleteAck: "УДАЛИТЬ" });
    assert.equal(del.status, 200);
    assert.deepEqual(del.body.applied, ["ADMDELLEG"]);
  });

  it("non-admin creator denied after receipt; director not admin; pre-receipt creator still allowed", async () => {
    await insertTransfer({
      id: "tt-mgr-del-rcvd",
      code: "MGRDELRCV",
      status: "active",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      firstCustodyAt: "now",
    });
    await insertTransfer({
      id: "tt-mgr-del-pend",
      code: "MGRDELPEND",
      status: "waiting",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      firstCustodyAt: null,
    });
    await insertTransfer({
      id: "tt-dir-del-done",
      code: "DIRDELDONE",
      status: "completed",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      completedAt: "now",
    });

    const mgrDenied = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: managerCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["MGRDELRCV"], deleteAck: "УДАЛИТЬ" });
    assert.equal(mgrDenied.status, 200);
    assert.equal(mgrDenied.body.applied.length, 0);

    const dirDenied = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: directorCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["DIRDELDONE"], deleteAck: "УДАЛИТЬ" });
    assert.equal(dirDenied.status, 200);
    assert.equal(dirDenied.body.applied.length, 0);

    const mgrOk = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: managerCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["MGRDELPEND"], deleteAck: "УДАЛИТЬ" });
    assert.equal(mgrOk.status, 200);
    assert.deepEqual(mgrOk.body.applied, ["MGRDELPEND"]);
  });
});
