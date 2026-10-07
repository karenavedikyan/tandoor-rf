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
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
) {
  const input = bundle(clientsBytes, rosterBytes);
  return runRegularUpdate({
    env: ftpEnv(databaseUrl),
    argv: ["--apply", "--expected-fingerprint", expectedFingerprint],
    config: testConfig,
    clientsBytes: input.clientsBytes,
    employeeRosterBytes: input.rosterBytes,
    manifestBytes: input.manifestBytes,
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

describe("onec roster team fields integration", { concurrency: false }, () => {
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

  it("assigns team A then team B with employeesChanged", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const initialRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const initialDry = await dryRunBundle(databaseUrl, clientsBytes, initialRoster);
    assert.equal(initialDry.status, "SUCCESS");
    const initialApply = await applyBundle(
      databaseUrl,
      clientsBytes,
      initialRoster,
      initialDry.verificationFingerprint!,
    );
    assert.equal(initialApply.status, "SUCCESS");

    const teamBRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_B, name_team: "Team Beta" }),
    ]);
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, teamBRoster);
    const applied = await applyBundle(databaseUrl, clientsBytes, teamBRoster, dryRun.verificationFingerprint!);
    assert.equal(applied.status, "SUCCESS");
    assert.equal(applied.counts?.employeesChanged, 1);

    const row = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(row?.guid_team, TEAM_B);
    assert.equal(row?.name_team, "Team Beta");
  });

  it("renames team without guid change and preserves omitted fields", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const initialRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const initialDry = await dryRunBundle(databaseUrl, clientsBytes, initialRoster);
    await applyBundle(databaseUrl, clientsBytes, initialRoster, initialDry.verificationFingerprint!);

    const partialRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_team: "Team Alpha Renamed" }),
    ]);
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, partialRoster);
    const applied = await applyBundle(databaseUrl, clientsBytes, partialRoster, dryRun.verificationFingerprint!);
    assert.equal(applied.status, "SUCCESS");
    assert.equal(applied.counts?.employeesChanged, 1);

    const row = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(row?.guid_team, TEAM_A);
    assert.equal(row?.name_team, "Team Alpha Renamed");
  });

  it("clears team on explicit empty guid_team", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const initialRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const initialDry = await dryRunBundle(databaseUrl, clientsBytes, initialRoster);
    await applyBundle(databaseUrl, clientsBytes, initialRoster, initialDry.verificationFingerprint!);

    const clearedRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: "" }),
    ]);
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, clearedRoster);
    const applied = await applyBundle(databaseUrl, clientsBytes, clearedRoster, dryRun.verificationFingerprint!);
    assert.equal(applied.status, "SUCCESS");

    const row = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(row?.guid_team, null);
    assert.equal(row?.name_team, null);
  });

  it("rejects invalid guid_team without changing stored roster", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const initialRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const initialDry = await dryRunBundle(databaseUrl, clientsBytes, initialRoster);
    await applyBundle(databaseUrl, clientsBytes, initialRoster, initialDry.verificationFingerprint!);

    const invalidRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: "not-a-uuid" }),
    ]);
    const rejected = await dryRunBundle(databaseUrl, clientsBytes, invalidRoster);
    assert.equal(rejected.status, "REJECTED_BY_CHECKS");

    const row = await readTeamRow(databaseUrl, MANAGER_A);
    assert.equal(row?.guid_team, TEAM_A);
    assert.equal(row?.name_team, "Team Alpha");
  });

  it("returns NO_CHANGES when repeating the same team assignment", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Team Alpha" }),
    ]);
    const initialDry = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    await applyBundle(databaseUrl, clientsBytes, rosterBytes, initialDry.verificationFingerprint!);

    const repeatDry = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
    const repeat = await applyBundle(databaseUrl, clientsBytes, rosterBytes, repeatDry.verificationFingerprint!);
    assert.equal(repeat.status, "NO_CHANGES");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const runCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'",
    );
    await pool.end();
    assert.equal(Number(runCount.rows[0]?.count), 1);
  });
});
