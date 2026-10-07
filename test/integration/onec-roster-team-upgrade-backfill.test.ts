import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { runRegularUpdate } from "../../src/onec-regular-update/run-update";
import type { RegularUpdateConfig } from "../../src/onec-regular-update/config";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { sha256Hex } from "../../src/onec-clients/sha256";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { buildExportManifestBytes } from "../helpers/onec-export-manifest-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

async function dryRunBundle(databaseUrl: string, clientsBytes: Buffer, rosterBytes: Buffer) {
  const input = bundle(clientsBytes, rosterBytes);
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
  clientsBytes: Buffer,
  rosterBytes: Buffer,
  expectedFingerprint: string,
  applyTestHooks?: Parameters<typeof runRegularUpdate>[0]["applyTestHooks"],
) {
  const input = bundle(clientsBytes, rosterBytes);
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

async function readTeamRow(databaseUrl: string, managerGuid: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ guid_team: string | null; name_team: string | null }>(
    `
      SELECT guid_team::text, name_team
      FROM onec_wholesale_employee_roster
      WHERE guid_manager = $1::uuid
    `,
    [managerGuid],
  );
  await pool.end();
  return row.rows[0] ?? null;
}

/** Simulates post-migration state: roster accepted pre-G1, team columns empty, raw_json intact. */
async function simulatePreG1TeamColumnState(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      UPDATE onec_wholesale_employee_roster
      SET guid_team = NULL, name_team = NULL
      WHERE guid_team IS NOT NULL OR name_team IS NOT NULL
    `,
  );
  await pool.end();
}

async function countSuccessfulApplyRuns(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("onec roster team upgrade backfill integration", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("A: backfills team columns from unchanged file after pre-G1 storage gap", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const input = bundle(clientsBytes, rosterBytes);
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    assert.equal(dryRun.status, "SUCCESS");

    const initialApply = await applyBundle(
      databaseUrl,
      clientsBytes,
      rosterBytes,
      dryRun.verificationFingerprint!,
    );
    assert.equal(initialApply.status, "SUCCESS");

    await simulatePreG1TeamColumnState(databaseUrl);
    const cleared = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(cleared?.guid_team, null);
    assert.equal(cleared?.name_team, null);

    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    const backfill = await applyBundle(
      databaseUrl,
      clientsBytes,
      rosterBytes,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(backfill.status, "SUCCESS");
    assert.equal(backfill.counts?.employeesChanged, 1);

    const row = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(row?.guid_team, TEAM_A);
    assert.equal(row?.name_team, "Team Alpha");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 2);
    assert.equal(backfillDry.verificationFingerprint, dryRun.verificationFingerprint);
  });

  it("B: returns NO_CHANGES after backfill without another write", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    await applyBundle(databaseUrl, clientsBytes, rosterBytes, dryRun.verificationFingerprint!);
    await simulatePreG1TeamColumnState(databaseUrl);

    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    await applyBundle(databaseUrl, clientsBytes, rosterBytes, backfillDry.verificationFingerprint!);

    const repeatDry = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    const repeat = await applyBundle(
      databaseUrl,
      clientsBytes,
      rosterBytes,
      repeatDry.verificationFingerprint!,
    );
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 2);
  });

  it("C: does not re-apply when team fields are absent or correctly empty", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterWithoutTeam = buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER_A)]);
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, rosterWithoutTeam);
    await applyBundle(databaseUrl, clientsBytes, rosterWithoutTeam, dryRun.verificationFingerprint!);

    const repeat = await applyBundle(
      databaseUrl,
      clientsBytes,
      rosterWithoutTeam,
      dryRun.verificationFingerprint!,
    );
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 1);

    const clearedRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: "" }),
    ]);
    const clearedDry = await dryRunBundle(databaseUrl, clientsBytes, clearedRoster);
    const clearedApply = await applyBundle(
      databaseUrl,
      clientsBytes,
      clearedRoster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedApply.status, "SUCCESS");

    const clearedRepeat = await applyBundle(
      databaseUrl,
      clientsBytes,
      clearedRoster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedRepeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 2);
  });

  it("D: rolls back and preserves pre-upgrade team columns on apply failure", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    await applyBundle(databaseUrl, clientsBytes, rosterBytes, dryRun.verificationFingerprint!);
    await simulatePreG1TeamColumnState(databaseUrl);

    const before = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(before?.guid_team, null);

    const failed = await applyBundle(
      databaseUrl,
      clientsBytes,
      rosterBytes,
      dryRun.verificationFingerprint!,
      { afterRecordIndex: 0 },
    );
    assert.equal(failed.status, "ERROR");

    const after = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(after?.guid_team, null);
    assert.equal(after?.name_team, null);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 1);
  });
});
