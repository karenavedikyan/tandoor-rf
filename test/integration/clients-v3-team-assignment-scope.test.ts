import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { listV3RopResponsibles } from "../../src/clients/v3/teams-structure";
import { countDistinctV3TeamPortfolio } from "../../src/clients/v3/team-assignment-counts";
import { applyAuthoritativeWholesaleOrgSnapshot } from "../../src/onec-clients/roster-authoritative-org";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import type { AccessContext } from "../../src/access/types";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const LEADER = "55555555-5555-4555-8555-555555555555";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const REGIONAL = "33333333-3333-4333-8333-333333333333";
const LEGAL_REGIONAL = "c3000000-0000-4000-8000-000000000001";
const LEGAL_MANAGER = "b2000000-0000-4000-8000-000000000001";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
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

function ropContext(userId: string, employeeId: string): AccessContext {
  return {
    userId,
    role: "rop",
    status: "active",
    employeeId,
    employeeLinkConflict: false,
    hasEmployeeLink: true,
    hasScopedClientAccess: true,
    fullClientBase: false,
    explicitlyDeniedAll: false,
  };
}

function clientsBytesForTeamAssignments(): Buffer {
  const base = JSON.parse(loadFixture("all_clients.json").toString("utf8")) as Record<string, unknown>[];
  const legalManager = base.find((row) => row.guid_client === LEGAL_MANAGER) as Record<string, unknown>;
  if (legalManager) {
    legalManager.guid_manager = MANAGER;
    legalManager.name_manager = "Manager Member";
    legalManager.guid_head_of_the_sales_department = "";
    legalManager.name_head_of_the_sales_department = "";
    legalManager.guid_regional_manager = "";
    legalManager.name_regional_manager = "";
  }
  base.push({
    guid_client: LEGAL_REGIONAL,
    name_client: "Legal Regional Only",
    guid_holding: "",
    name_holding: "",
    type_category: { guid_type: "t3", name_type: "Type C", guid_category: "c3", name_category: "Cat C" },
    guid_manager: "",
    name_manager: "",
    guid_head_of_the_sales_department: "",
    name_head_of_the_sales_department: "",
    guid_regional_manager: REGIONAL,
    name_regional_manager: "Regional Member",
    address: "",
    telephone: [],
    Discount: "",
    DiscountAmount: 0,
    markups: [],
    other: {},
  });
  return Buffer.from(JSON.stringify(base), "utf8");
}

const ROP_OWN_EMAIL = "rop-own-scope@example.test";

describe("v3 team assignment counts and list scope", { concurrency: false }, () => {
  let databaseUrl = "";
  let adminUserId = "";
  let ropOwnUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-team-assign@example.test",
      password: TEST_PASSWORD,
      fullName: "Admin Team Assign",
      role: "admin",
    });
    adminUserId = admin.id;

    const ropOwn = await createTestUser({
      databaseUrl,
      email: ROP_OWN_EMAIL,
      password: TEST_PASSWORD,
      fullName: "ROP Own Scope",
      role: "rop",
    });
    ropOwnUserId = ropOwn.id;
    await linkUserToEmployee({
      databaseUrl,
      userId: ropOwnUserId,
      employeeId: LEADER,
      confirmedByUserId: adminUserId,
    });

    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(LEADER, {
        name_manager: "Team Leader",
        post: "Руководитель отдела продаж",
        team: [{ guid_team: TEAM, name_team: "Team Alpha", guid_team_leader: LEADER, name_team_leader: "Team Leader" }],
      }),
      buildEmployeeRosterEntry(MANAGER, {
        name_manager: "Manager Member",
        team: [{ guid_team: TEAM, name_team: "Team Alpha", guid_team_leader: LEADER }],
      }),
      buildEmployeeRosterEntry(REGIONAL, {
        name_manager: "Regional Member",
        team: [{ guid_team: TEAM, name_team: "Team Alpha", guid_team_leader: LEADER }],
      }),
    ]);
    const parsed = parseWholesaleEmployeeRosterBytes(rosterBytes);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }

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

    const clientsBytes = clientsBytesForTeamAssignments();
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes: rosterBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes: rosterBytes,
    });
  });

  after(async () => {
    await closePool();
  });

  it("returns regional kind with non-zero counts despite empty guidHeadOfSales", async () => {
    const ctx = adminContext(adminUserId);
    const items = await listV3RopResponsibles(ctx, LEADER, { teamGuid: TEAM });
    const regional = items.find(
      (row) => row.kind === "regional" && row.employeeGuid === REGIONAL.toLowerCase(),
    );
    assert.ok(regional, "regional assignment row expected");
    assert.ok(regional.clientCount >= 1, "regional client count from guidRegionalManager");
    const manager = items.find(
      (row) => row.kind === "manager" && row.employeeGuid === MANAGER.toLowerCase(),
    );
    assert.ok(manager);
    assert.ok(manager.clientCount >= 1 || manager.outletCount >= 1);
  });

  it("lists regional territory with teamGuid without head-of-sales filter", async () => {
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "admin-team-assign@example.test", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const list = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&teamGuid=${TEAM}&ropBranchGuid=${LEADER}&responsibleGuid=${REGIONAL}&responsibleKind=regional&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    assert.ok(list.body.total >= 1);
    assert.ok(list.body.items.some((row: { guid: string }) => row.guid === LEGAL_REGIONAL));

    const grouped = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&teamGuid=${TEAM}&ropBranchGuid=${LEADER}&responsibleGuid=${REGIONAL}&responsibleKind=regional&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(grouped.status, 200);
    assert.equal(grouped.body.total, list.body.total);
  });

  it("team portfolio total is distinct union of member assignments", async () => {
    const ctx = adminContext(adminUserId);
    const memberGuids = [MANAGER, REGIONAL].map((g) => g.toLowerCase());
    const portfolio = await countDistinctV3TeamPortfolio(ctx, memberGuids);
    assert.ok(portfolio.legal >= 2, "distinct legal groups across manager and regional");

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "admin-team-assign@example.test", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const teamList = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&teamGuid=${TEAM}&ropBranchGuid=${LEADER}&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(teamList.status, 200);
    assert.equal(teamList.body.total, portfolio.legal);
  });

  it("own ROP scoped portfolio matches admin for regional-only team member", async () => {
    const memberGuids = [MANAGER, REGIONAL].map((g) => g.toLowerCase());
    const adminPortfolio = await countDistinctV3TeamPortfolio(adminContext(adminUserId), memberGuids);
    const ropPortfolio = await countDistinctV3TeamPortfolio(ropContext(ropOwnUserId, LEADER), memberGuids);
    assert.equal(ropPortfolio.legal, adminPortfolio.legal);
    assert.ok(ropPortfolio.legal >= 1);

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: ROP_OWN_EMAIL, password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const list = await request(app)
      .get(`/api/clients/v3/list?entity=legal&page=1&pageSize=50`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((row: { guid: string }) => row.guid === LEGAL_REGIONAL));
  });

  it("forbids rop access to foreign teamGuid on list", async () => {
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: ROP_OWN_EMAIL, password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const foreignLeader = "66666666-6666-4666-8666-666666666666";
    const forbidden = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&teamGuid=${TEAM}&ropBranchGuid=${foreignLeader}&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(forbidden.status, 403);
  });
});
