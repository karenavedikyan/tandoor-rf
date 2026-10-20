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
const LEADER = "55555555-5555-4555-8555-555555555555";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const REGIONAL = "33333333-3333-4333-8333-333333333333";
const LEGAL_REGIONAL = "c3000000-0000-4000-8000-000000000001";
const LEGAL_MANAGER = "b2000000-0000-4000-8000-000000000001";
const LEGAL_MANAGER_AS_CLIENT = "b2000000-0000-4000-8000-000000000004";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

function clientsBytesForRegionalTeam(): Buffer {
  const base = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json"), "utf8"),
  ) as Record<string, unknown>[];
  const legalManager = base.find((row) => row.guid_client === LEGAL_MANAGER) as Record<string, unknown>;
  if (legalManager) {
    legalManager.guid_manager = MANAGER;
    legalManager.name_manager = "Manager Member";
    legalManager.guid_head_of_the_sales_department = "";
    legalManager.name_head_of_the_sales_department = "";
    legalManager.guid_regional_manager = "";
    legalManager.name_regional_manager = "";
  }
  const legalWithRegionalAsManager = base.find(
    (row) => row.guid_client === LEGAL_MANAGER_AS_CLIENT,
  ) as Record<string, unknown>;
  if (legalWithRegionalAsManager) {
    legalWithRegionalAsManager.guid_manager = MANAGER;
    legalWithRegionalAsManager.name_manager = "Manager Member";
  }
  base.push({
    guid_client: LEGAL_REGIONAL,
    name_client: "Legal Regional Back Nav",
    guid_holding: "",
    name_holding: "",
    type_category: { guid_type: "t3", name_type: "Type C", guid_category: "c3", name_category: "Cat C" },
    guid_manager: "",
    name_manager: "",
    guid_head_of_the_sales_department: "",
    name_head_of_the_sales_department: "",
    guid_regional_manager: REGIONAL,
    name_regional_manager: "Regional Back Nav",
    address: "",
    telephone: [],
    Discount: "",
    DiscountAmount: 0,
    markups: [],
    other: {},
  });
  return Buffer.from(JSON.stringify(base), "utf8");
}

describe("v3 detail back preserves team regional list", { concurrency: false }, () => {
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
      email: "admin-v3-detail-back@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Detail Back",
      role: "admin",
    });

    const rosterBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(ORG_DIRECTOR_EMPLOYEE_GUID, {
        name_manager: "Director",
        post: "Директор",
        team: [],
      }),
      buildEmployeeRosterEntry(LEADER, {
        name_manager: "Team Leader Back",
        post: "Руководитель отдела продаж",
        team: [{ guid_team: TEAM, name_team: "Team Back", guid_team_leader: LEADER, name_team_leader: "Team Leader Back" }],
      }),
      buildEmployeeRosterEntry(MANAGER, {
        name_manager: "Manager Member",
        team: [{ guid_team: TEAM, name_team: "Team Back", guid_team_leader: LEADER }],
      }),
      buildEmployeeRosterEntry(REGIONAL, {
        name_manager: "Regional Back Nav",
        team: [{ guid_team: TEAM, name_team: "Team Back", guid_team_leader: LEADER }],
      }),
    ]);
    const parsed = parseWholesaleEmployeeRosterBytes(rosterBytes);
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

    const clientsBytes = clientsBytesForRegionalTeam();
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes,
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: rosterBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes,
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes: rosterBytes,
    });

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
    await page.fill('input[name="email"]', "admin-v3-detail-back@example.com");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/clients" || url.pathname === "/profile", {
      timeout: 30000,
    });
  }

  it("returns from legal card to the same regional team list", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);
    await page.goto(`${baseUrl}/clients?view=teams&v3mode=1&v3entity=legal_grouped&v3view=teams`);
    await page.waitForSelector('[data-open-rop-team="' + LEADER + '"][data-team-guid="' + TEAM + '"]', {
      timeout: 30000,
    });
    const regionalGuid = REGIONAL.toLowerCase();
    const responsibles = page.waitForResponse(
      (res) => res.url().includes("/responsibles") && res.url().includes("teamGuid=" + encodeURIComponent(TEAM)),
      { timeout: 30000 },
    );
    await page.locator('[data-open-rop-team="' + LEADER + '"][data-team-guid="' + TEAM + '"]').click();
    await responsibles;
    await page.waitForFunction(
      ({ memberGuid }) => {
        if (document.querySelector(".clients-compact-team__members--loading")) {
          return false;
        }
        return (
          document.querySelector('.x13-person[data-manager="' + memberGuid + '"]') !== null ||
          document.querySelector('[data-employee-guid="' + memberGuid + '"]') !== null
        );
      },
      { memberGuid: regionalGuid },
      { timeout: 30000 },
    );
    const x13Regional = page.locator(
      '.x13-person[data-manager="' +
        regionalGuid +
        '"][data-open-territory="clients"][data-responsible-kind="regional"]',
    );
    await x13Regional.first().click();
    await page.waitForURL(
      (url) =>
        url.searchParams.get("responsibleGuid") === regionalGuid &&
        url.searchParams.get("orgTeamGuid") === TEAM &&
        url.searchParams.get("responsibleKind") === "regional",
      { timeout: 30000 },
    );
    const listUrl = page.url();

    const cardLink = page.locator('a.clients-link--secondary[href*="' + LEGAL_REGIONAL + '"]').first();
    await cardLink.waitFor({ state: "visible", timeout: 30000 });
    const href = await cardLink.getAttribute("href");
    assert.ok(href && href.includes("return="), "list link must carry return query from buildListReturnQuery");
    await cardLink.click();
    await page.waitForURL((url) => url.pathname.includes(LEGAL_REGIONAL), { timeout: 30000 });
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL((url) => url.pathname === "/clients", { timeout: 30000 });
    assert.match(page.url(), new RegExp("orgTeamGuid=" + encodeURIComponent(TEAM)));
    assert.match(page.url(), new RegExp("responsibleGuid=" + encodeURIComponent(REGIONAL)));
    assert.match(page.url(), /responsibleKind=regional/);
    assert.notEqual(page.url(), listUrl.split("?")[0] + "?view=teams");
    await page.close();
  });
});
