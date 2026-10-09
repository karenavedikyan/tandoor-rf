import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { runRegularUpdate } from "../../src/onec-regular-update/run-update";
import type { RegularUpdateConfig } from "../../src/onec-regular-update/config";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { sha256Hex } from "../../src/onec-clients/sha256";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { buildExportManifestBytes } from "../helpers/onec-export-manifest-fixtures";
import {
  buildHoldingV2FileBytes,
  headRow,
  minimalOutlet,
} from "../helpers/holding-v2-fixtures";
import {
  clearHoldingV2PersistedReconcileState,
  countHoldingV2ReconcileRuns,
  loadActiveLegalLinks,
} from "../helpers/holding-v2-reconcile-db";
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

function bundle(clientsBytes: Buffer, rosterBytes: Buffer) {
  return {
    clientsBytes,
    rosterBytes,
    manifestBytes: buildExportManifestBytes({
      clientsSha256: sha256Hex(clientsBytes),
      rosterSha256: sha256Hex(rosterBytes),
    }),
  };
}

async function countSuccessfulApplyRuns(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_client_import_runs
      WHERE status = 'success' AND mode = 'apply'
    `,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("holding v2 regular-update backfill gate", { concurrency: false }, () => {
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

  it("re-applies v2 reconcile when fingerprint matches but v2 tables were cleared; repeat is NO_CHANGES", async () => {
    const clientsBytes = buildHoldingV2FileBytes([
      headRow(H1, {
        Код: "HV2-BACKFILL",
        Контрагент: "SYNTH CP",
        НаименованиеПолное: "SYNTH CP Full",
        ЮрФизЛицо: "Юрлицо",
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const rosterBytes = buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER)]);
    const input = bundle(clientsBytes, rosterBytes);

    const dryRun = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--dry-run"],
      config: testConfig,
      clientsBytes: input.clientsBytes,
      employeeRosterBytes: input.rosterBytes,
      manifestBytes: input.manifestBytes,
    });
    assert.equal(dryRun.status, "SUCCESS");
    const fingerprint = dryRun.verificationFingerprint!;
    assert.ok(fingerprint);

    const firstApply = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--apply", "--expected-fingerprint", fingerprint],
      config: testConfig,
      clientsBytes: input.clientsBytes,
      employeeRosterBytes: input.rosterBytes,
      manifestBytes: input.manifestBytes,
    });
    assert.equal(firstApply.status, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    assert.equal((await loadActiveLegalLinks(pool)).length, 1);
    const successRunsAfterFirst = await countSuccessfulApplyRuns(databaseUrl);
    await clearHoldingV2PersistedReconcileState(pool);
    assert.equal((await loadActiveLegalLinks(pool)).length, 0);

    const backfillApply = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--apply", "--expected-fingerprint", fingerprint],
      config: testConfig,
      clientsBytes: input.clientsBytes,
      employeeRosterBytes: input.rosterBytes,
      manifestBytes: input.manifestBytes,
    });
    assert.equal(backfillApply.status, "SUCCESS");
    assert.equal((await loadActiveLegalLinks(pool)).length, 1);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), successRunsAfterFirst + 1);
    assert.equal(await countHoldingV2ReconcileRuns(pool, "success"), 1);

    const repeat = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--apply", "--expected-fingerprint", fingerprint],
      config: testConfig,
      clientsBytes: input.clientsBytes,
      employeeRosterBytes: input.rosterBytes,
      manifestBytes: input.manifestBytes,
    });
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), successRunsAfterFirst + 1);
    assert.equal(await countHoldingV2ReconcileRuns(pool, "success"), 1);
    await pool.end();
  });
});
