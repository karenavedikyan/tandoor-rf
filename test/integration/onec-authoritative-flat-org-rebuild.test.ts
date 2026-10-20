import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { getV3OrgStructureOverview, listV3RopResponsibles } from "../../src/clients/v3/teams-structure";
import { runAuthoritativeWholesaleOrgRebuild } from "../../src/onec-clients/run-authoritative-org-rebuild";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import {
  buildFullFlatOrgHierarchyRosterBytes,
  FLAT_ORG,
  FLAT_ORG_APEX_TEAM_LEADER_GUIDS,
  FLAT_ORG_EXPECTED_TEAM_GUIDS,
  FLAT_ORG_GUSLEVA_MEMBER_GUIDS,
  FULL_FLAT_ORG_EXPECTED,
} from "../helpers/flat-org-hierarchy-fixtures";
import type { AccessContext } from "../../src/access/types";

const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const LEADER_TO_TEAM: ReadonlyArray<readonly [string, string]> = [
  [FLAT_ORG.KOMKOV, FLAT_ORG.TEAM_KOMKOV],
  [FLAT_ORG.ROGOLEV, FLAT_ORG.TEAM_ROGOLEV],
  [FLAT_ORG.TALIURI, FLAT_ORG.TEAM_TALIURI],
  [FLAT_ORG.SKALABAN, FLAT_ORG.TEAM_SKALABAN],
  [FLAT_ORG.GUSLEVA, FLAT_ORG.TEAM_GUSLEVA],
  [FLAT_ORG.SAPOZHKOV, FLAT_ORG.TEAM_SAPOZHKOV],
  [FLAT_ORG.KUPIANSKY, FLAT_ORG.TEAM_KUPIANSKY],
];

function authoritativeEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PGSSLMODE: "disable",
    TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT: "1",
  };
}

function adminContext(userId: string): AccessContext {
  return {
    userId,
    role: "admin",
    status: "active",
    employeeId: null,
    employeeLinkConflict: false,
    hasEmployeeLink: false,
    hasScopedClientAccess: false,
    fullClientBase: true,
    explicitlyDeniedAll: false,
  };
}

async function countTable(pool: Pool, table: string): Promise<number> {
  const row = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(row.rows[0]?.count ?? 0);
}

describe("authoritative flat org rebuild", { concurrency: false }, () => {
  let databaseUrl = "";
  let adminUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-flat-org@example.test",
      password: "StrongPass123!",
      fullName: "Admin Flat Org",
      role: "admin",
    });
    adminUserId = admin.id;
  });

  after(async () => {
    await closePool();
  });

  it("apply flat snapshot writes expected groups and memberships", async () => {
    const rosterBytes = buildFullFlatOrgHierarchyRosterBytes();
    const dry = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes,
    });
    assert.equal(dry.status, "SUCCESS", dry.message);

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
      rosterBytes,
    });
    assert.equal(applied.status, "SUCCESS", applied.message);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const groupGuids = (
      await pool.query<{ guid_team: string }>(
        `SELECT guid_team::text FROM onec_wholesale_team_groups ORDER BY guid_team`,
      )
    ).rows.map((row) => row.guid_team.toLowerCase());
    assert.deepEqual(
      groupGuids.sort(),
      FLAT_ORG_EXPECTED_TEAM_GUIDS.map((g) => g.toLowerCase()).sort(),
    );

    const apexMemberships = await pool.query<{ guid_manager: string }>(
      `SELECT guid_manager::text FROM onec_wholesale_employee_team_memberships WHERE guid_team = $1::uuid ORDER BY guid_manager`,
      [FLAT_ORG.TEAM_APEX],
    );
    assert.equal(apexMemberships.rowCount, FLAT_ORG_APEX_TEAM_LEADER_GUIDS.length);
    const apexMemberGuids = apexMemberships.rows.map((row) => row.guid_manager.toLowerCase()).sort();
    assert.deepEqual(
      apexMemberGuids,
      [...FLAT_ORG_APEX_TEAM_LEADER_GUIDS].map((g) => g.toLowerCase()).sort(),
    );

    const guslevaTeamMembers = await pool.query<{ guid_manager: string }>(
      `SELECT guid_manager::text FROM onec_wholesale_employee_team_memberships WHERE guid_team = $1::uuid ORDER BY guid_manager`,
      [FLAT_ORG.TEAM_GUSLEVA],
    );
    assert.equal(guslevaTeamMembers.rowCount, FLAT_ORG_GUSLEVA_MEMBER_GUIDS.length);
    assert.deepEqual(
      guslevaTeamMembers.rows.map((row) => row.guid_manager.toLowerCase()).sort(),
      [...FLAT_ORG_GUSLEVA_MEMBER_GUIDS].map((g) => g.toLowerCase()).sort(),
    );

    for (const [leaderGuid, teamGuid] of LEADER_TO_TEAM) {
      const selfMembership = await pool.query(
        `SELECT 1 FROM onec_wholesale_employee_team_memberships WHERE lower(guid_manager::text) = $1 AND guid_team = $2::uuid`,
        [leaderGuid.toLowerCase(), teamGuid],
      );
      assert.equal(selfMembership.rowCount, 0, `self membership for ${leaderGuid}`);
    }

    assert.equal(await countTable(pool, "onec_wholesale_team_groups"), FULL_FLAT_ORG_EXPECTED.teamGroupCount);
    assert.equal(
      await countTable(pool, "onec_wholesale_employee_team_memberships"),
      FULL_FLAT_ORG_EXPECTED.membershipCount,
    );

    await pool.end();
  });

  it("rejected invalid flat snapshot leaves org projection unchanged", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const beforeGroups = await countTable(pool, "onec_wholesale_team_groups");
    const beforeMemberships = await countTable(pool, "onec_wholesale_employee_team_memberships");
    await pool.end();

    const invalid = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry("33333333-3333-4333-8333-333333333333", {
        guid_team: TEAM,
        name_team: "Synthetic team",
        guid_team_leader: "not-a-guid",
        name_team_leader: "Invalid leader",
      }),
    ]);

    const result = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: [
        "--apply",
        "--employee-roster",
        "/dev/null",
        "--expected-roster-sha256",
        "f".repeat(64),
        "--confirm-target-db",
        "f".repeat(64),
      ],
      rosterBytes: invalid,
    });
    assert.equal(result.status, "VALIDATION_FAILED");
    assert.equal(result.errorCode, "FLAT_TEAM_FIELD_INVALID_UUID");
    assert.match(result.message ?? "", /invalid UUID in flat guid_team_leader/i);

    const verifyPool = new Pool({ connectionString: databaseUrl, max: 1 });
    assert.equal(await countTable(verifyPool, "onec_wholesale_team_groups"), beforeGroups);
    assert.equal(await countTable(verifyPool, "onec_wholesale_employee_team_memberships"), beforeMemberships);
    await verifyPool.end();
  });

  it("reapply flat snapshot is idempotent for memberships and preserves linked accounts", async () => {
    const rosterBytes = buildFullFlatOrgHierarchyRosterBytes();
    const dry = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes,
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
      rosterBytes,
    });
    assert.equal(applied.status, "SUCCESS", applied.message);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const membershipCountAfterFirst = await countTable(pool, "onec_wholesale_employee_team_memberships");
    const linksAfterFirst = await countTable(pool, "user_onec_employee_links");
    await pool.end();

    const dry2 = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes,
    });
    const applied2 = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: [
        "--apply",
        "--employee-roster",
        "/dev/null",
        "--expected-roster-sha256",
        dry2.rosterSourceSha256!,
        "--confirm-target-db",
        dry2.targetDbFingerprint!,
      ],
      rosterBytes,
    });
    assert.equal(applied2.status, "SUCCESS", applied2.message);

    const verifyPool = new Pool({ connectionString: databaseUrl, max: 1 });
    assert.equal(
      await countTable(verifyPool, "onec_wholesale_employee_team_memberships"),
      membershipCountAfterFirst,
    );
    assert.equal(await countTable(verifyPool, "user_onec_employee_links"), linksAfterFirst);
    await verifyPool.end();
  });

  it("supports director overview and team-scoped responsibles after flat snapshot", async () => {
    const ctx = adminContext(adminUserId);
    const overview = await getV3OrgStructureOverview(ctx);
    assert.ok(overview.director);
    assert.equal(overview.director?.employeeGuid.toLowerCase(), FLAT_ORG.APEX.toLowerCase());
    assert.equal(overview.rops.length, FLAT_ORG_APEX_TEAM_LEADER_GUIDS.length);
    assert.ok(overview.rops.some((rop) => rop.employeeGuid.toLowerCase() === FLAT_ORG.GUSLEVA.toLowerCase()));
    const morozova = overview.rops.find(
      (rop) => rop.employeeGuid.toLowerCase() === FLAT_ORG.MOROZOVA.toLowerCase(),
    );
    assert.ok(morozova, "apex direct without own team group must appear in overview");
    assert.equal(morozova?.teamGuid, undefined);
    assert.equal(morozova?.teamMemberCount, 0);

    const guslevaTeam = await listV3RopResponsibles(ctx, FLAT_ORG.GUSLEVA, { teamGuid: FLAT_ORG.TEAM_GUSLEVA });
    assert.equal(guslevaTeam.length, FLAT_ORG_GUSLEVA_MEMBER_GUIDS.length);
    assert.deepEqual(
      guslevaTeam.map((item) => item.employeeGuid.toLowerCase()).sort(),
      [...FLAT_ORG_GUSLEVA_MEMBER_GUIDS].map((g) => g.toLowerCase()).sort(),
    );

    const komkovTeam = await listV3RopResponsibles(ctx, FLAT_ORG.KOMKOV, { teamGuid: FLAT_ORG.TEAM_KOMKOV });
    assert.equal(komkovTeam.length, 1);
    assert.equal(komkovTeam[0]?.employeeGuid.toLowerCase(), FLAT_ORG.STRELNikov.toLowerCase());
  });
});
