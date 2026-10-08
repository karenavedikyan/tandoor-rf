import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ORG_DIRECTOR_EMPLOYEE_GUID } from "../../src/clients/org/constants";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertSyntheticRetailOutlets,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const ORIGIN = "http://127.0.0.1:3000";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEAM_SHARED_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM_SHARED_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ?? path.join("/opt/cursor/artifacts/screenshots");

type ReleaseGate = {
  wait: Promise<void>;
  release: () => void;
};

function makeReleaseGate(): ReleaseGate {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release: () => release() };
}

function onecTeamsRequest(page: Page, teamQ: string | null) {
  return page.waitForRequest((request) => {
    if (!request.url().includes("/api/clients/org-structure/onec-teams")) {
      return false;
    }
    const q = new URL(request.url()).searchParams.get("teamQ");
    return (teamQ ?? null) === (q ?? null);
  });
}

function onecTeamsResponse(page: Page, teamQ: string | null) {
  return page.waitForResponse((response) => {
    if (!response.url().includes("/api/clients/org-structure/onec-teams") || response.status() !== 200) {
      return false;
    }
    const q = new URL(response.url()).searchParams.get("teamQ");
    return (teamQ ?? null) === (q ?? null);
  });
}

async function awaitOnecSearchInUrl(page: Page, teamQ: string): Promise<void> {
  await page.waitForFunction((q) => new URL(window.location.href).searchParams.get("teamQ") === q, teamQ);
}

async function expectOnecGroupNames(page: Page, names: string[]): Promise<void> {
  await page.waitForFunction((expected) => {
    const actual = Array.from(
      document.querySelectorAll(".clients-onec-team .clients-compact-team__name"),
    ).map((node) => node.textContent || "");
    return actual.length === expected.length && expected.every((name, index) => actual[index] === name);
  }, names);
}

/** Test-only: let stale onec-teams HTTP responses finish after AbortController cancel. */
async function allowStaleOnecTeamsCompletionInTest(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/clients/org-structure/onec-teams") && init && init.signal) {
        const nextInit = Object.assign({}, init);
        delete nextInit.signal;
        return originalFetch.call(this, input, nextInit);
      }
      return originalFetch.call(this, input, init);
    };
  });
}

async function installOnecTeamsGateRoute(page: Page, gateForTeamQ: string, gate: ReleaseGate): Promise<void> {
  await page.route("**/api/clients/org-structure/onec-teams**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("teamQ") || "";
    if (q === gateForTeamQ) {
      const upstream = await route.fetch();
      const body = await upstream.body();
      await gate.wait;
      await route.fulfill({
        status: upstream.status(),
        headers: upstream.headers(),
        body,
      });
      return;
    }
    await route.continue();
  });
}

describe("clients onec teams browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seed(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const director = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: director.id,
      employeeId: ORG_DIRECTOR_EMPLOYEE_GUID,
      confirmedByUserId: admin.id,
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
       VALUES (1, $1, 5) ON CONFLICT (id) DO UPDATE SET employee_count = 5`,
      ["b".repeat(64)],
    );
    const rows = [
      [ORG_DIRECTOR_EMPLOYEE_GUID, "Director OneC", "Директор", TEAM_A, "Team Alpha"],
      [M1, "Alpha Manager", "Менеджер", TEAM_A, "Team Alpha"],
      [M2, "Beta Manager", "Менеджер", TEAM_B, "Team Beta"],
      [M3, "No Team Manager", "Менеджер", null, null],
      ["44444444-4444-4444-8444-444444444444", "Shared Name A", "Менеджер", TEAM_SHARED_A, "Shared Name"],
      ["55555555-5555-4555-8555-555555555555", "Shared Name B", "Менеджер", TEAM_SHARED_B, "Shared Name"],
    ] as const;
    for (const [guid, name, post, teamGuid, teamName] of rows) {
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (
            guid_manager, name_manager, post, guid_team, name_team, raw_json
          )
          VALUES ($1::uuid, $2, $3, $4::uuid, $5, '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET
            name_manager = EXCLUDED.name_manager,
            post = EXCLUDED.post,
            guid_team = EXCLUDED.guid_team,
            name_team = EXCLUDED.name_team
        `,
        [guid, name, post, teamGuid, teamName],
      );
    }
    await pool.end();
    await insertSuccessfulImportRun(databaseUrl);
  }

  async function startServer(): Promise<void> {
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  async function login(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  function onecGroup(page: Page, name: string) {
    return page.locator(".clients-onec-team").filter({
      has: page.locator(".clients-compact-team__name", { hasText: name }),
    });
  }

  async function openTeamsRop(page: Page): Promise<void> {
    const orgReady = page.waitForResponse(
      (response) => response.url().includes("/api/clients/org-structure") && response.status() === 200,
    );
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
    await orgReady;
    await page.waitForSelector(".clients-team-mode-switch");
  }

  async function openOnecTeams(page: Page): Promise<void> {
    const teamsReady = page.waitForResponse(
      (response) => response.url().includes("/api/clients/org-structure/onec-teams") && response.status() === 200,
    );
    await page.goto("/clients?view=teams&teamSource=onec", { waitUntil: "networkidle" });
    await teamsReady;
    await page.waitForSelector(".clients-onec-team-list .clients-onec-team");
  }

  async function expectModeSwitchVisible(page: Page): Promise<void> {
    await page.waitForSelector(".clients-team-mode-switch");
    assert.equal(await page.locator('[data-team-source="rop"]').count(), 1);
    assert.equal(await page.locator('[data-team-source="onec"]').count(), 1);
  }

  it("keeps team source switch available across modes, reload and reset", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "director@example.com");
    await openTeamsRop(page);
    await expectModeSwitchVisible(page);
    assert.equal(await page.locator('[data-team-source="rop"].clients-team-mode-switch__btn--active').count(), 1);

    const onecReady = page.waitForResponse(
      (response) => response.url().includes("/api/clients/org-structure/onec-teams") && response.status() === 200,
    );
    await page.click('[data-team-source="onec"]');
    await onecReady;
    await page.waitForSelector(".clients-onec-team-list .clients-onec-team");
    await expectModeSwitchVisible(page);
    assert.equal(await page.locator('[data-team-source="onec"].clients-team-mode-switch__btn--active').count(), 1);

    await page.click('[data-team-source="rop"]');
    await page.waitForSelector(".clients-compact-team-list .clients-compact-team");
    await expectModeSwitchVisible(page);

    await page.reload({ waitUntil: "networkidle" });
    await expectModeSwitchVisible(page);

    await page.click('[data-team-source="onec"]');
    await page.waitForSelector(".clients-onec-team-list .clients-onec-team");
    await page.click("#clients-team-collapse-all");
    await page.waitForFunction(
      () =>
        !new URL(window.location.href).searchParams.get("teamQ") &&
        (document.querySelector("#clients-team-search-input")?.value || "") === "",
    );
    await expectModeSwitchVisible(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-onec-teams-mode-switch-after-reset.png"),
      fullPage: false,
    });

    await page.close();
    await stopServer();
  });

  it("desktop expand, search, reload and reset", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "admin@example.com");
    await openOnecTeams(page);

    await onecGroup(page, "Team Alpha").locator(".clients-compact-team__toggle").click();
    await page.waitForSelector(".clients-compact-team--expanded .clients-compact-team__member-name");

    const searchReady = page.waitForResponse((response) => {
      if (!response.url().includes("/api/clients/org-structure/onec-teams") || response.status() !== 200) {
        return false;
      }
      const url = new URL(response.url());
      return url.searchParams.get("teamQ") === "Alpha Manager";
    });
    await page.fill("#clients-team-search-input", "Alpha Manager");
    await searchReady;
    await page.waitForFunction(() => new URL(window.location.href).searchParams.get("teamQ") === "Alpha Manager");
    assert.equal(await onecGroup(page, "Team Alpha").locator(".clients-compact-team__member-name").count(), 1);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#clients-team-search-input");
    assert.equal(await page.inputValue("#clients-team-search-input"), "Alpha Manager");

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-onec-teams-desktop-expanded-search.png"),
      fullPage: false,
    });

    const resetReady = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients/org-structure/onec-teams") &&
        response.status() === 200 &&
        !new URL(response.url()).searchParams.get("teamQ"),
    );
    await page.click("#clients-team-collapse-all");
    await resetReady;
    await page.waitForFunction(
      () =>
        !new URL(window.location.href).searchParams.get("teamQ") &&
        (document.querySelector("#clients-team-search-input")?.value || "") === "",
    );

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    assert.ok(bodyWidth <= viewportWidth + 1);

    await page.close();
    await stopServer();
  });

  it("ignores stale onec response after faster search while staying in 1C mode", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await allowStaleOnecTeamsCompletionInTest(page);
    await login(page, "director@example.com");
    await openOnecTeams(page);

    const slowAlphaGate = makeReleaseGate();
    await installOnecTeamsGateRoute(page, "Slow Alpha", slowAlphaGate);

    const slowRequest = onecTeamsRequest(page, "Slow Alpha");
    await page.fill("#clients-team-search-input", "Slow Alpha");
    await awaitOnecSearchInUrl(page, "Slow Alpha");
    await slowRequest;

    const betaResponse = onecTeamsResponse(page, "Beta");
    await page.fill("#clients-team-search-input", "Beta");
    await awaitOnecSearchInUrl(page, "Beta");
    await betaResponse;
    await expectOnecGroupNames(page, ["Team Beta"]);
    assert.equal(await page.inputValue("#clients-team-search-input"), "Beta");

    const staleSlowResponse = onecTeamsResponse(page, "Slow Alpha");
    slowAlphaGate.release();
    await staleSlowResponse;

    assert.equal(new URL(page.url()).searchParams.get("teamSource"), "onec");
    assert.equal(new URL(page.url()).searchParams.get("teamQ"), "Beta");
    assert.equal(await page.inputValue("#clients-team-search-input"), "Beta");
    await expectOnecGroupNames(page, ["Team Beta"]);

    await page.close();
    await stopServer();
  });

  it("ignores stale onec response after switching back to ROP teams", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await allowStaleOnecTeamsCompletionInTest(page);
    await login(page, "director@example.com");
    await openTeamsRop(page);

    const enterOnecResponse = onecTeamsResponse(page, null);
    await page.click('[data-team-source="onec"]');
    await enterOnecResponse;
    await page.waitForSelector(".clients-onec-team-list .clients-onec-team");

    const slowAlphaGate = makeReleaseGate();
    await installOnecTeamsGateRoute(page, "Slow Alpha", slowAlphaGate);

    const slowRequest = onecTeamsRequest(page, "Slow Alpha");
    await page.fill("#clients-team-search-input", "Slow Alpha");
    await awaitOnecSearchInUrl(page, "Slow Alpha");
    await slowRequest;

    const betaResponse = onecTeamsResponse(page, "Beta");
    await page.fill("#clients-team-search-input", "Beta");
    await awaitOnecSearchInUrl(page, "Beta");
    await betaResponse;
    await expectOnecGroupNames(page, ["Team Beta"]);

    const ropStructureResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients/org-structure") &&
        !response.url().includes("/onec-teams") &&
        response.status() === 200,
    );
    await page.click('[data-team-source="rop"]');
    await ropStructureResponse;
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("teamSource") !== "onec",
    );
    await page.waitForFunction(() => document.querySelectorAll(".clients-onec-team").length === 0);
    await page.waitForSelector(".clients-team-mode-switch");
    assert.equal(await page.locator('[data-team-source="rop"].clients-team-mode-switch__btn--active').count(), 1);

    const staleSlowResponse = onecTeamsResponse(page, "Slow Alpha");
    slowAlphaGate.release();
    await staleSlowResponse;

    assert.equal(await page.locator(".clients-onec-team-list").count(), 0);
    assert.equal(await page.locator(".clients-onec-team").count(), 0);
    assert.equal(new URL(page.url()).searchParams.get("teamSource"), null);
    assert.equal(new URL(page.url()).searchParams.get("teamQ"), null);
    assert.equal(await page.locator('[data-team-source="rop"].clients-team-mode-switch__btn--active').count(), 1);
    await expectModeSwitchVisible(page);

    await page.close();
    await stopServer();
  });

  const PORTFOLIO_CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
  const PORTFOLIO_STORE = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
  const ROP_LEADER = "44444444-4444-4444-8444-444444444444";

  async function seedEmployeePortfolioRoute(options?: { ropLeader?: boolean }): Promise<void> {
    await seed();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const leaderGuid = options?.ropLeader ? ROP_LEADER : ORG_DIRECTOR_EMPLOYEE_GUID;
    const leaderName = options?.ropLeader ? "ROP Leader" : "Director OneC";
    if (options?.ropLeader) {
      const admin = await createTestUser({
        databaseUrl,
        email: "rop-leader@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP Leader",
        role: "rop",
      });
      const adminUser = await createTestUser({
        databaseUrl,
        email: "admin-portfolio@example.com",
        password: TEST_PASSWORD,
        fullName: "Admin Portfolio",
        role: "admin",
      });
      await linkUserToEmployee({
        databaseUrl,
        userId: admin.id,
        employeeId: ROP_LEADER,
        confirmedByUserId: adminUser.id,
      });
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, 'Руководитель', '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
        `,
        [ROP_LEADER, leaderName],
      );
    }
    await pool.query(
      `
        INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
        VALUES ($1::uuid, 'Team Alpha', $2::uuid, $3)
        ON CONFLICT (guid_team) DO UPDATE SET
          guid_team_leader = EXCLUDED.guid_team_leader,
          name_team_leader = EXCLUDED.name_team_leader
      `,
      [TEAM_A, leaderGuid, leaderName],
    );
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_team_memberships (guid_manager, guid_team, name_team)
        VALUES ($1::uuid, $2::uuid, 'Team Alpha')
        ON CONFLICT (guid_manager, guid_team) DO UPDATE SET name_team = EXCLUDED.name_team
      `,
      [M1, TEAM_A],
    );
    await pool.end();
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: PORTFOLIO_CLIENT,
        name_client: "Portfolio Client",
        guid_manager: M1,
        name_manager: "Alpha Manager",
      },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: PORTFOLIO_STORE, guid_client: PORTFOLIO_CLIENT },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      PORTFOLIO_CLIENT,
      {
        formatVersion: "extended_v1",
        sourceSha256: "a".repeat(64),
        importedAt: new Date().toISOString(),
        isHolding: false,
        holdingLink: { state: "none", pendingGuid: null },
        clientManagerRosterState: "in_wholesale_roster",
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: options?.ropLeader
          ? { guid: ROP_LEADER, name: "ROP Leader", state: "directory_unverified" }
          : { guid: null, name: "", state: "unassigned" },
        currentRetailOutlets: [
          {
            ordinal: 0,
            guidStore: PORTFOLIO_STORE,
            holdingName: "TT",
            warehouse: false,
            address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
            loading: {},
            managers: {
              manager: { guid: M1, name: "Alpha Manager", state: "directory_unverified" },
              regionalManager: { guid: null, name: "", state: "not_provided" },
              hardwareManager: { guid: null, name: "", state: "not_provided" },
              headOfSales: options?.ropLeader
                ? { guid: ROP_LEADER, name: "ROP Leader", state: "directory_unverified" }
                : { guid: null, name: "", state: "unassigned" },
            },
            contacts: {},
            lpr: {},
          },
        ],
      },
    );
    await insertSuccessfulImportRun(databaseUrl);
  }

  async function ensureTeamAlphaExpanded(page: Page): Promise<void> {
    const group = onecGroup(page, "Team Alpha");
    if ((await group.locator(".clients-compact-team--expanded").count()) === 0) {
      await group.locator(".clients-compact-team__toggle").click();
      await group.locator(".clients-compact-team__member-name").first().waitFor({ state: "visible" });
    }
  }

  async function clickOnecMemberPortfolioButton(
    page: Page,
    portfolio: "clients" | "outlets",
  ): Promise<Awaited<ReturnType<Page["waitForResponse"]>>> {
    const selector = `[data-onec-member-portfolio="${portfolio}"][data-employee-guid="${M1}"]`;
    const responsePromise = page.waitForResponse(
      (response) => {
        if (!response.url().includes("/api/clients") || response.status() !== 200) {
          return false;
        }
        const url = new URL(response.url());
        if (url.searchParams.get("view") !== "teams" || url.searchParams.get("teamSource") !== "onec") {
          return false;
        }
        const entity = url.searchParams.get("entity") ?? "clients";
        return portfolio === "outlets" ? entity === "outlets" : entity === "clients";
      },
      { timeout: 60_000 },
    );
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const clicked = await page.evaluate((sel) => {
        const button = document.querySelector(sel);
        if (!button || !(button instanceof HTMLElement)) {
          return false;
        }
        button.click();
        return true;
      }, selector);
      if (clicked) {
        return responsePromise;
      }
      await page.waitForTimeout(200);
    }
    throw new Error(`Onec member ${portfolio} portfolio button not found for ${M1}`);
  }

  async function returnToOnecTeamOverview(page: Page): Promise<void> {
    const back = page.locator("#clients-breadcrumbs-back");
    await back.waitFor({ state: "visible", timeout: 15_000 });
    const teamsReady = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients/org-structure/onec-teams") && response.status() === 200,
    );
    await Promise.all([teamsReady, back.click()]);
    await page.waitForSelector(".clients-onec-team-list .clients-onec-team");
    await ensureTeamAlphaExpanded(page);
  }

  async function openMemberClientsPortfolio(page: Page, loginEmail?: string): Promise<void> {
    if (loginEmail) {
      await login(page, loginEmail);
      const teamsReady = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients/org-structure/onec-teams") && response.status() === 200,
      );
      await page.goto(
        `/clients?view=teams&teamSource=onec&onecTeam=${TEAM_A}&teamExpand=${TEAM_A}`,
        { waitUntil: "networkidle" },
      );
      await teamsReady;
      await page.waitForSelector(".clients-onec-team-list .clients-onec-team");
    }
    await ensureTeamAlphaExpanded(page);
    await page.waitForFunction(
      (guid) =>
        Boolean(
          document.querySelector(`[data-onec-member-portfolio="clients"][data-employee-guid="${guid}"]`),
        ),
      M1,
      { timeout: 60_000 },
    );

    await page.waitForSelector(`[data-onec-member-portfolio="clients"][data-employee-guid="${M1}"]`, {
      state: "visible",
      timeout: 30_000,
    });
    const clientsResponse = await clickOnecMemberPortfolioButton(page, "clients");
    const clientsUrl = new URL(clientsResponse.url());
    assert.equal(clientsUrl.searchParams.get("onecPortfolioEmployee"), M1);
    assert.equal(clientsUrl.searchParams.get("entity") ?? "clients", "clients");
    const clientsBody = (await clientsResponse.json()) as { total: number; items: Array<{ guid: string }> };
    assert.equal(clientsBody.total, 1);
    assert.equal(clientsBody.items[0]?.guid, PORTFOLIO_CLIENT);

    await returnToOnecTeamOverview(page);

    await page.waitForSelector(`[data-onec-member-portfolio="outlets"][data-employee-guid="${M1}"]`, {
      state: "visible",
      timeout: 30_000,
    });
    const outletsResponse = await clickOnecMemberPortfolioButton(page, "outlets");
    const outletsUrl = new URL(outletsResponse.url());
    assert.equal(outletsUrl.searchParams.get("onecPortfolioEmployee"), M1);
    const outletsBody = (await outletsResponse.json()) as {
      total: number;
      items: Array<{ guidStore: string }>;
    };
    assert.equal(outletsBody.total, 1);
    assert.equal(outletsBody.items[0]?.guidStore, PORTFOLIO_STORE);
    await page.getByRole("link", { name: "Addr", exact: true }).click({ timeout: 30_000 });
    await page.waitForURL(
      (url) =>
        url.pathname === `/clients/${PORTFOLIO_CLIENT}` &&
        url.searchParams.get("store") === PORTFOLIO_STORE,
      { timeout: 30_000 },
    );
    await page.goBack({ waitUntil: "networkidle" });

    const clientLink = page.getByRole("link", { name: "Portfolio Client" }).first();
    await clientLink.waitFor({ state: "visible", timeout: 60_000 });
    await clientLink.click();
    await page.waitForURL(new RegExp(`/clients/${PORTFOLIO_CLIENT}`), { timeout: 15000 });
    await page.waitForSelector("h1, .client-card__title, .clients-card__title");
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.get("onecPortfolioEmployee"), M1);
    assert.equal(new URL(page.url()).searchParams.get("onecTeam"), TEAM_A);

    await page.reload({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.get("onecPortfolioEmployee"), M1);
    assert.equal(new URL(page.url()).searchParams.get("onecTeam"), TEAM_A);
    await page.waitForSelector("a.clients-link", { state: "visible" });
  }

  it("navigates group member portfolio with real clients API (desktop and mobile)", async () => {
    await seedEmployeePortfolioRoute();
    await startServer();

    for (const [label, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const page = await browser.newPage({ viewport, baseURL: baseUrl });
      await openMemberClientsPortfolio(page, "admin@example.com");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-onec-portfolio-${label}-after-flow.png`),
        fullPage: false,
      });
      await page.close();
    }

    await stopServer();
  });

  it("ROP sees own 1C group and member portfolio on test DB", async () => {
    await seedEmployeePortfolioRoute({ ropLeader: true });
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await openMemberClientsPortfolio(page, "rop-leader@example.com");
    assert.equal(await page.locator(".clients-onec-team").count(), 0);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-onec-portfolio-rop-desktop-list.png"),
      fullPage: false,
    });
    await page.close();
    await stopServer();
  });

  it("mobile onec teams layout without horizontal overflow", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: MOBILE, baseURL: baseUrl });
    await login(page, "admin@example.com");
    await openOnecTeams(page);

    await page.click('[data-team-source="onec"]');
    await onecGroup(page, "Team Beta").locator(".clients-compact-team__toggle").click();
    await page.waitForSelector(".clients-compact-team--expanded");

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    assert.ok(bodyWidth <= viewportWidth + 1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-onec-teams-mobile-expanded.png"),
      fullPage: false,
    });

    await page.close();
    await stopServer();
  });
});
