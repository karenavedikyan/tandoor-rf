import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool } from "../../src/db/pool";
import {
  findActiveLabel,
  findLatestRevokedLabel,
  issueLabelOnClient,
  LabelRepositoryError,
} from "../../src/bitrix24/labels/repository";
import {
  loadValidatedBundleFromBytes,
  runExchangeV3CleanStartApply,
} from "../../src/onec-exchange-v3/clean-start";
import { computeTargetDbFingerprint } from "../../src/onec-exchange-v3/target-db-fingerprint";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const MANAGER = "22222222-2222-4222-8222-222222222222";
const LEGAL = "b2000000-0000-4000-8000-000000000001";

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

describe("exchange v3 bitrix labels", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
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

  it("issues new label after clean-start revoke for same GUID", async () => {
    await prepareDatabase(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO bitrix24_confirmed_objects (object_type, object_guid) VALUES ('legal_entity', $1::uuid)`,
      [LEGAL],
    );
    await pool.query(
      `INSERT INTO bitrix24_object_labels (object_type, object_guid, label_code)
       VALUES ('legal_entity', $1::uuid, 'LK_J_000001')`,
      [LEGAL],
    );
    await pool.query(
      `UPDATE bitrix24_object_labels SET revoked_at = NOW() WHERE object_type = 'legal_entity' AND object_guid = $1::uuid`,
      [LEGAL],
    );
    await pool.query(
      `INSERT INTO bitrix24_label_codes_retired (label_code) VALUES ('LK_J_000001') ON CONFLICT DO NOTHING`,
    );
    await pool.end();

    const validated = await validatedBundle();
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const targetFp = (await computeTargetDbFingerprint(databaseUrl))!;
    const clean = await runExchangeV3CleanStartApply({
      databaseUrl,
      bundle: validated.bundle,
      confirmTargetDbFingerprint: targetFp,
      confirmBundleFingerprint: validated.bundle.bundleFingerprint,
    });
    assert.equal(clean.ok, true);

    const active = await findActiveLabel("legal_entity", LEGAL);
    assert.ok(active);
    assert.notEqual(active!.labelCode, "LK_J_000001");

    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes: buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER)]),
    });
    assert.equal(dry.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes: buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER)]),
    });
    const active2 = await findActiveLabel("legal_entity", LEGAL);
    assert.equal(active2?.labelCode, active!.labelCode);
    const revoked = await findLatestRevokedLabel("legal_entity", LEGAL);
    assert.equal(revoked?.labelCode, "LK_J_000001");
  });

  it("blocks re-issue after manual revoke when label is not retired", async () => {
    await prepareDatabase(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO bitrix24_confirmed_objects (object_type, object_guid) VALUES ('legal_entity', $1::uuid)`,
        [LEGAL],
      );
      await client.query(
        `INSERT INTO bitrix24_object_labels (object_type, object_guid, label_code)
         VALUES ('legal_entity', $1::uuid, 'LK_J_000099')`,
        [LEGAL],
      );
      await client.query(
        `UPDATE bitrix24_object_labels SET revoked_at = NOW()
         WHERE object_type = 'legal_entity' AND object_guid = $1::uuid AND label_code = 'LK_J_000099'`,
        [LEGAL],
      );
      await assert.rejects(
        () => issueLabelOnClient("legal_entity", LEGAL, null, client),
        (error: unknown) => error instanceof LabelRepositoryError && error.code === "LABEL_REVOKED",
      );
    } finally {
      client.release();
      await pool.end();
    }
  });
});
