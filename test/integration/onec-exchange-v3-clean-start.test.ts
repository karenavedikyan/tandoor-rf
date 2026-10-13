import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool } from "../../src/db/pool";
import {
  buildCleanStartDryRunReport,
  loadValidatedBundleFromBytes,
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

    const targetFp = computeTargetDbFingerprint(databaseUrl)!;
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

    const targetFp = computeTargetDbFingerprint(databaseUrl)!;
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
});
