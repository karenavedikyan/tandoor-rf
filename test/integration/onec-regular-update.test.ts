import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Express } from "express";
import request from "supertest";
import { Pool, type PoolClient } from "pg";
import { IMPORT_ADVISORY_LOCK_KEY } from "../../src/onec-clients/constants";
import { runRegularUpdate } from "../../src/onec-regular-update/run-update";
import type { RegularUpdateConfig } from "../../src/onec-regular-update/config";
import { closePool, resetPoolForTests } from "../../src/db/pool";
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
import {
  addRopTeamMember,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
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
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";

const testConfig: RegularUpdateConfig = {
  stabilityDelayMs: 0,
  readRetries: 0,
  readDeadlineMs: 60_000,
  holdingLinkValidationPolicy: "tolerant",
};

function ftpEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "127.0.0.1",
    ONEC_FTP_PORT: "21",
    ONEC_FTP_USER: "lc_exchange",
    ONEC_FTP_PASSWORD: "test-password",
    ONEC_FTP_BASE_PATH: "/LC",
    ONEC_FTP_TIMEOUT_MS: "15000",
  };
}

function rosterForManagers(...guids: string[]): Buffer {
  return buildEmployeeRosterBytes(
    guids.map((guid) => buildEmployeeRosterEntry(guid, { name_manager: `Roster ${guid.slice(0, 8)}` })),
  );
}

function manifestForBundle(clientsBytes: Buffer, rosterBytes: Buffer): Buffer {
  return buildExportManifestBytes({
    clientsSha256: sha256Hex(clientsBytes),
    rosterSha256: sha256Hex(rosterBytes),
  });
}

type BundleInput = {
  clientsBytes: Buffer;
  rosterBytes: Buffer;
  manifestBytes?: Buffer;
};

function bundle(clientsBytes: Buffer, rosterBytes: Buffer, withManifest = true): BundleInput {
  return {
    clientsBytes,
    rosterBytes,
    manifestBytes: withManifest ? manifestForBundle(clientsBytes, rosterBytes) : undefined,
  };
}

async function dryRunBundle(databaseUrl: string, input: BundleInput) {
  return runRegularUpdate({
    env: ftpEnv(databaseUrl),
    argv: ["--dry-run"],
    config: testConfig,
    clientsBytes: input.clientsBytes,
    employeeRosterBytes: input.rosterBytes,
    manifestBytes: input.manifestBytes,
  });
}

async function applyBundle(
  databaseUrl: string,
  input: BundleInput,
  expectedFingerprint: string,
  applyTestHooks?: Parameters<typeof runRegularUpdate>[0]["applyTestHooks"],
) {
  return runRegularUpdate({
    env: ftpEnv(databaseUrl),
    argv: ["--apply", "--expected-fingerprint", expectedFingerprint],
    config: testConfig,
    clientsBytes: input.clientsBytes,
    employeeRosterBytes: input.rosterBytes,
    manifestBytes: input.manifestBytes,
    applyTestHooks,
  });
}

async function verifyAndApply(
  databaseUrl: string,
  clientsBytes: Buffer,
  rosterBytes: Buffer,
  applyTestHooks?: Parameters<typeof runRegularUpdate>[0]["applyTestHooks"],
) {
  const input = bundle(clientsBytes, rosterBytes);
  const dryRun = await dryRunBundle(databaseUrl, input);
  assert.equal(dryRun.status, "SUCCESS", JSON.stringify(dryRun));
  assert.equal(dryRun.applyPermitted, true);
  return applyBundle(databaseUrl, input, dryRun.verificationFingerprint!, applyTestHooks);
}

describe("onec regular update integration", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("dry-run verifies bundle without database writes", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = rosterForManagers(MANAGER_A);
    const env = ftpEnv(databaseUrl);
    delete env.DATABASE_URL;

    const result = await runRegularUpdate({
      env,
      argv: ["--dry-run"],
      config: testConfig,
      clientsBytes,
      employeeRosterBytes: rosterBytes,
    });

    assert.equal(result.status, "SUCCESS");
    assert.ok(result.verificationFingerprint);
    assert.equal(result.clientsSourceSha256?.length, 64);
    assert.equal(result.employeeRosterSourceSha256?.length, 64);
    assert.equal(result.sourceExportAt, null);
    assert.equal(result.releaseConsistencyConfirmed, false);
    assert.equal(result.applyPermitted, false);
    assert.match(result.message, /Согласованность выпуска не подтверждена/);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const journal = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_client_import_runs",
    );
    await pool.end();
    assert.equal(Number(journal.rows[0]?.count), 0);
  });

  it("applies client updates with roster and upserts wholesale employees", async () => {
    const clientsBytes = buildClientsFileBytes([
      sampleClient({ name_client: "Client Alpha Updated" }),
      sampleClientTwo(),
    ]);
    const rosterBytes = rosterForManagers(MANAGER_A, MANAGER_B);

    const applied = await verifyAndApply(databaseUrl, clientsBytes, rosterBytes);
    assert.equal(applied.status, "SUCCESS");
    assert.equal(applied.counts?.clientsProcessed, 2);
    assert.equal(applied.counts?.employeesProcessed, 2);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const clientName = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1",
      [CLIENT_ONE],
    );
    const rosterCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster",
    );
    const journal = await pool.query<{ trigger_source: string }>(
      `
        SELECT trigger_source
        FROM onec_client_import_runs
        WHERE id = $1::uuid
      `,
      [applied.applyRunId],
    );
    await pool.end();

    assert.equal(clientName.rows[0]?.name_client, "Client Alpha Updated");
    assert.equal(Number(rosterCount.rows[0]?.count), 2);
    assert.equal(journal.rows[0]?.trigger_source, "regular_update");
  });

  it("applies roster-only changes when clients file is unchanged", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const initialRoster = rosterForManagers(MANAGER_A, MANAGER_B);
    await verifyAndApply(databaseUrl, clientsBytes, initialRoster);

    const updatedRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Renamed Manager A", email: "renamed-a@test.local" }),
      buildEmployeeRosterEntry(MANAGER_B, { name_manager: "Roster 55555555" }),
    ]);

    const updatedInput = bundle(clientsBytes, updatedRoster);
    const dryRun = await dryRunBundle(databaseUrl, updatedInput);
    assert.equal(dryRun.status, "SUCCESS");
    assert.notEqual(
      dryRun.verificationFingerprint,
      (await dryRunBundle(databaseUrl, bundle(clientsBytes, initialRoster))).verificationFingerprint,
    );

    const applied = await applyBundle(databaseUrl, updatedInput, dryRun.verificationFingerprint!);
    assert.equal(applied.status, "SUCCESS");
    assert.equal(applied.counts?.clientsUnchanged, 2);
    assert.equal(applied.counts?.employeesChanged, 1);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const rosterName = await pool.query<{ name_manager: string }>(
      "SELECT name_manager FROM onec_wholesale_employee_roster WHERE guid_manager = $1::uuid",
      [MANAGER_A],
    );
    await pool.end();
    assert.equal(rosterName.rows[0]?.name_manager, "Renamed Manager A");
  });

  it("returns NO_CHANGES when repeating the same bundle fingerprint", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = rosterForManagers(MANAGER_A);
    await verifyAndApply(databaseUrl, clientsBytes, rosterBytes);

    const bundleInput = bundle(clientsBytes, rosterBytes);
    const dryRun = await dryRunBundle(databaseUrl, bundleInput);
    const repeat = await applyBundle(databaseUrl, bundleInput, dryRun.verificationFingerprint!);
    assert.equal(repeat.status, "NO_CHANGES");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const runCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'",
    );
    await pool.end();
    assert.equal(Number(runCount.rows[0]?.count), 1);
  });

  it("rejects corrupted and invalid bundle inputs", async () => {
    const validClients = buildClientsFileBytes([sampleClient()]);
    const validRoster = rosterForManagers(MANAGER_A);

    const corruptedClients = Buffer.from("{not-json", "utf8");
    const corrupted = await dryRunBundle(databaseUrl, bundle(corruptedClients, validRoster, false));
    assert.equal(corrupted.status, "REJECTED_BY_CHECKS");
    assert.equal(corrupted.errorCode, "VALIDATION_FAILED");

    const corruptedRoster = Buffer.from("[", "utf8");
    const invalidRoster = await dryRunBundle(databaseUrl, bundle(validClients, corruptedRoster, false));
    assert.equal(invalidRoster.status, "REJECTED_BY_CHECKS");
    assert.equal(invalidRoster.errorCode, "VALIDATION_FAILED");
  });

  it("rejects unstable roster between stability reads", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    let rosterReads = 0;
    const unstableRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "First Read" }),
    ]);
    const changedRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Second Read" }),
    ]);

    const result = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--dry-run"],
      config: testConfig,
      clientsBytes,
      rosterReader: async () => {
        rosterReads += 1;
        return {
          ok: true as const,
          bytes: rosterReads === 1 ? unstableRoster : changedRoster,
        };
      },
    });

    assert.equal(result.status, "REJECTED_BY_CHECKS");
    assert.equal(result.errorCode, "UNSTABLE_SOURCE");
  });

  it("rejects bundle read drift when clients change during roster read", async () => {
    const firstClients = buildClientsFileBytes([sampleClient()]);
    const secondClients = buildClientsFileBytes([
      sampleClient({ name_client: "Drifted During Bundle Read" }),
    ]);
    const rosterBytes = rosterForManagers(MANAGER_A);
    let clientReads = 0;

    const result = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--dry-run"],
      config: testConfig,
      clientsReader: async () => {
        clientReads += 1;
        const bytes = clientReads <= 2 ? firstClients : secondClients;
        return { ok: true as const, bytes, remotePath: "/LC/clients/all_clients.json" };
      },
      employeeRosterBytes: rosterBytes,
    });

    assert.equal(result.status, "REJECTED_BY_CHECKS");
    assert.equal(result.errorCode, "BUNDLE_READ_DRIFT");
  });

  it("blocks suspicious client base reduction", async () => {
    const fullClients = buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
    const rosterBytes = rosterForManagers(MANAGER_A, MANAGER_B);
    await verifyAndApply(databaseUrl, fullClients, rosterBytes);

    const reducedClients = buildClientsFileBytes([sampleClient()]);
    const reducedInput = bundle(reducedClients, rosterBytes);
    const dryRun = await dryRunBundle(databaseUrl, reducedInput);
    const reduced = await applyBundle(databaseUrl, reducedInput, dryRun.verificationFingerprint!);
    assert.equal(reduced.status, "REJECTED_BY_CHECKS");
    assert.equal(reduced.errorCode, "RECORD_COUNT_DECREASED");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const count = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM onec_clients");
    await pool.end();
    assert.equal(Number(count.rows[0]?.count), 2);
  });

  it("blocks parallel apply while advisory lock is held", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = rosterForManagers(MANAGER_A);
    const bundleInput = bundle(clientsBytes, rosterBytes);
    const dryRun = await dryRunBundle(databaseUrl, bundleInput);

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const holder = await pool.connect();
    const locked = await holder.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [IMPORT_ADVISORY_LOCK_KEY],
    );
    assert.equal(locked.rows[0]?.locked, true);

    const blocked = await applyBundle(databaseUrl, bundleInput, dryRun.verificationFingerprint!);
    assert.equal(blocked.status, "REJECTED_BY_CHECKS");
    assert.equal(blocked.errorCode, "IMPORT_LOCKED");

    await holder.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
    holder.release();
    await pool.end();
  });

  it("rolls back on apply failure without partial client updates", async () => {
    const seedClients = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = rosterForManagers(MANAGER_A);
    await verifyAndApply(databaseUrl, seedClients, rosterBytes);

    const twoClients = buildClientsFileBytes([
      sampleClient({ name_client: "Should Not Persist" }),
      sampleClientTwo(),
    ]);
    const failedInput = bundle(twoClients, rosterBytes);
    const dryRun = await dryRunBundle(databaseUrl, failedInput);
    const failed = await applyBundle(databaseUrl, failedInput, dryRun.verificationFingerprint!, {
      afterRecordIndex: 1,
    });
    assert.equal(failed.status, "ERROR");
    assert.equal(failed.errorCode, "DATABASE_ERROR");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const clientCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_clients",
    );
    const clientName = await pool.query<{ name_client: string }>(
      "SELECT name_client FROM onec_clients WHERE guid_client = $1",
      [CLIENT_ONE],
    );
    await pool.end();
    assert.equal(Number(clientCount.rows[0]?.count), 1);
    assert.equal(clientName.rows[0]?.name_client, "Client Alpha");
  });

  it("preserves local review records across regular update apply", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = rosterForManagers(MANAGER_A);
    await verifyAndApply(databaseUrl, clientsBytes, rosterBytes);

    const admin = await createTestUser({
      databaseUrl,
      email: "review-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Review Admin",
      role: "admin",
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO client_review_records (
          guid_client,
          review_state,
          comment,
          basis_manager_guid,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1::uuid, 'in_progress', 'local review note', $2::uuid, $3::uuid, $3::uuid)
      `,
      [CLIENT_ONE, MANAGER_A, admin.id],
    );
    await pool.end();

    const updatedClients = buildClientsFileBytes([
      sampleClient({ name_client: "Client Alpha Reviewed" }),
    ]);
    await verifyAndApply(databaseUrl, updatedClients, rosterBytes);

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const review = await poolAfter.query<{ comment: string }>(
      "SELECT comment FROM client_review_records WHERE guid_client = $1::uuid",
      [CLIENT_ONE],
    );
    await poolAfter.end();
    assert.equal(review.rows[0]?.comment, "local review note");
  });

  it("preserves omitted roster fields and applies explicit empty clears", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterWithEmail = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { email: "keep-me@test.local", telephone: "+79991112233" }),
    ]);
    await verifyAndApply(databaseUrl, clientsBytes, rosterWithEmail);

    const partialRoster = buildEmployeeRosterBytes([
      { guid_manager: MANAGER_A, name_manager: "Partial Name Only" },
    ]);
    await verifyAndApply(databaseUrl, clientsBytes, partialRoster);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const afterPartial = await pool.query<{ name_manager: string; email: string | null; telephone: string | null }>(
      `
        SELECT name_manager, email, telephone
        FROM onec_wholesale_employee_roster
        WHERE guid_manager = $1::uuid
      `,
      [MANAGER_A],
    );
    await pool.end();
    assert.equal(afterPartial.rows[0]?.name_manager, "Partial Name Only");
    assert.equal(afterPartial.rows[0]?.email, "keep-me@test.local");
    assert.equal(afterPartial.rows[0]?.telephone, "+79991112233");

    const clearedRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { email: "", telephone: "" }),
    ]);
    await verifyAndApply(databaseUrl, clientsBytes, clearedRoster);

    const poolCleared = new Pool({ connectionString: databaseUrl, max: 1 });
    const afterClear = await poolCleared.query<{ email: string | null; telephone: string | null }>(
      `
        SELECT email, telephone
        FROM onec_wholesale_employee_roster
        WHERE guid_manager = $1::uuid
      `,
      [MANAGER_A],
    );
    await poolCleared.end();
    assert.equal(afterClear.rows[0]?.email, null);
    assert.equal(afterClear.rows[0]?.telephone, null);
  });

  describe("confirmed regression fixes", () => {
    it("dry-run reports unconfirmed release; apply rejects without manifest and leaves DB unchanged", async () => {
      const clientsBytes = buildClientsFileBytes([sampleClient()]);
      const rosterBytes = rosterForManagers(MANAGER_A);
      const dryRun = await dryRunBundle(databaseUrl, bundle(clientsBytes, rosterBytes, false));
      assert.equal(dryRun.status, "SUCCESS");
      assert.equal(dryRun.applyPermitted, false);
      assert.equal(dryRun.releaseConsistencyConfirmed, false);
      assert.match(dryRun.message, /Согласованность выпуска не подтверждена/);

      const applyAttempt = await applyBundle(
        databaseUrl,
        bundle(clientsBytes, rosterBytes, false),
        dryRun.verificationFingerprint!,
      );
      assert.equal(applyAttempt.status, "REJECTED_BY_CHECKS");
      assert.equal(applyAttempt.errorCode, "RELEASE_CONSISTENCY_NOT_CONFIRMED");

      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const clientCount = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM onec_clients",
      );
      await pool.end();
      assert.equal(Number(clientCount.rows[0]?.count), 0);
    });

    it("rejects ambiguous roster shrink when removed manager still owns clients", async () => {
      const clientsBytes = buildClientsFileBytes([
        sampleClient({ guid_manager: MANAGER_A }),
        sampleClientTwo({ guid_manager: MANAGER_B }),
      ]);
      await verifyAndApply(databaseUrl, clientsBytes, rosterForManagers(MANAGER_A, MANAGER_B));

      const reducedRoster = rosterForManagers(MANAGER_A);
      const reducedInput = bundle(clientsBytes, reducedRoster);
      const dryRun = await dryRunBundle(databaseUrl, reducedInput);
      const rejected = await applyBundle(databaseUrl, reducedInput, dryRun.verificationFingerprint!);
      assert.equal(rejected.status, "REJECTED_BY_CHECKS");
      assert.equal(rejected.errorCode, "ROSTER_SHRINK_AMBIGUOUS");

      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const rosterState = await pool.query<{ manager_roster_state: string }>(
        "SELECT manager_roster_state FROM onec_clients WHERE guid_client = $1",
        [sampleClientTwo().guid_client],
      );
      const rosterCount = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_roster",
      );
      await pool.end();
      assert.notEqual(rosterState.rows[0]?.manager_roster_state, "outside_wholesale_roster");
      assert.equal(Number(rosterCount.rows[0]?.count), 2);
    });

    it("counts roster field changes for guid_post and work_schedule", async () => {
      const clientsBytes = buildClientsFileBytes([sampleClient()]);
      const initialRoster = buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER_A, {
          guid_post: "66666666-6666-4666-8666-666666666666",
          work_schedule: "5/2",
        }),
      ]);
      await verifyAndApply(databaseUrl, clientsBytes, initialRoster);

      const changedRoster = buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER_A, {
          guid_post: "77777777-7777-4777-8777-777777777777",
          work_schedule: "2/2",
        }),
      ]);
      const changedInput = bundle(clientsBytes, changedRoster);
      const dryRun = await dryRunBundle(databaseUrl, changedInput);
      const applied = await applyBundle(databaseUrl, changedInput, dryRun.verificationFingerprint!);
      assert.equal(applied.status, "SUCCESS");
      assert.equal(applied.counts?.employeesChanged, 1);
      assert.equal(applied.counts?.employeesUnchanged, 0);
    });

    it("rejects invalid roster date before apply and preserves previous roster value", async () => {
      const clientsBytes = buildClientsFileBytes([sampleClient()]);
      const validRoster = buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER_A, { date_of_assumption: "05.10.2026" }),
      ]);
      await verifyAndApply(databaseUrl, clientsBytes, validRoster);

      const invalidRoster = buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER_A, { date_of_assumption: "31.02.2026" }),
      ]);
      const rejectedDryRun = await dryRunBundle(databaseUrl, bundle(clientsBytes, invalidRoster, false));
      assert.equal(rejectedDryRun.status, "REJECTED_BY_CHECKS");
      assert.equal(rejectedDryRun.errorCode, "VALIDATION_FAILED");

      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const dateRow = await pool.query<{ date_of_assumption: Date }>(
        "SELECT date_of_assumption FROM onec_wholesale_employee_roster WHERE guid_manager = $1::uuid",
        [MANAGER_A],
      );
      await pool.end();
      assert.equal(dateRow.rows[0]?.date_of_assumption.toISOString(), "2026-10-05T12:00:00.000Z");
    });
  });
});

describe("regular update manager reassignment access", { concurrency: false }, () => {
  let databaseUrl = "";
  let app!: Express;
  let adminUserId = "";
  let managerAUserId = "";
  let managerBUserId = "";
  let managerACookie = "";
  let managerBCookie = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    app = createApp();
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);

    adminUserId = (
      await createTestUser({
        databaseUrl,
        email: "admin-regular@example.com",
        password: TEST_PASSWORD,
        fullName: "Admin",
        role: "admin",
      })
    ).id;
    managerAUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-a-regular@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager A",
        role: "manager",
      })
    ).id;
    managerBUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-b-regular@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager B",
        role: "manager",
      })
    ).id;

    for (const [userId, employeeId] of [
      [managerAUserId, MANAGER_A],
      [managerBUserId, MANAGER_B],
    ] as const) {
      await linkUserToEmployee({
        databaseUrl,
        userId,
        employeeId,
        confirmedByUserId: adminUserId,
      });
    }

    const login = async (email: string) => {
      const res = await request(app)
        .post("/api/auth/login")
        .set({ Origin: ORIGIN, "Content-Type": "application/json" })
        .send({ email, password: TEST_PASSWORD });
      assert.equal(res.status, 200);
      return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
    };
    managerACookie = await login("manager-a-regular@example.com");
    managerBCookie = await login("manager-b-regular@example.com");
  });

  after(async () => {
    await closePool();
  });

  it("moves client access after confirmed manager reassignment", async () => {
    const initialClients = buildClientsFileBytes([
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);
    const rosterA = rosterForManagers(MANAGER_A, MANAGER_B);
    await verifyAndApply(databaseUrl, initialClients, rosterA);

    assert.equal(
      (await request(app).get("/api/clients").set({ Origin: ORIGIN, Cookie: managerACookie })).body.total,
      1,
    );

    const reassignedClients = buildClientsFileBytes([
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);
    const rosterB = rosterForManagers(MANAGER_A, MANAGER_B);
    await verifyAndApply(databaseUrl, reassignedClients, rosterB);

    assert.equal(
      (await request(app).get("/api/clients").set({ Origin: ORIGIN, Cookie: managerACookie })).body.total,
      0,
    );
    assert.equal(
      (await request(app).get("/api/clients").set({ Origin: ORIGIN, Cookie: managerBCookie })).body.total,
      1,
    );
  });
});
