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
import { insertSuccessfulImportRun, insertSyntheticClients } from "../helpers/clients-db-fixtures";
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

  async function seedEmployeePortfolioRoute(): Promise<void> {
    await seed();
    const clientGuid = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
        VALUES ($1::uuid, 'Team Alpha', $2::uuid, 'Director OneC')
        ON CONFLICT (guid_team) DO NOTHING
      `,
      [TEAM_A, ORG_DIRECTOR_EMPLOYEE_GUID],
    );
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_team_memberships (guid_manager, guid_team, name_team)
        VALUES ($1::uuid, $2::uuid, 'Team Alpha')
        ON CONFLICT (guid_manager, guid_team) DO NOTHING
      `,
      [M1, TEAM_A],
    );
    await pool.end();
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: clientGuid,
        name_client: "Portfolio Client",
        guid_manager: M1,
        name_manager: "Alpha Manager",
      },
    ]);
  }

  it("navigates group member portfolio with real clients API (desktop and mobile)", async () => {
    await seedEmployeePortfolioRoute();
    await startServer();

    for (const [label, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const page = await browser.newPage({ viewport, baseURL: baseUrl });
      await login(page, "admin@example.com");
      await openOnecTeams(page);
      await onecGroup(page, "Team Alpha").locator(".clients-compact-team__toggle").click();
      await page.waitForSelector(".clients-compact-team--expanded");

      const listReady = page.waitForResponse((response) => {
        if (!response.url().includes("/api/clients") || response.status() !== 200) {
          return false;
        }
        const url = new URL(response.url());
        return (
          url.searchParams.get("teamSource") === "onec" &&
          url.searchParams.get("onecPortfolioEmployee") === M1
        );
      });
      await onecGroup(page, "Team Alpha")
        .locator(`[data-onec-member-portfolio][data-employee-guid="${M1}"]`)
        .first()
        .click();
      await listReady;
      await page.waitForFunction(
        (employeeGuid) =>
          new URL(window.location.href).searchParams.get("onecPortfolioEmployee") === employeeGuid,
        M1,
      );

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-onec-portfolio-${label}-list.png`),
        fullPage: false,
      });

      const clientLink = page.locator("a.clients-link", { hasText: "Portfolio Client" });
      if ((await clientLink.count()) > 0) {
        const href = await clientLink.first().getAttribute("href");
        assert.ok(href);
        await page.goto(href!, { waitUntil: "networkidle" });
        await page.waitForURL(/\/clients\/[^/?]+/, { timeout: 15000 });
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `clients-onec-portfolio-${label}-card.png`),
          fullPage: false,
        });
        await page.goBack({ waitUntil: "networkidle" });
      }

      await page.reload({ waitUntil: "networkidle" });
      assert.equal(new URL(page.url()).searchParams.get("onecPortfolioEmployee"), M1);

      await page.close();
    }

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
