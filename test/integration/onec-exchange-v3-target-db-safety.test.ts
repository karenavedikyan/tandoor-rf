import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  resolveCleanStartCommitUncertainty,
  runExchangeV3CleanStartApply,
} from "../../src/onec-exchange-v3/clean-start";
import { observeCleanStartState } from "../../src/onec-exchange-v3/clean-start-verify";
import { computeTargetDbFingerprint } from "../../src/onec-exchange-v3/target-db-fingerprint";
import {
  readTargetDbIdentityFromClient,
  resolveTargetDbIdentityFromUrl,
  TargetDbIdentityError,
  withOneOffPgClient,
} from "../../src/onec-exchange-v3/target-db-identity";
import { insertSuccessfulImportRun } from "../helpers/clients-db-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

function withDatabaseUser(baseUrl: string, user: string, password: string): string {
  const parsed = new URL(baseUrl.replace(/^postgresql:/i, "postgres:"));
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString().replace(/^postgres:/, "postgresql:");
}

describe("exchange v3 target db safety", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("times out identity read on server statement_timeout without discardConnection", async () => {
    await assert.rejects(
      () =>
        withOneOffPgClient(databaseUrl, async (client) => {
          await client.query("SET statement_timeout = 100");
          return readTargetDbIdentityFromClient(client, databaseUrl, { testPreSleepSec: 5 });
        }),
      (error: unknown) =>
        error instanceof TargetDbIdentityError &&
        error.code === "TARGET_DB_IDENTITY_TIMEOUT" &&
        error.timeoutKind === "server_statement" &&
        error.discardConnection === false,
    );

    const observed = await observeCleanStartState(databaseUrl);
    assert.ok(observed);
  });

  it("discards one-off client on client-side Query read timeout", async () => {
    let releasedWithDiscard = false;
    await assert.rejects(
      () =>
        withOneOffPgClient(
          databaseUrl,
          async (client) => {
            const originalRelease = client.release.bind(client);
            client.release = (err?: boolean | Error) => {
              releasedWithDiscard = err === true;
              return originalRelease(err);
            };
            return readTargetDbIdentityFromClient(client, databaseUrl, {
              testPreSleepSec: 5,
              queryTimeoutMs: 100,
            });
          },
          { queryTimeoutMs: 100 },
        ),
      (error: unknown) =>
        error instanceof TargetDbIdentityError &&
        error.timeoutKind === "client_transport" &&
        error.discardConnection === true,
    );
    assert.equal(releasedWithDiscard, true);
  });

  it("apply discards pooled client on client query timeout without purge", async () => {
    await prepareDatabase(databaseUrl);
    await insertSuccessfulImportRun(databaseUrl);

    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(
      `
        INSERT INTO onec_clients (guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager, address, telephone, last_imported_at, source_sha256)
        VALUES ($1::uuid, 'Legacy Timeout', $1::uuid, 'H', $2::uuid, 'Mgr', '', '[]'::jsonb, NOW(), repeat('d', 64))
        ON CONFLICT (guid_client) DO NOTHING
      `,
      ["e1000000-0000-4000-8000-000000000001", "22222222-2222-4222-8222-222222222222"],
    );
    const legacyBefore = Number(
      (await admin.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0,
    );
    await admin.end();

    const fs = await import("node:fs");
    const path = await import("node:path");
    const { loadValidatedBundleFromBytes } = await import("../../src/onec-exchange-v3/clean-start");
    const { buildEmployeeRosterBytes, buildEmployeeRosterEntry } = await import(
      "../helpers/onec-clients-employee-roster-fixtures"
    );
    const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
    const validated = loadValidatedBundleFromBytes({
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: buildEmployeeRosterBytes([
        buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222", { name_manager: "Manager One" }),
      ]),
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { identityTestPreSleepSec: 5, identityQueryTimeoutMs: 100 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, "TARGET_DB_MISMATCH");

    const verify = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyAfter = Number((await verify.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0);
    await verify.end();
    assert.equal(legacyAfter, legacyBefore);

    await resetPoolForTests();
    const poolOk = new Pool({ connectionString: databaseUrl, max: 1 });
    await poolOk.query("SELECT 1");
    await poolOk.end();
  });

  it("transport error after COMMIT uses fresh recovery and discards pooled client", async () => {
    await prepareDatabase(databaseUrl);
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { loadValidatedBundleFromBytes } = await import("../../src/onec-exchange-v3/clean-start");
    const { buildEmployeeRosterBytes, buildEmployeeRosterEntry } = await import(
      "../helpers/onec-clients-employee-roster-fixtures"
    );
    const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
    const validated = loadValidatedBundleFromBytes({
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: buildEmployeeRosterBytes([
        buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222", { name_manager: "Manager One" }),
      ]),
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { simulateCommitTransportTimeout: true },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.report.recoveredAfterCommitUncertainty, true);

    await resetPoolForTests();
    const poolOk = new Pool({ connectionString: databaseUrl, max: 1 });
    await poolOk.query("SELECT 1");
    await poolOk.end();
  });

  it("returns COMMIT_UNCERTAIN when recovery observation cannot complete", async () => {
    const badUrl = withDatabaseUser(databaseUrl, "postgres", "wrong-password-not-used");
    const recovery = await resolveCleanStartCommitUncertainty({
      databaseUrl: badUrl,
      bundleFingerprint: "0".repeat(64),
      confirmTargetDbFingerprint: "0".repeat(64),
    });
    assert.equal(recovery.ok, false);
    if (recovery.ok) return;
    assert.equal(recovery.errorCode, "COMMIT_UNCERTAIN");
  });

  it("denies apply before data changes when pg_control_system is unavailable for the app role", async () => {
    await prepareDatabase(databaseUrl);
    await insertSuccessfulImportRun(databaseUrl);

    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(
      `
        INSERT INTO onec_clients (guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager, address, telephone, last_imported_at, source_sha256)
        VALUES ($1::uuid, 'Legacy Denied', $1::uuid, 'H', $2::uuid, 'Mgr', '', '[]'::jsonb, NOW(), repeat('c', 64))
        ON CONFLICT (guid_client) DO NOTHING
      `,
      ["d1000000-0000-4000-8000-000000000001", "22222222-2222-4222-8222-222222222222"],
    );
    const legacyBefore = Number(
      (await admin.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0,
    );
    await admin.end();

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { loadValidatedBundleFromBytes } = await import("../../src/onec-exchange-v3/clean-start");
    const { buildEmployeeRosterBytes, buildEmployeeRosterEntry } = await import(
      "../helpers/onec-clients-employee-roster-fixtures"
    );
    const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
    const validated = loadValidatedBundleFromBytes({
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: buildEmployeeRosterBytes([
        buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222", { name_manager: "Manager One" }),
      ]),
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { simulatePgControlSystemDenied: true },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, "TARGET_DB_MISMATCH");
    assert.match(result.message, /pg_control_system/i);

    const verify = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyAfter = Number((await verify.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0);
    await verify.end();
    assert.equal(legacyAfter, legacyBefore);
  });

  it("recovery success leaves purge counters null when transaction metrics were not retained", async () => {
    await prepareDatabase(databaseUrl);
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { loadValidatedBundleFromBytes } = await import("../../src/onec-exchange-v3/clean-start");
    const { buildEmployeeRosterBytes, buildEmployeeRosterEntry } = await import(
      "../helpers/onec-clients-employee-roster-fixtures"
    );
    const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
    const validated = loadValidatedBundleFromBytes({
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: buildEmployeeRosterBytes([
        buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222", { name_manager: "Manager One" }),
      ]),
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const applied = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
    });
    assert.equal(applied.ok, true);

    const recovery = await resolveCleanStartCommitUncertainty({
      databaseUrl,
      bundleFingerprint: validated.bundle.bundleFingerprint,
      confirmTargetDbFingerprint: targetFp,
    });
    assert.equal(recovery.ok, true);
    if (!recovery.ok) return;
    assert.equal(recovery.report.recoveredAfterCommitUncertainty, true);
    assert.equal(recovery.report.legacyRemoved, null);
    assert.equal(recovery.report.bitrixLabelsRevoked, null);
    assert.ok(recovery.report.loaded.holdings > 0);
  });
});
