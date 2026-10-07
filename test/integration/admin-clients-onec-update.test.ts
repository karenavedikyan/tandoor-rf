import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Express } from "express";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { setImportJobWorkerTestHooks } from "../../src/onec-import/worker-scheduler";
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
          exportFormedAt: "2026-10-06T14:30:00",
        })
      : undefined,
  };
}

function configureWorkerBundle(bundle: ReturnType<typeof bundleInput>, applyTestHooks?: Record<string, unknown>) {
  setImportJobWorkerTestHooks({
    regularUpdateExecution: {
      env: workerEnv,
      clientsBytes: bundle.clientsBytes,
      employeeRosterBytes: bundle.rosterBytes,
      manifestBytes: bundle.manifestBytes,
      applyTestHooks,
    },
  });
}

async function waitForAdminOnecUpdateSettled(
  app: Express,
  adminCookie: string,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(status.status, 200);
    const phase = status.body.job?.phase;
    if (phase && phase !== "pending" && phase !== "running") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("admin onec update did not settle in time");
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
    Object.assign(process.env, workerEnv, { DATABASE_URL: databaseUrl });
    setImportJobWorkerTestHooks(undefined);
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
    setImportJobWorkerTestHooks(undefined);
    await pool?.end();
    await closePool();
  });

  it("admin POST runs queued worker to completion and status restores after reload", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Updated From 1C" }),
      sampleClientTwo(),
    ]);
    const bundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));
    configureWorkerBundle(bundle);

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);
    assert.ok(started.body.jobId);

    const status = await waitForAdminOnecUpdateSettled(app, adminCookie);
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

  it("allows only one active job across parallel admin POSTs", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B)));

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/admin/clients/onec-update")
          .set(authHeaders(adminCookie))
          .send({}),
      ),
    );

    const accepted = responses.filter((response) => response.status === 202);
    const conflicts = responses.filter((response) => response.status === 409);
    assert.equal(accepted.length, 1);
    assert.equal(conflicts.length, 4);
    const jobId = accepted[0]!.body.jobId as string;
    assert.ok(jobId);
    for (const conflict of conflicts) {
      assert.equal(conflict.body.jobId, jobId);
    }

    const activeCount = await pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM onec_import_jobs
        WHERE kind = 'regular_update_bundle'
          AND status IN ('pending', 'running')
      `,
    );
    assert.equal(activeCount.rows[0]?.count, 1);
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
      .send({
        targetUserId: (
          await pool.query<{ id: string }>("SELECT id::text FROM users WHERE email = $1", [
            "manager-onec-update@example.com",
          ])
        ).rows[0]!.id,
      });
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
    configureWorkerBundle(bundle);

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);

    const status = await waitForAdminOnecUpdateSettled(app, adminCookie);
    assert.equal(status.body.job.phase, "rejected");
    assert.match(status.body.job.message, /1С ещё не передала подтверждение готовности комплекта/);
    assert.equal(status.body.job.dataPreserved, true);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM onec_clients")).rows[0].count, 0);
  });

  it("preserves manifest validation reason for invalid export_formed_at", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = rosterForManagers(MANAGER_A);
    const manifestBytes = buildExportManifestBytes({
      clientsSha256: sha256Hex(clientsBytes),
      rosterSha256: sha256Hex(rosterBytes),
      exportFormedAt: "31.02.2026",
    });
    configureWorkerBundle({ clientsBytes, rosterBytes, manifestBytes });

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);

    const status = await waitForAdminOnecUpdateSettled(app, adminCookie);
    assert.equal(status.body.job.phase, "rejected");
    assert.equal(status.body.job.errorCode, "MANIFEST_INVALID_SCHEMA");
    assert.match(status.body.job.message, /export_formed_at|calendar date/i);
    assert.doesNotMatch(status.body.job.message, /1С ещё не передала подтверждение готовности комплекта/);
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
    assert.equal(second.body.jobId, first.body.jobId);

    await pool.query(`UPDATE onec_import_jobs SET status = 'running', started_at = NOW()`);
    const third = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(third.status, 409);
  });

  it("finalizes expired pending jobs and allows restart", async () => {
    const app = await loadApp();
    await pool.query(
      `
        INSERT INTO onec_import_jobs (
          kind, mode, status, requested_at, expires_at, requested_by_user_id
        )
        VALUES (
          'regular_update_bundle',
          'apply',
          'pending',
          NOW() - INTERVAL '3 hours',
          NOW() - INTERVAL '1 hour',
          $1::uuid
        )
      `,
      [adminUserId],
    );

    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(status.status, 200);
    assert.equal(status.body.job.phase, "error");
    assert.equal(status.body.job.errorCode, "JOB_EXPIRED");
    assert.equal(status.body.canStart, true);

    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A)));
    const restart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(restart.status, 202);
  });

  it("returns no_changes when bundle fingerprint matches last successful apply", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const bundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));
    configureWorkerBundle(bundle);

    const firstStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(firstStart.status, 202);
    await waitForAdminOnecUpdateSettled(app, adminCookie);

    const secondStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(secondStart.status, 202);
    const status = await waitForAdminOnecUpdateSettled(app, adminCookie);
    assert.equal(status.body.job.phase, "no_changes");
    assert.equal(status.body.canStart, true);
  });

  it("preserves previous clients when roster shrink is rejected", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ guid_manager: MANAGER_A }),
      sampleClientTwo({ guid_manager: MANAGER_B }),
    ]);
    const fullBundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));
    const shrinkBundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A));

    configureWorkerBundle(fullBundle);
    const seedStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(seedStart.status, 202);
    await waitForAdminOnecUpdateSettled(app, adminCookie);

    const beforeCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster",
    );

    configureWorkerBundle(shrinkBundle);
    const shrinkStart = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(shrinkStart.status, 202);
    const status = await waitForAdminOnecUpdateSettled(app, adminCookie);
    assert.equal(status.body.job.phase, "rejected");
    assert.equal(status.body.job.dataPreserved, true);
    assert.match(status.body.job.message, /Прежние данные/);

    const afterCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster",
    );
    assert.equal(afterCount.rows[0]?.count, beforeCount.rows[0]?.count);
  });

  it("blocks retry while running worker is paused past expiry and completes original job", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Recovered Apply" }),
      sampleClientTwo(),
    ]);
    let releaseImportLock!: () => void;
    const pausedAtLock = new Promise<void>((resolve) => {
      releaseImportLock = resolve;
    });
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B)), {
      beforeImportLock: async () => {
        await pausedAtLock;
      },
    });

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);
    const jobId = started.body.jobId as string;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await pool.query<{ status: string }>(
        "SELECT status FROM onec_import_jobs WHERE id = $1::uuid",
        [jobId],
      );
      if (row.rows[0]?.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await pool.query(
      `
        UPDATE onec_import_jobs
        SET
          requested_at = NOW() - INTERVAL '3 hours',
          expires_at = NOW() - INTERVAL '1 hour'
        WHERE id = $1::uuid
      `,
      [jobId],
    );

    const statusWhilePaused = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(statusWhilePaused.body.job.phase, "running");
    assert.equal(statusWhilePaused.body.canStart, false);

    const retry = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(retry.status, 409);

    releaseImportLock();
    const settled = await waitForAdminOnecUpdateSettled(app, adminCookie);
    assert.equal(settled.body.job.phase, "completed");
    assert.equal(settled.body.job.id, jobId);

    const jobCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE kind = 'regular_update_bundle'`,
    );
    assert.equal(jobCount.rows[0]?.count, "1");

    const clientRow = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid",
      [sampleClient().guid_client],
    );
    assert.equal(clientRow.rows[0]?.name_client, "Recovered Apply");
  });

  it("reconciles running job from successful import run after commit", async () => {
    const app = await loadApp();
    const runInsert = await pool.query<{ id: string }>(
      `
        INSERT INTO onec_client_import_runs (status, mode, trigger_source, finished_at)
        VALUES ('success', 'apply', 'regular_update', NOW())
        RETURNING id::text
      `,
    );
    const importRunId = runInsert.rows[0]!.id;
    const jobInsert = await pool.query<{ id: string }>(
      `
        INSERT INTO onec_import_jobs (
          kind,
          mode,
          status,
          requested_at,
          started_at,
          expires_at,
          requested_by_user_id,
          import_run_id
        )
        VALUES (
          'regular_update_bundle',
          'apply',
          'running',
          NOW() - INTERVAL '3 hours',
          NOW() - INTERVAL '2 hours',
          NOW() - INTERVAL '1 hour',
          $1::uuid,
          $2::uuid
        )
        RETURNING id::text
      `,
      [adminUserId, importRunId],
    );
    const jobId = jobInsert.rows[0]!.id;

    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set(authHeaders(adminCookie));
    assert.equal(status.body.job.id, jobId);
    assert.equal(status.body.job.phase, "completed");

    const jobRow = await pool.query<{ status: string }>(
      "SELECT status FROM onec_import_jobs WHERE id = $1::uuid",
      [jobId],
    );
    assert.equal(jobRow.rows[0]?.status, "success");
  });

  it("POST kick completes regular_update_bundle but leaves legacy clients_snapshot pending", async () => {
    const app = await loadApp();
    await pool.query(`
      INSERT INTO onec_import_jobs (kind, mode, requested_at, expires_at)
      VALUES ('clients_snapshot', 'dry_run', NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '1 hour')
    `);

    const clientsBytes = buildClientsFileBytes([sampleClient({ name_client: "Admin Regular Only" })]);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A)));

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);

    await waitForAdminOnecUpdateSettled(app, adminCookie);

    const jobs = await pool.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM onec_import_jobs ORDER BY kind, requested_at, id`,
    );
    const legacy = jobs.rows.find((row) => row.kind === "clients_snapshot");
    const regular = jobs.rows.find((row) => row.kind === "regular_update_bundle");
    assert.equal(legacy?.status, "pending");
    assert.equal(regular?.status, "success");

    const clientRow = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid",
      [sampleClient().guid_client],
    );
    assert.equal(clientRow.rows[0]?.name_client, "Admin Regular Only");
  });

  it("returns read-only config check without secrets", async () => {
    const app = await loadApp();
    const res = await request(app)
      .get("/api/admin/clients/onec-update/config-check")
      .set(authHeaders(adminCookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.checks));
    assert.equal(res.body.canProbe, true);
    assert.doesNotMatch(JSON.stringify(res.body), /secret-test-value/);
  });

  it("returns config check failure for untrusted base path", async () => {
    Object.assign(process.env, workerEnv, {
      DATABASE_URL: databaseUrl,
      ONEC_FTP_BASE_PATH: "/other",
    });
    const app = await loadApp();
    const res = await request(app)
      .get("/api/admin/clients/onec-update/config-check")
      .set(authHeaders(adminCookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.canProbe, false);
    assert.equal(
      res.body.checks.find((check: { id: string }) => check.id === "trusted_base_path")?.passed,
      false,
    );
  });

  it("runs explicit read-only probe without apply", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B)));
    const beforeCount = (
      await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM onec_clients")
    ).rows[0]?.count;

    const res = await request(app)
      .post("/api/admin/clients/onec-update/probe")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.probe.status, "SUCCESS");
    assert.doesNotMatch(JSON.stringify(res.body), /secret-test-value/);

    const afterCount = (
      await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM onec_clients")
    ).rows[0]?.count;
    assert.equal(afterCount, beforeCount);
    assert.equal(
      (await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM onec_import_jobs")).rows[0]
        ?.count,
      "0",
    );
  });

  it("reports commit uncertainty without promising preserved data", async () => {
    const app = await loadApp();
    const clientsBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const bundle = bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));
    configureWorkerBundle(bundle, { failCommit: true });

    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(started.status, 202);

    const status = await waitForAdminOnecUpdateSettled(app, adminCookie);
    assert.equal(status.body.job.phase, "uncertain");
    assert.equal(status.body.job.errorCode, "COMMIT_UNCERTAIN");
    assert.match(status.body.job.message, /уточняется/i);
    assert.equal(status.body.job.dataPreserved, false);
    assert.equal(status.body.canStart, false);

    const retry = await request(app)
      .post("/api/admin/clients/onec-update")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(retry.status, 409);
  });
});
