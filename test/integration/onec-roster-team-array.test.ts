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
const MANAGER_B = "33333333-3333-4333-8333-333333333333";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEADER = "44444444-4444-4444-8444-444444444444";

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

async function applyBundle(databaseUrl: string, clientsBytes: Buffer, rosterBytes: Buffer) {
  const manifestBytes = buildExportManifestBytes({
    clientsSha256: sha256Hex(clientsBytes),
    rosterSha256: sha256Hex(rosterBytes),
  });
  const dryRun = await runRegularUpdate({
    env: ftpEnv(databaseUrl),
    argv: ["--dry-run"],
    config: testConfig,
    clientsBytes,
    employeeRosterBytes: rosterBytes,
    manifestBytes,
  });
  assert.equal(dryRun.status, "SUCCESS");
  return runRegularUpdate({
    env: ftpEnv(databaseUrl),
    argv: ["--apply", "--expected-fingerprint", dryRun.verificationFingerprint!],
    config: testConfig,
    clientsBytes,
    employeeRosterBytes: rosterBytes,
    manifestBytes,
  });
}

describe("onec roster team[] integration", { concurrency: false }, () => {
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

  it("stores multiple memberships and leader metadata", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, {
        team: [{ guid_team: TEAM_A, name_team: "Alpha", guid_team_leader: LEADER, name_team_leader: "Leader" }],
      }),
      buildEmployeeRosterEntry(MANAGER_B, {
        team: [{ guid_team: TEAM_B, name_team: "Beta" }],
      }),
      buildEmployeeRosterEntry(LEADER, { name_manager: "Leader Person" }),
    ]);
    const applied = await applyBundle(databaseUrl, clientsBytes, rosterBytes);
    assert.equal(applied.status, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const memberships = await pool.query<{ guid_team: string }>(
      `SELECT lower(guid_team::text) AS guid_team FROM onec_wholesale_employee_team_memberships WHERE guid_manager = $1::uuid`,
      [MANAGER_A],
    );
    const leader = await pool.query<{ guid_team_leader: string | null }>(
      `SELECT lower(guid_team_leader::text) AS guid_team_leader FROM onec_wholesale_team_groups WHERE guid_team = $1::uuid`,
      [TEAM_A],
    );
    await pool.end();
    assert.equal(memberships.rows[0]?.guid_team, TEAM_A);
    assert.equal(leader.rows[0]?.guid_team_leader, LEADER);
  });

  it("returns NO_CHANGES after same-file re-apply with team[] backfill gap", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, {
        team: [{ guid_team: TEAM_A, name_team: "Alpha" }],
      }),
    ]);
    await applyBundle(databaseUrl, clientsBytes, rosterBytes);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DELETE FROM onec_wholesale_employee_team_memberships`);
    await pool.end();

    const second = await applyBundle(databaseUrl, clientsBytes, rosterBytes);
    assert.equal(second.status, "SUCCESS");
    const thirdDry = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--dry-run"],
      config: testConfig,
      clientsBytes,
      employeeRosterBytes: rosterBytes,
      manifestBytes: buildExportManifestBytes({
        clientsSha256: sha256Hex(clientsBytes),
        rosterSha256: sha256Hex(rosterBytes),
      }),
    });
    const third = await runRegularUpdate({
      env: ftpEnv(databaseUrl),
      argv: ["--apply", "--expected-fingerprint", thirdDry.verificationFingerprint!],
      config: testConfig,
      clientsBytes,
      employeeRosterBytes: rosterBytes,
      manifestBytes: buildExportManifestBytes({
        clientsSha256: sha256Hex(clientsBytes),
        rosterSha256: sha256Hex(rosterBytes),
      }),
    });
    assert.equal(third.status, "NO_CHANGES");
  });

  it("preserves legacy memberships after 039-shaped storage when team key is omitted", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const legacyRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Alpha" }),
    ]);
    await applyBundle(databaseUrl, clientsBytes, legacyRoster);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DELETE FROM onec_wholesale_employee_team_memberships`);
    await pool.query(`DELETE FROM onec_wholesale_team_groups`);
    await pool.end();

    const partialRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Manager A Updated" }),
    ]);
    const second = await applyBundle(databaseUrl, clientsBytes, partialRoster);
    assert.equal(second.status, "SUCCESS");

    const verify = new Pool({ connectionString: databaseUrl, max: 1 });
    const memberships = await verify.query<{ guid_team: string }>(
      `SELECT lower(guid_team::text) AS guid_team FROM onec_wholesale_employee_team_memberships WHERE guid_manager = $1::uuid`,
      [MANAGER_A],
    );
    await verify.end();
    assert.equal(memberships.rows[0]?.guid_team, TEAM_A);
  });

  it("updates legacy name_team without clearing 039-shaped membership and stabilizes re-apply", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const legacyRoster = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Alpha" }),
    ]);
    await applyBundle(databaseUrl, clientsBytes, legacyRoster);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DELETE FROM onec_wholesale_employee_team_memberships`);
    await pool.query(`DELETE FROM onec_wholesale_team_groups`);
    await pool.end();

    const renamed = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_team: "Alpha Renamed" }),
    ]);
    const first = await applyBundle(databaseUrl, clientsBytes, renamed);
    assert.equal(first.status, "SUCCESS");

    const verify = new Pool({ connectionString: databaseUrl, max: 1 });
    const rosterRow = await verify.query<{ guid_team: string | null; name_team: string | null }>(
      `SELECT lower(guid_team::text) AS guid_team, name_team FROM onec_wholesale_employee_roster WHERE guid_manager = $1::uuid`,
      [MANAGER_A],
    );
    const memberships = await verify.query<{ guid_team: string; name_team: string | null }>(
      `SELECT lower(guid_team::text) AS guid_team, name_team FROM onec_wholesale_employee_team_memberships WHERE guid_manager = $1::uuid`,
      [MANAGER_A],
    );
    const groupRow = await verify.query<{ name_team: string | null }>(
      `SELECT name_team FROM onec_wholesale_team_groups WHERE guid_team = $1::uuid`,
      [TEAM_A],
    );
    await verify.end();
    assert.equal(rosterRow.rows[0]?.guid_team, TEAM_A);
    assert.equal(rosterRow.rows[0]?.name_team, "Alpha Renamed");
    assert.equal(memberships.rows[0]?.guid_team, TEAM_A);
    assert.equal(memberships.rows[0]?.name_team, "Alpha Renamed");
    assert.equal(groupRow.rows[0]?.name_team, "Alpha Renamed");

    const second = await applyBundle(databaseUrl, clientsBytes, renamed);
    assert.equal(second.status, "NO_CHANGES");
  });

  it("clears memberships on explicit legacy guid_team null without team[]", async () => {
    const clientsBytes = buildClientsFileBytes([sampleClient()]);
    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: TEAM_A, name_team: "Alpha" }),
    ]);
    await applyBundle(databaseUrl, clientsBytes, rosterBytes);

    const cleared = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { guid_team: null, name_team: null }),
    ]);
    const applied = await applyBundle(databaseUrl, clientsBytes, cleared);
    assert.equal(applied.status, "SUCCESS");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_team_memberships WHERE guid_manager = $1::uuid`,
      [MANAGER_A],
    );
    await pool.end();
    assert.equal(count.rows[0]?.count, "0");
  });
});
