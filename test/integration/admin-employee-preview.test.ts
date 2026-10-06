import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const M1 = "11111111-1111-4111-8111-111111111111";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set(authHeaders())
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function installPreviewAuditRejectTrigger(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(`
    CREATE OR REPLACE FUNCTION reject_preview_audit_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.entity_type = 'user_preview' THEN
        RAISE EXCEPTION 'preview audit blocked for test';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS reject_preview_audit_insert ON access_audit_log;
    CREATE TRIGGER reject_preview_audit_insert
      BEFORE INSERT ON access_audit_log
      FOR EACH ROW
      EXECUTE FUNCTION reject_preview_audit_insert();
  `);
  await pool.end();
}

async function removePreviewAuditRejectTrigger(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(`
    DROP TRIGGER IF EXISTS reject_preview_audit_insert ON access_audit_log;
    DROP FUNCTION IF EXISTS reject_preview_audit_insert();
  `);
  await pool.end();
}

describe("admin employee preview", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    const director = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director User",
      role: "director",
    });

    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: director.id,
      employeeId: ROP_A,
      confirmedByUserId: admin.id,
    });

    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client A", guid_manager: M1, name_manager: "Manager A" },
      {
        guid_client: C2,
        name_client: "Client B",
        guid_manager: "22222222-2222-4222-8222-222222222222",
        name_manager: "Other Manager",
      },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, C1, {
      formatVersion: "extended_v1",
      sourceSha256: "a".repeat(64),
      importedAt: new Date().toISOString(),
      isHolding: false,
      holdingLink: { state: "none", pendingGuid: null },
      clientManagerRosterState: "in_wholesale_roster",
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: ROP_A, name: "ROP", state: "directory_unverified" },
      currentRetailOutlets: [],
      retailOutletHistory: [],
      blocks: { clientExtendedReady: true, outletNormalizedReady: true },
    });
  });

  after(async () => {
    await removePreviewAuditRejectTrigger(databaseUrl).catch(() => undefined);
    await closePool();
  });

  it("rejects preview start for non-admin", async () => {
    const managerCookie = await login("manager-a@example.com");
    const app = await loadApp();
    const res = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(managerCookie))
      .send({ userId: "00000000-0000-4000-8000-000000000001" });
    assert.equal(res.status, 403);
  });

  it("scopes reads to target user and blocks writes in preview", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const managerUser = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager")
        .set(authHeaders(adminCookie))
    ).body.items.find((item: { email: string }) => item.email === "manager-a@example.com");
    assert.ok(managerUser);

    const adminList = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(adminList.status, 200);
    assert.ok(adminList.body.total >= 2);

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: managerUser.id });
    assert.equal(start.status, 200);
    assert.equal(start.body.preview.active, true);

    const previewList = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(previewList.status, 200);
    assert.equal(previewList.body.total, 1);
    assert.equal(previewList.body.items[0].guid, C1);

    const write = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", comment: "blocked" });
    assert.equal(write.status, 403);

    const adminOverview = await request(app)
      .get("/api/admin/access/overview")
      .set(authHeaders(adminCookie));
    assert.equal(adminOverview.status, 403);

    const profilePatch = await request(app)
      .patch("/api/profile/self")
      .set(authHeaders(adminCookie))
      .send({ fullName: "Admin Tampered" });
    assert.equal(profilePatch.status, 403);

    const me = await request(app).get("/api/auth/me").set(authHeaders(adminCookie));
    assert.equal(me.body.user.role, "admin");
    assert.equal(me.body.preview.active, true);
    assert.equal(me.body.preview.targetUser.email, "manager-a@example.com");

    const stop = await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(stop.status, 200);

    const afterStop = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(afterStop.status, 200);
    assert.ok(afterStop.body.total >= 2);
  });

  it("blocks admin and profile routes during preview regardless of URL casing", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const manager = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-a")
        .set(authHeaders(adminCookie))
    ).body.items[0];
    assert.ok(manager);

    await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: manager.id });

    const blockedPaths = [
      "/api/admin/access/overview",
      "/api/ADMIN/access/overview",
      "/API/ADMIN/access/overview",
      "/api/Admin/Access/Overview",
      "/api/profile/self",
      "/api/PROFILE/self",
      "/API/PROFILE/self",
    ];

    for (const path of blockedPaths) {
      const getRes = await request(app).get(path).set(authHeaders(adminCookie));
      assert.equal(getRes.status, 403, `GET ${path} must stay forbidden in preview`);
      assert.equal(getRes.body.users, undefined);
      assert.equal(getRes.body.links, undefined);
      assert.equal(getRes.body.email, undefined);

      const headRes = await request(app).head(path).set(authHeaders(adminCookie));
      assert.equal(headRes.status, 403, `HEAD ${path} must stay forbidden in preview`);
    }

    const allowlisted = await request(app)
      .get("/api/ADMIN/access/preview/candidates?q=manager-a")
      .set(authHeaders(adminCookie));
    assert.equal(allowlisted.status, 200);
    assert.ok(Array.isArray(allowlisted.body.items));

    const previewState = await request(app)
      .get("/api/Admin/Access/Preview")
      .set(authHeaders(adminCookie));
    assert.equal(previewState.status, 200);
    assert.equal(previewState.body.preview.active, true);

    await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});
  });

  it("keeps preview across reload and isolates parallel admin sessions", async () => {
    const adminCookieA = await login("admin@example.com");
    const adminCookieB = await login("admin@example.com");
    const app = await loadApp();

    const director = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=director")
        .set(authHeaders(adminCookieA))
    ).body.items[0];
    assert.ok(director);

    await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookieA))
      .send({ userId: director.id });

    const reloadMe = await request(app).get("/api/auth/me").set(authHeaders(adminCookieA));
    assert.equal(reloadMe.body.preview.active, true);

    const parallelAdminList = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=1")
      .set(authHeaders(adminCookieB));
    assert.equal(parallelAdminList.status, 200);
    assert.ok(parallelAdminList.body.total >= 2);

    const manager = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-a")
        .set(authHeaders(adminCookieA))
    ).body.items[0];

    await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookieA))
      .send({ userId: manager.id });

    const switched = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookieA));
    assert.equal(switched.body.total, 1);
  });

  it("keeps preview active with error when target link is revoked until explicit stop", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const manager = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-a")
        .set(authHeaders(adminCookie))
    ).body.items[0];

    await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: manager.id });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [manager.id],
    );
    await pool.end();

    const firstBlocked = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(firstBlocked.status, 403);

    const secondBlocked = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(secondBlocked.status, 403);

    const me = await request(app).get("/api/auth/me").set(authHeaders(adminCookie));
    assert.equal(me.body.preview.active, true);
    assert.equal(me.body.preview.error?.code, "NO_LINK");

    const previewState = await request(app)
      .get("/api/admin/access/preview")
      .set(authHeaders(adminCookie));
    assert.equal(previewState.body.preview.active, true);
    assert.ok(previewState.body.preview.error);

    const stillAdminScope = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(stillAdminScope.status, 403);

    await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});

    const restored = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(restored.status, 200);
    assert.ok(restored.body.total >= 2);
  });

  it("rolls back preview start when audit insert fails", async () => {
    await installPreviewAuditRejectTrigger(databaseUrl);
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const manager = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-a")
        .set(authHeaders(adminCookie))
    ).body.items[0];

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: manager.id });
    assert.equal(start.status, 503);

    const preview = await request(app)
      .get("/api/admin/access/preview")
      .set(authHeaders(adminCookie));
    assert.equal(preview.body.preview.active, false);

    const adminList = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(adminList.status, 200);
    assert.ok(adminList.body.total >= 2);

    await removePreviewAuditRejectTrigger(databaseUrl);
  });

  it("rolls back preview switch when audit insert fails", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const director = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=director")
        .set(authHeaders(adminCookie))
    ).body.items[0];
    const manager = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-a")
        .set(authHeaders(adminCookie))
    ).body.items[0];

    await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: director.id });

    await installPreviewAuditRejectTrigger(databaseUrl);

    const switchAttempt = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: manager.id });
    assert.equal(switchAttempt.status, 503);

    const preview = await request(app)
      .get("/api/admin/access/preview")
      .set(authHeaders(adminCookie));
    assert.equal(preview.body.preview.active, true);
    assert.equal(preview.body.preview.targetUser.email, "director@example.com");

    await removePreviewAuditRejectTrigger(databaseUrl);
  });

  it("rolls back preview stop when audit insert fails", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const manager = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-a")
        .set(authHeaders(adminCookie))
    ).body.items[0];

    await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: manager.id });

    await installPreviewAuditRejectTrigger(databaseUrl);

    const stopAttempt = await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(stopAttempt.status, 503);

    const preview = await request(app)
      .get("/api/admin/access/preview")
      .set(authHeaders(adminCookie));
    assert.equal(preview.body.preview.active, true);
    assert.equal(preview.body.preview.targetUser.email, "manager-a@example.com");

    await removePreviewAuditRejectTrigger(databaseUrl);
  });
});
