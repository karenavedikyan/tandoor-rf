import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { closePool } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { Pool } from "pg";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

describe("exchange v3 import", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("dry-run does not write v3 tables", async () => {
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER, { name_manager: "Manager One" }),
    ]);
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    assert.ok(dry.verificationFingerprint);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const holdings = await pool.query(`SELECT COUNT(*)::int AS c FROM onec_v3_holdings`);
    assert.equal(holdings.rows[0]?.c, 0);
    await pool.end();
  });

  it("apply loads holdings, legal entities, orphan retail", async () => {
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER, { name_manager: "Manager One" }),
    ]);
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    const fp = dry.verificationFingerprint!;

    const applied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", fp],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(applied.status, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const counts = await pool.query<{ h: number; l: number; r: number; orphan: number }>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM onec_v3_holdings) AS h,
          (SELECT COUNT(*)::int FROM onec_v3_legal_entities) AS l,
          (SELECT COUNT(*)::int FROM onec_v3_retail_outlets) AS r,
          (SELECT COUNT(*)::int FROM onec_v3_retail_outlets WHERE guid_holding IS NULL) AS orphan
      `,
    );
    assert.equal(counts.rows[0]?.h, 1);
    assert.equal(counts.rows[0]?.l, 2);
    assert.equal(counts.rows[0]?.r, 2);
    assert.equal(counts.rows[0]?.orphan, 1);

    const labels = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM bitrix24_object_labels WHERE revoked_at IS NULL`,
    );
    assert.equal(labels.rows[0]?.count, 5);

    const reapplied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", fp],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(reapplied.status, "NO_CHANGES");
    const labelsAfter = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM bitrix24_object_labels WHERE revoked_at IS NULL`,
    );
    assert.equal(labelsAfter.rows[0]?.count, 5);
    await pool.end();
  });
});
