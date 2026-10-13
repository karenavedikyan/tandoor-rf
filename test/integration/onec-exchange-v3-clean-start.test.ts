import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  buildCleanStartDryRunReport,
  loadValidatedBundleFromBytes,
  resolveCleanStartCommitUncertainty,
  runExchangeV3CleanStartApply,
} from "../../src/onec-exchange-v3/clean-start";
import { computeTargetDbFingerprint } from "../../src/onec-exchange-v3/target-db-fingerprint";
import { insertSuccessfulImportRun } from "../helpers/clients-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";

const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const MANAGER = "22222222-2222-4222-8222-222222222222";

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

const SIBLING_DB_NAME = "tandoor_rf_cs_b_test";

function withDatabaseName(baseUrl: string, dbName: string): string {
  const parsed = new URL(baseUrl.replace(/^postgresql:/i, "postgres:"));
  parsed.pathname = `/${dbName}`;
  return parsed.toString().replace(/^postgres:/, "postgresql:");
}

function adminPostgresUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl.replace(/^postgresql:/i, "postgres:"));
  parsed.pathname = "/postgres";
  return parsed.toString().replace(/^postgres:/, "postgresql:");
}

async function ensureSiblingTestDatabase(baseUrl: string): Promise<string> {
  const siblingUrl = withDatabaseName(baseUrl, SIBLING_DB_NAME);
  const admin = new Pool({ connectionString: adminPostgresUrl(baseUrl), max: 1 });
  const exists = await admin.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS ok`,
    [SIBLING_DB_NAME],
  );
  if (!exists.rows[0]?.ok) {
    const quoted = `"${SIBLING_DB_NAME.replace(/"/g, '""')}"`;
    await admin.query(`CREATE DATABASE ${quoted}`);
  }
  await admin.end();
  return siblingUrl;
}

async function countLegacyClients(url: string): Promise<number> {
  const pool = new Pool({ connectionString: url, max: 1 });
  const count = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0);
  await pool.end();
  return count;
}

describe("exchange v3 clean start", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  async function validatedBundle() {
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER, { name_manager: "Manager One" }),
    ]);
    return loadValidatedBundleFromBytes({
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
  }

  it("dry-run uses SELECT only and reports fingerprints", async () => {
    await prepareDatabase(databaseUrl);
    await insertSuccessfulImportRun(databaseUrl);
    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    const usersBefore = Number(
      (await client.query(`SELECT COUNT(*)::int AS c FROM users`)).rows[0]?.c ?? 0,
    );
    const report = await buildCleanStartDryRunReport(client, validated.bundle, databaseUrl);
    client.release();
    await pool.end();

    assert.ok(report.targetDb.fingerprint);
    assert.equal(report.wouldRemove.onecClients >= 0, true);
    assert.equal(report.wouldLoad.holdings, 1);
    const pool2 = new Pool({ connectionString: databaseUrl, max: 1 });
    const usersAfter = Number((await pool2.query(`SELECT COUNT(*)::int AS c FROM users`)).rows[0]?.c ?? 0);
    await pool2.end();
    assert.equal(usersAfter, usersBefore);
  });

  it("apply rolls back when forced failure after legacy purge", async () => {
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "v3-clean@test.local",
      password: "StrongPass123!",
      fullName: "V3 Clean",
      role: "admin",
    });
    await insertSuccessfulImportRun(databaseUrl);
    const poolSeed = new Pool({ connectionString: databaseUrl, max: 1 });
    await poolSeed.query(
      `
        INSERT INTO onec_clients (guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager, address, telephone, last_imported_at, source_sha256)
        VALUES ($1::uuid, 'Legacy Row', $1::uuid, 'H', $2::uuid, 'Mgr', '', '[]'::jsonb, NOW(), repeat('a', 64))
        ON CONFLICT (guid_client) DO NOTHING
      `,
      ["b2000000-0000-4000-8000-000000009999", MANAGER],
    );
    await poolSeed.end();

    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { failAfter: "purge_legacy" },
    });
    assert.equal(result.ok, false);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const clients = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0);
    const v3 = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM onec_v3_holdings`)).rows[0]?.c ?? 0);
    await pool.end();
    assert.ok(clients > 0, "legacy clients must remain after rollback");
    assert.equal(v3, 0);
  });

  it("atomic apply: legacy cleared, roster preserved, v3 loaded", async () => {
    await prepareDatabase(databaseUrl);
    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const poolSeed = new Pool({ connectionString: databaseUrl, max: 1 });
    await poolSeed.query(
      `
        INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
        VALUES ($1::uuid, 'Keep Me', 'Менеджер', '{}'::jsonb)
        ON CONFLICT (guid_manager) DO UPDATE SET name_manager = 'Keep Me'
      `,
      [MANAGER],
    );
    await poolSeed.end();

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const applied = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
    });
    assert.equal(applied.ok, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacy = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM onec_clients`)).rows[0]?.c ?? 0);
    const roster = await pool.query<{ name_manager: string }>(
      `SELECT name_manager FROM onec_wholesale_employee_roster WHERE guid_manager = $1::uuid`,
      [MANAGER],
    );
    const v3h = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM onec_v3_holdings`)).rows[0]?.c ?? 0);
    await pool.end();
    assert.equal(legacy, 0);
    assert.equal(v3h, 1);
    assert.equal(roster.rows[0]?.name_manager, "Manager One");
  });

  it("recovers apply report with observed v3 counts after successful COMMIT with lost ack", async () => {
    await prepareDatabase(databaseUrl);
    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { loseCommitAckAfterSuccessfulCommit: true },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.report.recoveredAfterCommitUncertainty, true);
    assert.equal(result.report.legacyRemoved !== null, true);
    assert.equal(result.report.bitrixLabelsRevoked !== null, true);
    assert.equal(result.report.loaded.holdings, 1);
    assert.ok(result.report.loaded.legalEntities >= 1);
    assert.ok(result.report.loaded.retailOutlets >= 1);
  });

  it("returns COMMIT_UNCERTAIN when commit acknowledgement is lost before COMMIT", async () => {
    await prepareDatabase(databaseUrl);
    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
      testHooks: { failCommit: true },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, "COMMIT_UNCERTAIN");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const v3 = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM onec_v3_holdings`)).rows[0]?.c ?? 0);
    const marker = await pool.query<{ legacy_clean_start_completed_at: string | null }>(
      `SELECT legacy_clean_start_completed_at FROM onec_v3_exchange_state WHERE id = 1`,
    );
    await pool.end();
    assert.equal(v3, 0);
    assert.equal(marker.rows[0]?.legacy_clean_start_completed_at, null);
  });

  it("rejects apply when pool targets a different database than input.databaseUrl confirms", async () => {
    await prepareDatabase(databaseUrl);
    const siblingUrl = await ensureSiblingTestDatabase(databaseUrl);
    await prepareDatabase(siblingUrl);

    await insertSuccessfulImportRun(databaseUrl);
    await insertSuccessfulImportRun(siblingUrl);

    const poolA = new Pool({ connectionString: databaseUrl, max: 1 });
    await poolA.query(
      `
        INSERT INTO onec_clients (guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager, address, telephone, last_imported_at, source_sha256)
        VALUES ($1::uuid, 'Legacy A', $1::uuid, 'H', $2::uuid, 'Mgr', '', '[]'::jsonb, NOW(), repeat('a', 64))
        ON CONFLICT (guid_client) DO NOTHING
      `,
      ["a1000000-0000-4000-8000-000000000001", MANAGER],
    );
    await poolA.end();

    const poolB = new Pool({ connectionString: siblingUrl, max: 1 });
    await poolB.query(
      `
        INSERT INTO onec_clients (guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager, address, telephone, last_imported_at, source_sha256)
        VALUES ($1::uuid, 'Legacy B', $1::uuid, 'H', $2::uuid, 'Mgr', '', '[]'::jsonb, NOW(), repeat('b', 64))
        ON CONFLICT (guid_client) DO NOTHING
      `,
      ["b1000000-0000-4000-8000-000000000001", MANAGER],
    );
    await poolB.end();

    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFpA = (await computeTargetDbFingerprint(databaseUrl))!;
    const legacyBeforeA = await countLegacyClients(databaseUrl);
    const legacyBeforeB = await countLegacyClients(siblingUrl);
    assert.ok(legacyBeforeA > 0);
    assert.ok(legacyBeforeB > 0);

    setIntegrationEnv(siblingUrl);
    await resetPoolForTests();

    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFpA,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, "TARGET_DB_MISMATCH");

    assert.equal(await countLegacyClients(databaseUrl), legacyBeforeA);
    assert.equal(await countLegacyClients(siblingUrl), legacyBeforeB);

    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();
  });

  it("does not treat recovery as success when another DB has matching bundle marker but wrong cluster fingerprint", async () => {
    await prepareDatabase(databaseUrl);
    const siblingUrl = await ensureSiblingTestDatabase(databaseUrl);
    await prepareDatabase(siblingUrl);

    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const fpA = (await computeTargetDbFingerprint(databaseUrl))!;
    const fpB = (await computeTargetDbFingerprint(siblingUrl))!;
    assert.notEqual(fpA, fpB);

    const poolB = new Pool({ connectionString: siblingUrl, max: 1 });
    await poolB.query(
      `
        UPDATE onec_v3_exchange_state
        SET legacy_clean_start_completed_at = NOW(),
            legacy_clean_start_bundle_fingerprint = $1
        WHERE id = 1
      `,
      [validated.bundle.bundleFingerprint],
    );
    await poolB.query(
      `
        INSERT INTO onec_v3_holdings (guid_holding, name_holding)
        VALUES ($1::uuid, 'Decoy')
        ON CONFLICT (guid_holding) DO NOTHING
      `,
      ["c1000000-0000-4000-8000-000000000099"],
    );
    await poolB.end();

    const recovery = await resolveCleanStartCommitUncertainty({
      databaseUrl: siblingUrl,
      bundleFingerprint: validated.bundle.bundleFingerprint,
      confirmTargetDbFingerprint: fpA,
    });
    assert.equal(recovery.ok, false);
    if (recovery.ok) return;
    assert.equal(recovery.errorCode, "TARGET_DB_MISMATCH");
  });

  it("rejects wrong targetDb fingerprint", async () => {
    await prepareDatabase(databaseUrl);
    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const result = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: "0".repeat(64),
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, "TARGET_DB_MISMATCH");
  });
});
