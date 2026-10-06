import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runOneImportJob } from "../../src/onec-import/worker";
import { sha256Hex } from "../../src/onec-clients/sha256";
import {
  buildClientsFileBytes,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { buildExportManifestBytes } from "../helpers/onec-export-manifest-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";

const workerEnv = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "secret-test-value",
  ONEC_FTP_BASE_PATH: "/LC",
  ONEC_FTP_TIMEOUT_MS: "1000",
};

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

function rosterForManagers(...guids: string[]): Buffer {
  return buildEmployeeRosterBytes(
    guids.map((guid) => buildEmployeeRosterEntry(guid, { name_manager: `Roster ${guid.slice(0, 8)}` })),
  );
}

function bundleInput(clientsBytes: Buffer, rosterBytes: Buffer, withManifest = true) {
  return {
    clientsBytes,
    rosterBytes,
    manifestBytes: withManifest
      ? buildExportManifestBytes({
          clientsSha256: sha256Hex(clientsBytes),
          rosterSha256: sha256Hex(rosterBytes),
          exportFormedAt: "2026-10-06T14:30:00+03:00",
        })
      : undefined,
  };
}

async function runPendingRegularUpdateJob(
  pool: Pool,
  databaseUrl: string,
  bundle: ReturnType<typeof bundleInput>,
) {
  return runOneImportJob(pool, { ...workerEnv, DATABASE_URL: databaseUrl }, async () => ({
    ok: false,
    code: "FTP_ERROR" as const,
    message: "unused",
  }), {
    regularUpdateExecution: {
      clientsBytes: bundle.clientsBytes,
      employeeRosterBytes: bundle.rosterBytes,
      manifestBytes: bundle.manifestBytes,
    },
  });
}

describe("admin clients onec update", { concurrency: false }, () => {
  let databaseUrl = "";
  let pool!: Pool;
  let adminCookie = "";
  let managerCookie = "";
  let adminUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    await pool.query("TRUNCATE onec_import_jobs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_client_import_runs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_clients RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_wholesale_employee_roster RESTART IDENTITY CASCADE");

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-onec-update@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    adminUserId = admin.id;
    adminCookie = await login("admin-onec-update@example.com");

    const manager = await createTestUser({
      databaseUrl,
      email: "manager-onec-update@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: admin.id,
    });
    managerCookie = await login("manager-onec-update@example.com");
  });

  after(async () => {
    await pool?.end();
    await closePool();
  });

  it("admin can start update, worker completes, and status restores after reload", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Updated From 1C" }),
      sampleClientTwo(),
    ]);
    const bundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);
    assert.ok(started.body.jobId);

    assert.equal(await runPendingRegularUpdateJob(pool, databaseUrl, bundle), "success");

    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(status.status, 200);
    assert.equal(status.body.job.phase, "completed");
    assert.match(status.body.job.message, /applied successfully|успеш/i);
    assert.equal(status.body.job.sourceExportAtLabel?.length > 0, true);
    assert.equal(status.body.job.lastSuccessfulUpdateAtLabel?.length > 0, true);
    assert.equal(status.body.canStart, true);

    const reloaded = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(reloaded.body.job.id, status.body.job.id);
    assert.equal(reloaded.body.job.phase, "completed");

    const clientRow = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid",
      [sampleClient().guid_client],
    );
    assert.equal(clientRow.rows[0]?.name_client, "Updated From 1C");

    const jobRow = await pool.query<{ requested_by_user_id: string; result: { status: string } }>(
      "SELECT requested_by_user_id::text, result FROM onec_import_jobs LIMIT 1",
    );
    assert.equal(jobRow.rows[0]?.requested_by_user_id, adminUserId);
    assert.equal(jobRow.rows[0]?.result.status, "SUCCESS");
    assert.equal(JSON.stringify(jobRow.rows[0]?.result).includes("secret-test-value"), false);
  });

  it("rejects start for manager, director role, and admin preview", async () => {
    const app = await loadApp();

    const managerAttempt = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(managerCookie))
      .send({});
    assert.equal(managerAttempt.status, 403);

    const director = await createTestUser({
      databaseUrl,
      email: "director-onec-update@example.com",
      password: TEST_PASSWORD,
      fullName: "Director",
      role: "director",
    });
    const directorCookie = await login("director-onec-update@example.com");
    const directorAttempt = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(directorCookie))
      .send({});
    assert.equal(directorAttempt.status, 403);
    assert.equal(director.id.length > 0, true);

    const previewStart = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ targetUserId: (await pool.query<{ id: string }>("SELECT id::text FROM users WHERE email = $1", ["manager-onec-update@example.com"])).rows[0]!.id });
    assert.equal(previewStart.status, 200);

    const previewAttempt = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(previewAttempt.status, 403);
  });

  it("reports manifest unavailable without export_bundle_manifest", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const bundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A), false);

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);

    assert.equal(await runPendingRegularUpdateJob(pool, databaseUrl, bundle), "failed");

    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(status.body.job.phase, "rejected");
    assert.match(status.body.job.message, /1С ещё не передала подтверждение готовности комплекта/);
    assert.equal(status.body.job.dataPreserved, true);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM onec_clients")).rows[0].count, 0);
  });

  it("blocks duplicate start while job is pending or running", async () => {
    const app = await loadApp();
    const first = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(first.status, 202);

    const second = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(second.status, 409);

    await pool.query(`UPDATE onec_import_jobs SET status = 'running', started_at = NOW()`);
    const third = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(third.status, 409);
  });

  it("returns no_changes when bundle fingerprint matches last successful apply", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const bundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));

    const firstStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(firstStart.status, 202);
    assert.equal(await runPendingRegularUpdateJob(pool, databaseUrl, bundle), "success");

    await pool.query(`UPDATE onec_import_jobs SET status = 'success', finished_at = NOW()`);

    const secondStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(secondStart.status, 202);
    assert.equal(await runPendingRegularUpdateJob(pool, databaseUrl, bundle), "success");

    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(status.body.job.phase, "no_changes");
  });

  it("preserves previous clients when roster shrink is rejected", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ guid_manager: MANAGER_A }),
      sampleClientTwo({ guid_manager: MANAGER_B }),
    ]);
    const fullBundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));
    const shrinkBundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A));

    const seedStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(seedStart.status, 202);
    assert.equal(await runPendingRegularUpdateJob(pool, databaseUrl, fullBundle), "success");
    await pool.query(`UPDATE onec_import_jobs SET status = 'success', finished_at = NOW()`);

    const beforeCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster",
    );

    const shrinkStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(shrinkStart.status, 202);
    assert.equal(await runPendingRegularUpdateJob(pool, databaseUrl, shrinkBundle), "failed");

    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(status.body.job.phase, "rejected");
    assert.equal(status.body.job.dataPreserved, true);
    assert.match(status.body.job.message, /Прежние данные/);

    const afterCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster",
    );
    assert.equal(afterCount.rows[0]?.count, beforeCount.rows[0]?.count);
  });
});
