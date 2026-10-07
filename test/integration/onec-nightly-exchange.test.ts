import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Express } from "express";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { setImportJobWorkerTestHooks } from "../../src/onec-import/worker-scheduler";
import {
  stopNightlyExchangeSchedulerForTests,
  tickNightlyExchangeScheduler,
} from "../../src/onec-nightly-exchange/scheduler";
import type { NightlyExchangeConfig } from "../../src/onec-nightly-exchange/config";
import {
  getMoscowWallClock,
  resolveActiveNightlyWindow,
  windowBoundsForStartDate,
} from "../../src/onec-nightly-exchange/msk-time";
import { drainPendingImportJobs } from "../../src/onec-import/worker-scheduler";
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
const SCHEDULE_TIME = "02:30";
const WINDOW_MINUTES = 60;

const workerEnv = {
  ONEC_FTP_ENABLED: "true",
  ONEC_FTP_SECURITY: "plain",
  ONEC_FTP_HOST: "gw.toopatch.ru",
  ONEC_FTP_PORT: "21",
  ONEC_FTP_USER: "test",
  ONEC_FTP_PASSWORD: "secret-test-value",
  ONEC_FTP_BASE_PATH: "/LC",
  ONEC_FTP_TIMEOUT_MS: "1000",
  ONEC_REGULAR_UPDATE_STABILITY_DELAY_MS: "0",
};

function mskInstant(dateKey: string, hour: number, minute: number): Date {
  return new Date(
    `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`,
  );
}

function nightlyConfig(enabled: boolean): NightlyExchangeConfig {
  return {
    enabled,
    scheduleTime: SCHEDULE_TIME,
    timezone: "Europe/Moscow",
    windowMinutes: WINDOW_MINUTES,
  };
}

function syncNightlyScheduleEnv(config: Omit<NightlyExchangeConfig, "enabled">): void {
  Object.assign(process.env, {
    ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
    ONEC_NIGHTLY_EXCHANGE_TIME: config.scheduleTime,
    ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: String(config.windowMinutes),
  });
}

/** Window anchored to real clock so worker/deadline checks stay consistent with PostgreSQL NOW(). */
function activeTestWindow(windowMinutes = 180, offsetMinutes = 90): {
  now: Date;
  config: NightlyExchangeConfig;
} {
  const now = new Date();
  const wall = getMoscowWallClock(now);
  const startMinutes = Math.max(0, wall.minutesSinceMidnight - offsetMinutes);
  const scheduleTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
  const config: NightlyExchangeConfig = {
    enabled: true,
    scheduleTime,
    timezone: "Europe/Moscow",
    windowMinutes,
  };
  syncNightlyScheduleEnv(config);
  return { now, config };
}

function sampleInstantInsideWindow(scheduleTime: string, windowMinutes: number): Date {
  const now = new Date();
  if (resolveActiveNightlyWindow({ now, scheduleTime, windowMinutes })) {
    return now;
  }
  const wall = getMoscowWallClock(now);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startKey = getMoscowWallClock(yesterday).dateKey;
  const bounds = windowBoundsForStartDate(startKey, scheduleTime, windowMinutes);
  return new Date(bounds.startAt.getTime() + 45 * 60 * 1000);
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
          exportBatchId: "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb",
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

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function waitForNightlyJobSettled(pool: Pool, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await pool.query<{ status: string }>(
      `
        SELECT status
        FROM onec_import_jobs
        WHERE kind = 'regular_update_bundle' AND job_source = 'nightly'
        ORDER BY requested_at DESC, id DESC
        LIMIT 1
      `,
    );
    const status = row.rows[0]?.status;
    if (status && status !== "pending" && status !== "running") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("nightly job did not settle in time");
}

describe("onec nightly exchange", { concurrency: false }, () => {
  let databaseUrl = "";
  let pool!: Pool;
  let adminCookie = "";
  const inWindow = mskInstant("2026-10-07", 2, 45);
  const daytime = mskInstant("2026-10-07", 14, 0);

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
  });

  beforeEach(async () => {
    stopNightlyExchangeSchedulerForTests();
    setIntegrationEnv(databaseUrl, ORIGIN);
    Object.assign(process.env, workerEnv, {
      DATABASE_URL: databaseUrl,
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "false",
    });
    setImportJobWorkerTestHooks(undefined);
    await prepareDatabase(databaseUrl);
    await pool.query("TRUNCATE onec_import_jobs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_client_import_runs RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_clients RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE onec_wholesale_employee_roster RESTART IDENTITY CASCADE");
    await pool.query(
      `UPDATE onec_exchange_state SET nightly_exchange_last_window = NULL, apply_blocked = false, apply_blocked_reason = NULL WHERE id = 1`,
    );

    const admin = await createTestUser({
      databaseUrl,
      email: "nightly-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: admin.id,
      employeeId: MANAGER_A,
      confirmedByUserId: admin.id,
    });
    adminCookie = await login("nightly-admin@example.com");
    assert.ok(adminCookie);
  });

  after(async () => {
    stopNightlyExchangeSchedulerForTests();
    setImportJobWorkerTestHooks(undefined);
    await pool?.end();
    await closePool();
  });

  it("does not enqueue when scheduler is disabled", async () => {
    const tick = await tickNightlyExchangeScheduler({
      now: inWindow,
      config: nightlyConfig(false),
    });
    assert.equal(tick.status, "disabled");
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE kind = 'regular_update_bundle'`,
    );
    assert.equal(count.rows[0]?.count, "0");
  });

  it("enqueues one nightly job in window and completes update", async () => {
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Nightly Apply" }),
      sampleClientTwo(),
    ]);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B)));

    const window = activeTestWindow();
    const tick = await tickNightlyExchangeScheduler(window);
    assert.equal(tick.status, "enqueued");

    assert.equal(await waitForNightlyJobSettled(pool), "success");

    const job = (
      await pool.query<{
        job_source: string;
        requested_by_user_id: string | null;
        result: { exportBatchId?: string; status: string };
      }>(`SELECT job_source, requested_by_user_id::text, result FROM onec_import_jobs LIMIT 1`)
    ).rows[0];
    assert.equal(job?.job_source, "nightly");
    assert.equal(job?.requested_by_user_id, null);
    assert.equal(job?.result.status, "SUCCESS");
    assert.equal(job?.result.exportBatchId, "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb");

    const run = (
      await pool.query<{ trigger_source: string }>(
        `SELECT trigger_source FROM onec_client_import_runs WHERE mode = 'apply' LIMIT 1`,
      )
    ).rows[0];
    assert.equal(run?.trigger_source, "regular_update_nightly");

    const clientRow = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid",
      [sampleClient().guid_client],
    );
    assert.equal(clientRow.rows[0]?.name_client, "Nightly Apply");

    const app = await loadApp();
    const status = await request(app)
      .get("/api/admin/clients/onec-update/status")
      .set({ Origin: ORIGIN, Cookie: adminCookie });
    assert.equal(status.body.job.jobSource, "nightly");
    assert.equal(status.body.job.jobSourceLabel, "Ночной обмен");
    assert.equal(status.body.job.exportBatchId, "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb");
  });

  it("completes nightly update without export_bundle_manifest", async () => {
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Nightly Without Manifest" }),
    ]);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A), false));

    const window = activeTestWindow();
    const tick = await tickNightlyExchangeScheduler(window);
    assert.equal(tick.status, "enqueued");
    assert.equal(await waitForNightlyJobSettled(pool), "success");

    const job = (
      await pool.query<{ result: { status: string; releaseConsistencyConfirmed?: boolean; sourceExportAt?: string | null } }>(
        `SELECT result FROM onec_import_jobs WHERE job_source = 'nightly' ORDER BY requested_at DESC LIMIT 1`,
      )
    ).rows[0];
    assert.equal(job?.result.status, "SUCCESS");
    assert.equal(job?.result.releaseConsistencyConfirmed, false);
    assert.equal(job?.result.sourceExportAt, null);

    const clientRow = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid",
      [sampleClient().guid_client],
    );
    assert.equal(clientRow.rows[0]?.name_client, "Nightly Without Manifest");
  });

  it("does not duplicate jobs on repeat tick or parallel instances in same window", async () => {
    configureWorkerBundle(
      bundleInput(
        buildClientsFileBytes([sampleClient()]),
        rosterForManagers(MANAGER_A),
      ),
    );

    const window = activeTestWindow();
    const first = await tickNightlyExchangeScheduler(window);
    assert.equal(first.status, "enqueued");

    const second = await tickNightlyExchangeScheduler(window);
    assert.equal(second.status, "already_claimed");

    const parallel = await Promise.all([
      tickNightlyExchangeScheduler(window),
      tickNightlyExchangeScheduler(window),
    ]);
    assert.ok(parallel.every((result) => result.status === "already_claimed"));

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE job_source = 'nightly'`,
    );
    assert.equal(count.rows[0]?.count, "1");
  });

  it("blocks nightly enqueue when manual update is already active", async () => {
    const adminUser = (
      await pool.query<{ id: string }>("SELECT id::text FROM users WHERE email = $1", [
        "nightly-admin@example.com",
      ])
    ).rows[0]!;
    await pool.query(
      `
        INSERT INTO onec_import_jobs (
          kind, mode, status, expires_at, requested_by_user_id, job_source
        )
        VALUES (
          'regular_update_bundle',
          'apply',
          'pending',
          NOW() + INTERVAL '2 hours',
          $1::uuid,
          'admin_manual'
        )
      `,
      [adminUser.id],
    );

    const tick = await tickNightlyExchangeScheduler(activeTestWindow());
    assert.equal(tick.status, "blocked");
    assert.equal(tick.code, "UPDATE_ALREADY_RUNNING");

    const active = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM onec_import_jobs
        WHERE kind = 'regular_update_bundle'
          AND status IN ('pending', 'running')
      `,
    );
    assert.equal(active.rows[0]?.count, "1");

    const nightlyCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE job_source = 'nightly'`,
    );
    assert.equal(nightlyCount.rows[0]?.count, "0");
  });

  it("rejects roster shrink without partial apply", async () => {
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ guid_manager: MANAGER_A }),
      sampleClientTwo({ guid_manager: MANAGER_B }),
    ]);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B)));
    const seed = await tickNightlyExchangeScheduler(activeTestWindow());
    assert.equal(seed.status, "enqueued");
    assert.equal(await waitForNightlyJobSettled(pool), "success");

    await pool.query(`UPDATE onec_exchange_state SET nightly_exchange_last_window = NULL WHERE id = 1`);
    configureWorkerBundle(bundleInput(clientsBytes, rosterForManagers(MANAGER_A)));
    const shrink = await tickNightlyExchangeScheduler(activeTestWindow());
    assert.equal(shrink.status, "enqueued");
    assert.equal(await waitForNightlyJobSettled(pool), "failed");

    const rosterCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster",
    );
    assert.equal(rosterCount.rows[0]?.count, "2");
  });

  it("blocks new jobs when exchange apply is uncertain", async () => {
    configureWorkerBundle(
      bundleInput(
        buildClientsFileBytes([sampleClient(), sampleClientTwo()]),
        rosterForManagers(MANAGER_A, MANAGER_B),
      ),
      { failCommit: true },
    );
    const uncertain = await tickNightlyExchangeScheduler(activeTestWindow());
    assert.equal(uncertain.status, "enqueued");
    assert.equal(await waitForNightlyJobSettled(pool), "failed");

    await pool.query(`UPDATE onec_exchange_state SET nightly_exchange_last_window = NULL WHERE id = 1`);
    const retry = await tickNightlyExchangeScheduler(activeTestWindow());
    assert.equal(retry.status, "blocked");
    assert.ok(retry.code === "APPLY_BLOCKED" || retry.code === "IMPORT_RUNNING");

    const app = await loadApp();
    const manual = await request(app)
      .post("/api/admin/clients/onec-update")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(manual.status, 409);
  });

  it("does not catch up missed nightly window during daytime restart", async () => {
    const tick = await tickNightlyExchangeScheduler({
      now: daytime,
      config: nightlyConfig(true),
    });
    assert.equal(tick.status, "outside_window");
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_import_jobs`,
    );
    assert.equal(count.rows[0]?.count, "0");
    const claimed = await pool.query<{ nightly_exchange_last_window: string | null }>(
      `SELECT nightly_exchange_last_window FROM onec_exchange_state WHERE id = 1`,
    );
    assert.equal(claimed.rows[0]?.nightly_exchange_last_window, null);
  });

  it("finalizes expired nightly pending on drain without FTP or data changes", async () => {
    const bounds = windowBoundsForStartDate("2026-10-06", SCHEDULE_TIME, WINDOW_MINUTES);
    await pool.query(
      `
        INSERT INTO onec_import_jobs (
          kind,
          mode,
          status,
          expires_at,
          job_source,
          nightly_window_key,
          nightly_window_deadline_at
        )
        VALUES (
          'regular_update_bundle',
          'apply',
          'pending',
          NOW() + INTERVAL '1 hour',
          'nightly',
          $1,
          NOW() - INTERVAL '5 minutes'
        )
      `,
      [bounds.windowKey],
    );

    configureWorkerBundle(
      bundleInput(
        buildClientsFileBytes([sampleClient({ name_client: "Should Not Apply" })]),
        rosterForManagers(MANAGER_A),
      ),
    );

    await drainPendingImportJobs(1);

    const job = await pool.query<{ status: string; error_code: string | null }>(
      `SELECT status, error_code FROM onec_import_jobs LIMIT 1`,
    );
    assert.equal(job.rows[0]?.status, "failed");
    assert.equal(job.rows[0]?.error_code, "NIGHTLY_WINDOW_MISSED");
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM onec_clients")).rows[0].count, 0);
  });

  it("blocks apply when nightly window closes while worker waits on import lock", async () => {
    let releaseImportLock!: () => void;
    const pausedAtLock = new Promise<void>((resolve) => {
      releaseImportLock = resolve;
    });
    configureWorkerBundle(
      bundleInput(
        buildClientsFileBytes([sampleClient({ name_client: "Window Closed" })]),
        rosterForManagers(MANAGER_A),
      ),
      {
        beforeImportLock: async () => {
          await pausedAtLock;
        },
      },
    );

    const tick = await tickNightlyExchangeScheduler(activeTestWindow());
    assert.equal(tick.status, "enqueued");

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await pool.query<{ status: string }>(
        "SELECT status FROM onec_import_jobs WHERE job_source = 'nightly' LIMIT 1",
      );
      if (row.rows[0]?.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await pool.query(
      `UPDATE onec_import_jobs SET nightly_window_deadline_at = NOW() - INTERVAL '1 minute' WHERE job_source = 'nightly'`,
    );
    releaseImportLock();
    assert.equal(await waitForNightlyJobSettled(pool), "failed");

    const job = await pool.query<{ error_code: string | null }>(
      `SELECT error_code FROM onec_import_jobs WHERE job_source = 'nightly' LIMIT 1`,
    );
    assert.equal(job.rows[0]?.error_code, "NIGHTLY_WINDOW_MISSED");
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM onec_clients")).rows[0].count, 0);
  });

  it("finalizes pending nightly jobs when schedule is disabled on drain", async () => {
    await pool.query(
      `
        INSERT INTO onec_import_jobs (
          kind,
          mode,
          status,
          requested_at,
          expires_at,
          job_source,
          nightly_window_key,
          nightly_window_deadline_at
        )
        VALUES (
          'regular_update_bundle',
          'apply',
          'pending',
          NOW(),
          NOW() + INTERVAL '30 minutes',
          'nightly',
          '2026-10-07',
          NOW() + INTERVAL '30 minutes'
        )
      `,
    );
    process.env.ONEC_NIGHTLY_EXCHANGE_ENABLED = "false";
    await drainPendingImportJobs(1);
    const job = await pool.query<{ status: string; error_code: string | null }>(
      `SELECT status, error_code FROM onec_import_jobs LIMIT 1`,
    );
    assert.equal(job.rows[0]?.status, "failed");
    assert.equal(job.rows[0]?.error_code, "NIGHTLY_SCHEDULE_DISABLED");
  });

  it("does not break manual update when nightly schedule config is invalid", async () => {
    delete process.env.ONEC_NIGHTLY_EXCHANGE_ENABLED;
    delete process.env.ONEC_NIGHTLY_EXCHANGE_TIME;
    delete process.env.ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES;
    Object.assign(process.env, {
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
      ONEC_NIGHTLY_EXCHANGE_TIME: "25:99",
      ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: "60",
    });
    configureWorkerBundle(
      bundleInput(
        buildClientsFileBytes([sampleClient({ name_client: "Manual Despite Bad Nightly Config" })]),
        rosterForManagers(MANAGER_A),
      ),
    );
    const app = await loadApp();
    const started = await request(app)
      .post("/api/admin/clients/onec-update")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(started.status, 202);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const row = await pool.query<{ status: string }>(
        `SELECT status FROM onec_import_jobs WHERE job_source = 'admin_manual' LIMIT 1`,
      );
      if (row.rows[0]?.status === "success") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const clientRow = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1::uuid",
      [sampleClient().guid_client],
    );
    assert.equal(clientRow.rows[0]?.name_client, "Manual Despite Bad Nightly Config");
  });

  it("stores start-date window key for midnight-spanning schedule", async () => {
    const midnightWindow = {
      enabled: true,
      scheduleTime: "23:30",
      timezone: "Europe/Moscow" as const,
      windowMinutes: 120,
    };
    syncNightlyScheduleEnv(midnightWindow);
    const now = sampleInstantInsideWindow("23:30", 120);
    configureWorkerBundle(
      bundleInput(
        buildClientsFileBytes([sampleClient({ name_client: "Midnight Window" })]),
        rosterForManagers(MANAGER_A),
      ),
    );
    const tick = await tickNightlyExchangeScheduler({ now, config: midnightWindow });
    assert.equal(tick.status, "enqueued");
    assert.equal(tick.status, "enqueued");
    const active = resolveActiveNightlyWindow({
      now,
      scheduleTime: "23:30",
      windowMinutes: 120,
    });
    assert.ok(active);
    if (tick.status === "enqueued") {
      assert.equal(tick.windowKey, active.windowKey);
    }
    const row = await pool.query<{ nightly_window_key: string }>(
      `SELECT nightly_window_key FROM onec_import_jobs WHERE job_source = 'nightly' LIMIT 1`,
    );
    assert.equal(row.rows[0]?.nightly_window_key, active.windowKey);
  });

  it("leaves legacy clients_snapshot pending when nightly job runs", async () => {
    await pool.query(`
      INSERT INTO onec_import_jobs (kind, mode, requested_at, expires_at)
      VALUES ('clients_snapshot', 'dry_run', NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '1 hour')
    `);
    configureWorkerBundle(
      bundleInput(
        buildClientsFileBytes([sampleClient({ name_client: "Nightly With Legacy" })]),
        rosterForManagers(MANAGER_A),
      ),
    );
    const tick = await tickNightlyExchangeScheduler(activeTestWindow());
    assert.equal(tick.status, "enqueued");
    assert.equal(await waitForNightlyJobSettled(pool), "success");

    const jobs = await pool.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM onec_import_jobs ORDER BY kind`,
    );
    const legacy = jobs.rows.find((row) => row.kind === "clients_snapshot");
    const regular = jobs.rows.find((row) => row.kind === "regular_update_bundle");
    assert.equal(legacy?.status, "pending");
    assert.equal(regular?.status, "success");
  });
});
