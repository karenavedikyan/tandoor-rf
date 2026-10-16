import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { Pool } from "pg";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const HOLDING = "a1000000-0000-4000-8000-000000000001";
const LEGAL_ONE = "b2000000-0000-4000-8000-000000000001";
const LEGAL_ORPHAN = "b2000000-0000-4000-8000-000000000002";
const LEGAL_UNASSIGNED = "b2000000-0000-4000-8000-000000000003";
const LEGAL_TWO = "b2000000-0000-4000-8000-000000000004";
const RETAIL_ONE = "c3000000-0000-4000-8000-000000000001";
const RETAIL_ORPHAN = "c3000000-0000-4000-8000-000000000002";
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
    assert.equal(counts.rows[0]?.l, 4);
    assert.equal(counts.rows[0]?.r, 4);
    assert.equal(counts.rows[0]?.orphan, 1);

    const guids = await pool.query<{ guid: string; kind: string }>(
      `
        SELECT guid_holding::text AS guid, 'holding' AS kind FROM onec_v3_holdings
        UNION ALL SELECT guid_client::text, 'legal' FROM onec_v3_legal_entities
        UNION ALL SELECT guid_store::text, 'retail' FROM onec_v3_retail_outlets
      `,
    );
    const guidSet = new Set(guids.rows.map((r) => r.guid.toLowerCase()));
    for (const expected of [
      HOLDING,
      LEGAL_ONE,
      LEGAL_ORPHAN,
      LEGAL_UNASSIGNED,
      LEGAL_TWO,
      RETAIL_ONE,
      RETAIL_ORPHAN,
    ]) {
      assert.ok(guidSet.has(expected.toLowerCase()), `missing imported object ${expected}`);
    }

    const unassignedMgr = await pool.query<{ empty: boolean }>(
      `SELECT NULLIF(TRIM(COALESCE(managers->>'guidManager', '')), '') IS NULL AS empty
       FROM onec_v3_legal_entities WHERE guid_client = $1::uuid`,
      [LEGAL_UNASSIGNED],
    );
    assert.equal(unassignedMgr.rows[0]?.empty, true);

    const labels = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM bitrix24_object_labels WHERE revoked_at IS NULL`,
    );
    assert.equal(labels.rows[0]?.count, 9);

    const labeled = await pool.query<{ object_guid: string }>(
      `SELECT object_guid::text FROM bitrix24_object_labels WHERE revoked_at IS NULL`,
    );
    const labeledSet = new Set(labeled.rows.map((r) => r.object_guid.toLowerCase()));
    for (const expected of [
      HOLDING,
      LEGAL_ONE,
      LEGAL_ORPHAN,
      LEGAL_UNASSIGNED,
      LEGAL_TWO,
      RETAIL_ONE,
      RETAIL_ORPHAN,
    ]) {
      assert.ok(labeledSet.has(expected.toLowerCase()), `missing label for ${expected}`);
    }

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
    assert.equal(labelsAfter.rows[0]?.count, 9);

    const countsAfter = await pool.query<{ l: number }>(
      `SELECT COUNT(*)::int AS l FROM onec_v3_legal_entities`,
    );
    assert.equal(countsAfter.rows[0]?.l, 4);
    await pool.end();
  });

  it("stores root inn/kpp and replaces values on full regular apply", async () => {
    await closePool();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();

    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER, { name_manager: "Manager One" }),
    ]);
    const clientsV1 = loadFixture("all_clients.json");
    const dry1 = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: clientsV1,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry1.status, "SUCCESS");
    const applied1 = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry1.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: clientsV1,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(applied1.status, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row1 = await pool.query<{ inn: string | null; kpp: string | null }>(
      `SELECT inn, kpp FROM onec_v3_legal_entities WHERE guid_client = $1::uuid`,
      [LEGAL_ONE],
    );
    assert.equal(row1.rows[0]?.inn, "0123456789");
    assert.equal(row1.rows[0]?.kpp, "770701001");
    const unassigned = await pool.query<{ inn: string | null }>(
      `SELECT inn FROM onec_v3_legal_entities WHERE guid_client = $1::uuid`,
      [LEGAL_UNASSIGNED],
    );
    assert.equal(unassigned.rows[0]?.inn, null);

    const clientsParsed = JSON.parse(clientsV1.toString("utf8")) as Array<Record<string, unknown>>;
    const legalOne = clientsParsed.find((r) => r.guid_client === LEGAL_ONE);
    assert.ok(legalOne);
    legalOne!.inn = "7707083893";
    legalOne!.kpp = "";
    const clientsV2 = Buffer.from(JSON.stringify(clientsParsed));
    const dry2 = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: clientsV2,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry2.status, "SUCCESS");
    const applied2 = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry2.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: clientsV2,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(applied2.status, "SUCCESS");
    const row2 = await pool.query<{ inn: string | null; kpp: string | null }>(
      `SELECT inn, kpp FROM onec_v3_legal_entities WHERE guid_client = $1::uuid`,
      [LEGAL_ONE],
    );
    assert.equal(row2.rows[0]?.inn, "7707083893");
    assert.equal(row2.rows[0]?.kpp, null);

    legalOne!.inn = "";
    const clientsV3 = Buffer.from(JSON.stringify(clientsParsed));
    const dry3 = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: clientsV3,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    const applied3 = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry3.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: clientsV3,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(applied3.status, "SUCCESS");
    const row3 = await pool.query<{ inn: string | null }>(
      `SELECT inn FROM onec_v3_legal_entities WHERE guid_client = $1::uuid`,
      [LEGAL_ONE],
    );
    assert.equal(row3.rows[0]?.inn, null);

    const dup = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry3.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: clientsV3,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dup.status, "NO_CHANGES");
    await pool.end();
  });
});
