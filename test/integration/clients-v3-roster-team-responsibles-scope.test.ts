import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { OrgStructureAccessError } from "../../src/clients/org/structure-repository";
import { listV3RopResponsibles } from "../../src/clients/v3/teams-structure";
import { applyAuthoritativeWholesaleOrgSnapshot } from "../../src/onec-clients/roster-authoritative-org";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import type { AccessContext } from "../../src/access/types";

const LEADER_A = "44444444-4444-4444-8444-444444444444";
const LEADER_B = "55555555-5555-4555-8555-555555555555";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEAM_A2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEMBER_A = "22222222-2222-4222-8222-222222222222";
const MEMBER_B = "33333333-3333-4333-8333-333333333333";
const SHARED = "77777777-7777-4777-8777-777777777777";
const MISSING_TEAM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

function ropContext(userId: string, employeeId: string): AccessContext {
  return {
    userId,
    role: "rop",
    status: "active",
    employeeId,
    employeeLinkConflict: false,
    hasEmployeeLink: true,
    hasScopedClientAccess: false,
    fullClientBase: false,
    explicitlyDeniedAll: false,
  };
}

function orgRosterBytes() {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(LEADER_A, {
      name_manager: "Leader A",
      team: [
        { guid_team: TEAM_A, name_team: "Team A", guid_team_leader: LEADER_A, name_team_leader: "Leader A" },
        { guid_team: TEAM_A2, name_team: "Team A2", guid_team_leader: LEADER_A, name_team_leader: "Leader A" },
      ],
    }),
    buildEmployeeRosterEntry(LEADER_B, {
      name_manager: "Leader B",
      team: [{ guid_team: TEAM_B, name_team: "Team B", guid_team_leader: LEADER_B, name_team_leader: "Leader B" }],
    }),
    buildEmployeeRosterEntry(MEMBER_A, {
      name_manager: "Member A",
      team: [{ guid_team: TEAM_A, name_team: "Team A", guid_team_leader: LEADER_A }],
    }),
    buildEmployeeRosterEntry(MEMBER_B, {
      name_manager: "Member B",
      team: [{ guid_team: TEAM_B, name_team: "Team B", guid_team_leader: LEADER_B }],
    }),
    buildEmployeeRosterEntry(SHARED, {
      name_manager: "Shared Member",
      team: [
        { guid_team: TEAM_A, name_team: "Team A", guid_team_leader: LEADER_A },
        { guid_team: TEAM_B, name_team: "Team B", guid_team_leader: LEADER_B },
      ],
    }),
  ]);
}

describe("v3 roster team responsibles teamGuid scope", { concurrency: false }, () => {
  let databaseUrl = "";
  let adminUserId = "";
  let ropLeaderAUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-team-scope@example.test",
      password: "StrongPass123!",
      fullName: "Admin Team Scope",
      role: "admin",
    });
    adminUserId = admin.id;

    const ropLeaderA = await createTestUser({
      databaseUrl,
      email: "rop-a-scope@example.test",
      password: "StrongPass123!",
      fullName: "ROP Leader A",
      role: "rop",
    });
    ropLeaderAUserId = ropLeaderA.id;
    await linkUserToEmployee({
      databaseUrl,
      userId: ropLeaderAUserId,
      employeeId: LEADER_A,
      confirmedByUserId: adminUserId,
    });

    const parsed = parseWholesaleEmployeeRosterBytes(orgRosterBytes());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyAuthoritativeWholesaleOrgSnapshot(client, parsed.roster);
      await client.query(
        `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count, imported_at)
         VALUES (1, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET employee_count = EXCLUDED.employee_count, imported_at = NOW()`,
        [parsed.roster.sourceSha256, parsed.roster.wholesaleCount],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
      await pool.end();
    }
  });

  after(async () => {
    await closePool();
  });

  it("allows own team for leader and admin", async () => {
    const ctx = adminContext(adminUserId);
    const items = await listV3RopResponsibles(ctx, LEADER_A, { teamGuid: TEAM_A });
    const guids = items.map((i) => i.employeeGuid.toLowerCase()).sort();
    assert.deepEqual(guids, [MEMBER_A.toLowerCase(), SHARED.toLowerCase()].sort());
  });

  it("returns empty list for missing teamGuid", async () => {
    const ctx = adminContext(adminUserId);
    const items = await listV3RopResponsibles(ctx, LEADER_A, { teamGuid: MISSING_TEAM });
    assert.equal(items.length, 0);
  });

  it("forbids foreign teamGuid for requested leader", async () => {
    const ctx = adminContext(adminUserId);
    await assert.rejects(
      () => listV3RopResponsibles(ctx, LEADER_A, { teamGuid: TEAM_B }),
      (error: unknown) => {
        assert.ok(error instanceof OrgStructureAccessError);
        assert.equal(error.code, "FORBIDDEN");
        return true;
      },
    );
  });

  it("forbids rop impersonation of another leader branch", async () => {
    const ctx = ropContext(ropLeaderAUserId, LEADER_A);
    await assert.rejects(
      () => listV3RopResponsibles(ctx, LEADER_B, { teamGuid: TEAM_B }),
      (error: unknown) => {
        assert.ok(error instanceof OrgStructureAccessError);
        assert.equal(error.code, "FORBIDDEN");
        return true;
      },
    );
  });

  it("forbids rop own guid with foreign teamGuid", async () => {
    const ctx = ropContext(ropLeaderAUserId, LEADER_A);
    await assert.rejects(
      () => listV3RopResponsibles(ctx, LEADER_A, { teamGuid: TEAM_B }),
      (error: unknown) => error instanceof OrgStructureAccessError && error.code === "FORBIDDEN",
    );
  });

  it("supports multiple teams for one leader and shared member across teams", async () => {
    const ctx = adminContext(adminUserId);
    const teamA2 = await listV3RopResponsibles(ctx, LEADER_A, { teamGuid: TEAM_A2 });
    assert.equal(teamA2.length, 0);
    const teamB = await listV3RopResponsibles(ctx, LEADER_B, { teamGuid: TEAM_B });
    assert.deepEqual(
      teamB.map((i) => i.employeeGuid.toLowerCase()).sort(),
      [MEMBER_B.toLowerCase(), SHARED.toLowerCase()].sort(),
    );
  });
});
