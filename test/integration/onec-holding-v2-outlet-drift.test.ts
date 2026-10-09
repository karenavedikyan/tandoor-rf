import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { runRegularUpdate } from "../../src/onec-regular-update/run-update";
import type { RegularUpdateConfig } from "../../src/onec-regular-update/config";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { sha256Hex } from "../../src/onec-clients/sha256";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { buildExportManifestBytes } from "../helpers/onec-export-manifest-fixtures";
import { buildHoldingV2FileBytes, headRow, minimalOutlet } from "../helpers/holding-v2-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const H1 = "a1000000-0000-4000-8000-000000000001";
const S1 = "b1000000-0000-4000-8000-000000000001";

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

async function countSuccessfulApplyRuns(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE status = 'success' AND mode = 'apply'`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("holding v2 outlet drift vs apply_state", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    setHoldingV2PipelineEnabledForTests(true);
  });

  after(() => {
    setHoldingV2PipelineEnabledForTests(undefined);
  });

  it("regular-update repairs manual outlet closure drift despite stale apply_state", async () => {
    const clientsBytes = buildHoldingV2FileBytes([
      headRow(H1, {
        Код: "HV2-DRIFT",
        Контрагент: "SYNTH",
        НаименованиеПолное: "SYNTH",
        ЮрФизЛицо: "Юрлицо",
        retail_outlets: [minimalOutlet(S1, { closed: false })],
      }),
    ]);
    const rosterBytes = buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER)]);
    const manifestBytes = buildExportManifestBytes({
      clientsSha256: sha256Hex(clientsBytes),
      rosterSha256: sha256Hex(rosterBytes),
    });
    const env = ftpEnv(databaseUrl);

    const dryRun = await runRegularUpdate({
      env,
      argv: ["--dry-run"],
      config: testConfig,
      clientsBytes,
      employeeRosterBytes: rosterBytes,
      manifestBytes,
    });
    assert.equal(dryRun.status, "SUCCESS");
    const fingerprint = dryRun.verificationFingerprint!;

    const firstApply = await runRegularUpdate({
      env,
      argv: ["--apply", "--expected-fingerprint", fingerprint],
      config: testConfig,
      clientsBytes,
      employeeRosterBytes: rosterBytes,
      manifestBytes,
    });
    assert.equal(firstApply.status, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        UPDATE onec_holding_v2_outlet_links
        SET is_closed = TRUE, closure_known = TRUE
        WHERE guid_store = $1::uuid
      `,
      [S1],
    );
    const driftRow = await pool.query<{ is_closed: boolean }>(
      `SELECT is_closed FROM onec_holding_v2_outlet_links WHERE guid_store = $1::uuid`,
      [S1],
    );
    assert.equal(driftRow.rows[0]?.is_closed, true);
    const successAfterFirst = await countSuccessfulApplyRuns(databaseUrl);

    const repair = await runRegularUpdate({
      env,
      argv: ["--apply", "--expected-fingerprint", fingerprint],
      config: testConfig,
      clientsBytes,
      employeeRosterBytes: rosterBytes,
      manifestBytes,
    });
    assert.equal(repair.status, "SUCCESS", "expected repair apply when persisted tables drift from source");

    const fixed = await pool.query<{ is_closed: boolean; closure_known: boolean }>(
      `SELECT is_closed, closure_known FROM onec_holding_v2_outlet_links WHERE guid_store = $1::uuid`,
      [S1],
    );
    assert.equal(fixed.rows[0]?.is_closed, false);
    assert.equal(fixed.rows[0]?.closure_known, true);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), successAfterFirst + 1);

    const repeat = await runRegularUpdate({
      env,
      argv: ["--apply", "--expected-fingerprint", fingerprint],
      config: testConfig,
      clientsBytes,
      employeeRosterBytes: rosterBytes,
      manifestBytes,
    });
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), successAfterFirst + 1);
    await pool.end();
  });
});
