import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { upsertWholesaleEmployeeRoster } from "../../src/onec-clients/roster-upsert";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { runAuthoritativeWholesaleOrgRebuild } from "../../src/onec-clients/run-authoritative-org-rebuild";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";

const LEADER = "44444444-4444-4444-8444-444444444444";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const GHOST = "99999999-9999-4999-8999-999999999999";
const TEAM_OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function authoritativeEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PGSSLMODE: "disable",
    TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT: "1",
  };
}

function initialPartialRosterBytes() {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(MEMBER, {
      name_manager: "Legacy Member",
      guid_team: TEAM_OLD,
      name_team: "Legacy Team",
    }),
    buildEmployeeRosterEntry(LEADER, {
      name_manager: "Legacy Leader",
      post: "Руководитель отдела продаж",
      guid_team: TEAM_OLD,
      name_team: "Legacy Team",
    }),
    buildEmployeeRosterEntry(GHOST, { name_manager: "Ghost Linked" }),
  ]);
}

function authoritativeSnapshotV1() {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(LEADER, {
      name_manager: "Leader V1",
      team: [{ guid_team: TEAM_NEW, name_team: "Team New", guid_team_leader: LEADER, name_team_leader: "Leader V1" }],
    }),
    buildEmployeeRosterEntry(MEMBER, {
      name_manager: "Member V1",
      team: [{ guid_team: TEAM_NEW, name_team: "Team New", guid_team_leader: LEADER }],
    }),
  ]);
}

function authoritativeSnapshotV2() {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(LEADER, {
      name_manager: "Leader V2",
      team: [{ guid_team: TEAM_NEW, name_team: "Team Renamed", guid_team_leader: LEADER, name_team_leader: "Leader V2" }],
    }),
    buildEmployeeRosterEntry(MEMBER, {
      name_manager: "Member V2",
      team: [],
    }),
  ]);
}

async function countTable(pool: Pool, table: string): Promise<number> {
  const row = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(row.rows[0]?.count ?? 0);
}

async function fingerprintUsersLinks(pool: Pool): Promise<string> {
  const parts = await Promise.all([countTable(pool, "users"), countTable(pool, "user_onec_employee_links")]);
  return parts.join("|");
}

describe("authoritative wholesale org rebuild", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      const parsed = parseWholesaleEmployeeRosterBytes(initialPartialRosterBytes());
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;
      await client.query("BEGIN");
      await upsertWholesaleEmployeeRoster(client, parsed.roster);
      await client.query(
        `INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader, imported_at)
         VALUES ($1::uuid, 'Legacy Team', $2::uuid, 'Legacy Leader', NOW())`,
        [TEAM_OLD, LEADER],
      );
      await client.query(
        `INSERT INTO onec_wholesale_employee_team_memberships (guid_manager, guid_team, name_team, imported_at)
         VALUES ($1::uuid, $2::uuid, 'Legacy Team', NOW()), ($3::uuid, $2::uuid, 'Legacy Team', NOW())`,
        [MEMBER, TEAM_OLD, LEADER],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
      await pool.end();
    }

    const user = await createTestUser({
      databaseUrl,
      email: "ghost-linked@example.test",
      password: "StrongPass123!",
      fullName: "Ghost Linked",
    });
    await linkUserToEmployee({ databaseUrl, userId: user.id, employeeGuid: GHOST });
  });

  after(async () => {
    await closePool();
  });

  it("dry-run then apply replaces org projection and preserves links", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const beforeFp = await fingerprintUsersLinks(pool);
    await pool.end();

    const rosterV1 = authoritativeSnapshotV1();
    const dry = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes: rosterV1,
    });
    assert.equal(dry.status, "SUCCESS", dry.message);
    assert.ok(dry.targetDbFingerprint);
    assert.equal(dry.plan?.previousTeamGroupCount, 1);
    assert.equal(dry.plan?.teamGroupCount, 1);

    const applied = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: [
        "--apply",
        "--employee-roster",
        "/dev/null",
        "--expected-roster-sha256",
        dry.rosterSourceSha256!,
        "--confirm-target-db",
        dry.targetDbFingerprint!,
      ],
      rosterBytes: rosterV1,
    });
    assert.equal(applied.status, "SUCCESS", applied.message);

    const verifyPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const groups = await verifyPool.query<{ guid_team: string; name_team: string | null }>(
      `SELECT guid_team::text, name_team FROM onec_wholesale_team_groups ORDER BY guid_team`,
    );
    assert.equal(groups.rows.length, 1);
    assert.equal(groups.rows[0]?.guid_team.toLowerCase(), TEAM_NEW.toLowerCase());
    assert.equal(groups.rows[0]?.name_team, "Team New");

    const oldMemberships = await verifyPool.query(
      `SELECT 1 FROM onec_wholesale_employee_team_memberships WHERE guid_team = $1::uuid`,
      [TEAM_OLD],
    );
    assert.equal(oldMemberships.rowCount, 0);

    const ghost = await verifyPool.query<{ guid_manager: string }>(
      `SELECT guid_manager::text FROM onec_wholesale_employee_roster WHERE lower(guid_manager::text) = $1`,
      [GHOST.toLowerCase()],
    );
    assert.equal(ghost.rowCount, 1);

    const ghostMemberships = await verifyPool.query(
      `SELECT 1 FROM onec_wholesale_employee_team_memberships WHERE lower(guid_manager::text) = $1`,
      [GHOST.toLowerCase()],
    );
    assert.equal(ghostMemberships.rowCount, 0);

    const afterFp = await fingerprintUsersLinks(verifyPool);
    await verifyPool.end();
    assert.equal(afterFp, beforeFp);
  });

  it("second applied update mutates org without reviving legacy teams", async () => {
    const rosterV2 = authoritativeSnapshotV2();
    const dry = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes: rosterV2,
    });
    assert.equal(dry.status, "SUCCESS");
    const applied = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: [
        "--apply",
        "--employee-roster",
        "/dev/null",
        "--expected-roster-sha256",
        dry.rosterSourceSha256!,
        "--confirm-target-db",
        dry.targetDbFingerprint!,
      ],
      rosterBytes: rosterV2,
    });
    assert.equal(applied.status, "SUCCESS", applied.message);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const group = await pool.query<{ name_team: string | null }>(
      `SELECT name_team FROM onec_wholesale_team_groups WHERE guid_team = $1::uuid`,
      [TEAM_NEW],
    );
    assert.equal(group.rows[0]?.name_team, "Team Renamed");
    const memberMemberships = await pool.query(
      `SELECT 1 FROM onec_wholesale_employee_team_memberships WHERE lower(guid_manager::text) = $1`,
      [MEMBER.toLowerCase()],
    );
    assert.equal(memberMemberships.rowCount, 0);
    await pool.end();
  });

  it("rejects apply when roster hash changed since dry-run", async () => {
    const dry = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes: authoritativeSnapshotV2(),
    });
    assert.equal(dry.status, "SUCCESS");
    const rejected = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: [
        "--apply",
        "--employee-roster",
        "/dev/null",
        "--expected-roster-sha256",
        "0".repeat(64),
        "--confirm-target-db",
        dry.targetDbFingerprint!,
      ],
      rosterBytes: authoritativeSnapshotV2(),
    });
    assert.equal(rejected.status, "REJECTED_BY_CHECKS");
    assert.equal(rejected.errorCode, "ROSTER_SHA256_MISMATCH");
  });

  it("validation failure leaves previous org snapshot intact", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const beforeGroups = await countTable(pool, "onec_wholesale_team_groups");
    await pool.end();

    const invalid = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MEMBER, { team: [{ guid_team: TEAM_NEW, guid_team_leader: LEADER }] }),
    ]);
    const result = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--apply", "--employee-roster", "/dev/null", "--expected-roster-sha256", "f".repeat(64), "--confirm-target-db", "f".repeat(64)],
      rosterBytes: invalid,
    });
    assert.equal(result.status, "VALIDATION_FAILED");

    const verifyPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const afterGroups = await countTable(verifyPool, "onec_wholesale_team_groups");
    await verifyPool.end();
    assert.equal(afterGroups, beforeGroups);
  });
});
