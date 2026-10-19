import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ORG_DIRECTOR_EMPLOYEE_GUID } from "../../src/clients/org/constants";
import { applyAuthoritativeWholesaleOrgSnapshot } from "../../src/onec-clients/roster-authoritative-org";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const LEADER = "44444444-4444-4444-8444-444444444444";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_A = "22222222-2222-4222-8222-222222222222";
const MEMBER_B = "33333333-3333-4333-8333-333333333333";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

function orgRosterBytes() {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(ORG_DIRECTOR_EMPLOYEE_GUID, {
      name_manager: "Director Fixture",
      post: "Директор",
      team: [],
    }),
    buildEmployeeRosterEntry(LEADER, {
      name_manager: "Leader Multi Team",
      team: [
        { guid_team: TEAM_A, name_team: "Team Alpha", guid_team_leader: LEADER, name_team_leader: "Leader Multi Team" },
        { guid_team: TEAM_B, name_team: "Team Beta", guid_team_leader: LEADER, name_team_leader: "Leader Multi Team" },
      ],
    }),
    buildEmployeeRosterEntry(MEMBER_A, {
      name_manager: "Member Alpha Only",
      team: [{ guid_team: TEAM_A, name_team: "Team Alpha", guid_team_leader: LEADER }],
    }),
    buildEmployeeRosterEntry(MEMBER_B, {
      name_manager: "Member Beta Only",
      team: [{ guid_team: TEAM_B, name_team: "Team Beta", guid_team_leader: LEADER }],
    }),
  ]);
}

describe("v3 team group staff list UI", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    process.env.PGSSLMODE = "disable";
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin-v3-team-group-ui@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Team Group UI",
      role: "admin",
    });

    const employeesLegacy = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MEMBER_A, { name_manager: "Member Alpha Only" }),
      buildEmployeeRosterEntry(MEMBER_B, { name_manager: "Member Beta Only" }),
    ]);
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: employeesLegacy,
    });
    assert.equal(dry.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: employeesLegacy,
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

    const { createApp } = await import("../../src/server");
    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const addr = appServer!.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  });

  after(async () => {
    await browser?.close();
    if (appServer) {
      await new Promise<void>((resolve, reject) =>
        appServer!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await closePool();
  });

  async function login(page: Page) {
    await page.goto(`${baseUrl}/login`);
    await page.fill('input[name="email"]', "admin-v3-team-group-ui@example.com");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/clients" || url.pathname === "/profile", {
      timeout: 30000,
    });
  }

  async function openTeamGroup(page: Page, teamGuid: string, expectedMemberGuid: string) {
    const responsibles = page.waitForResponse(
      (res) => res.url().includes("/responsibles") && res.url().includes("teamGuid=" + encodeURIComponent(teamGuid)),
      { timeout: 30000 },
    );
    await page.locator('[data-open-rop-team="' + LEADER + '"][data-team-guid="' + teamGuid + '"]').click();
    await responsibles;
    await page.waitForFunction(
      ({ memberGuid }) => {
        if (document.querySelector(".clients-compact-team__members--loading")) {
          return false;
        }
        return document.querySelector('.x13-person[data-manager="' + memberGuid + '"]') !== null;
      },
      { memberGuid: expectedMemberGuid },
      { timeout: 30000 },
    );
  }

  it("shows staff for selected team group without perpetual loading", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);
    await page.goto(`${baseUrl}/clients?view=teams&v3mode=1&v3entity=legal_grouped&v3view=teams`);
    await page.waitForSelector('[data-team-guid="' + TEAM_A + '"]', { timeout: 30000 });
    await openTeamGroup(page, TEAM_A, MEMBER_A);
    assert.match(page.url(), new RegExp("orgTeamGuid=" + encodeURIComponent(TEAM_A)));
    assert.equal(await page.locator('.x13-person[data-manager="' + MEMBER_A + '"]').count(), 1);
    assert.equal(await page.locator('.x13-person[data-manager="' + MEMBER_B + '"]').count(), 0);

    await page.goto(`${baseUrl}/clients?view=teams&v3mode=1&v3entity=legal_grouped&v3view=teams`);
    await page.waitForSelector('[data-team-guid="' + TEAM_B + '"]', { timeout: 30000 });
    await openTeamGroup(page, TEAM_B, MEMBER_B);
    assert.match(page.url(), new RegExp("orgTeamGuid=" + encodeURIComponent(TEAM_B)));
    assert.equal(await page.locator('.x13-person[data-manager="' + MEMBER_B + '"]').count(), 1);
    assert.equal(await page.locator('.x13-person[data-manager="' + MEMBER_A + '"]').count(), 0);
    await page.close();
  });
});
