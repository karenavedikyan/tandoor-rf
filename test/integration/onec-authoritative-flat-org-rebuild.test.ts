import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { runAuthoritativeWholesaleOrgRebuild } from "../../src/onec-clients/run-authoritative-org-rebuild";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import {
  buildFullFlatOrgHierarchyRosterBytes,
  FLAT_ORG,
  FULL_FLAT_ORG_EXPECTED,
} from "../helpers/flat-org-hierarchy-fixtures";

function authoritativeEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PGSSLMODE: "disable",
    TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT: "1",
  };
}

describe("authoritative flat org rebuild", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();
  });

  after(async () => {
    await closePool();
  });

  it("apply flat snapshot writes groups and memberships without apex mass membership", async () => {
    const rosterBytes = buildFullFlatOrgHierarchyRosterBytes();
    const parsed = parseWholesaleEmployeeRosterBytes(rosterBytes);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const dry = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes,
    });
    assert.equal(dry.status, "SUCCESS", dry.message);
    assert.equal(dry.plan?.employeeCount, FULL_FLAT_ORG_EXPECTED.employeeCount);
    assert.equal(dry.plan?.teamGroupCount, FULL_FLAT_ORG_EXPECTED.teamGroupCount);
    assert.equal(dry.plan?.membershipCount, FULL_FLAT_ORG_EXPECTED.membershipCount);

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
    const groupCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_wholesale_team_groups`,
    );
    assert.equal(Number(groupCount.rows[0]?.count ?? 0), FULL_FLAT_ORG_EXPECTED.teamGroupCount);

    const membershipCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_team_memberships`,
    );
    assert.equal(Number(membershipCount.rows[0]?.count ?? 0), FULL_FLAT_ORG_EXPECTED.membershipCount);

    const apexMemberships = await pool.query(
      `SELECT 1 FROM onec_wholesale_employee_team_memberships WHERE lower(guid_manager::text) = $1`,
      [FLAT_ORG.APEX.toLowerCase()],
    );
    assert.equal(apexMemberships.rowCount, 0);

    const guslevaTeamMembers = await pool.query<{ guid_manager: string }>(
      `SELECT guid_manager::text FROM onec_wholesale_employee_team_memberships WHERE guid_team = $1::uuid ORDER BY guid_manager`,
      [FLAT_ORG.TEAM_GUSLEVA],
    );
    assert.equal(guslevaTeamMembers.rowCount, 5);

    await pool.end();
  });
});
