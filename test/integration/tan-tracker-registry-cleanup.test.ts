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

  it("delete rejected after legacy complete", async () => {
    const del = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: [transferPublicCode], deleteAck: "УДАЛИТЬ" });
    assert.equal(del.status, 200);
    assert.equal(del.body.applied.length, 0);
    assert.ok(del.body.skipped?.length >= 1);
  });
});
