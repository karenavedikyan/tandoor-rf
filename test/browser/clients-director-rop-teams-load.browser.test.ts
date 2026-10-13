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
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ?? path.join("/opt/cursor/artifacts/screenshots");

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

function emptyRef() {
  return { guid: null, name: "", state: "not_provided" as const };
}

function branchSnapshot(input: { clientRop: { guid: string; name: string } }) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: emptyRef(),
    hardwareManager: emptyRef(),
    headOfSales: { guid: input.clientRop.guid, name: input.clientRop.name, state: "directory_unverified" },
    currentRetailOutlets: [],
  };
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

function onecTeamsRequest(page: Page, teamQ: string) {
  return page.waitForRequest((request) => {
    if (!request.url().includes("/api/clients/org-structure/onec-teams")) {
      return false;
    }
    const q = new URL(request.url()).searchParams.get("teamQ");
    return (teamQ ?? "") === (q ?? "");
  });
}

function onecTeamsResponse(page: Page, teamQ: string) {
  return page.waitForResponse((response) => {
    if (!response.url().includes("/api/clients/org-structure/onec-teams") || response.status() !== 200) {
      return false;
    }
    const q = new URL(response.url()).searchParams.get("teamQ");
    return (teamQ ?? "") === (q ?? "");
  });
}

async function awaitOnecSearchInUrl(page: Page, teamQ: string): Promise<void> {
  await page.waitForFunction((q) => new URL(window.location.href).searchParams.get("teamQ") === q, teamQ);
}

describe("director rop teams direct load browser", { concurrency: false }, () => {
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
    await linkUserToEmployee({
      databaseUrl,
      userId: admin.id,
      employeeId: ORG_DIRECTOR_EMPLOYEE_GUID,
      confirmedByUserId: admin.id,
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
       VALUES (1, $1, 4) ON CONFLICT (id) DO UPDATE SET employee_count = 4`,
      ["b".repeat(64)],
    );
    for (const [guid, name, post, teamGuid, teamName] of [
      [ORG_DIRECTOR_EMPLOYEE_GUID, "Director", "Директор", TEAM_A, "Team Alpha"],
      [ROP_A, "ROP Alpha", "Руководитель отдела продаж", TEAM_A, "Team Alpha"],
      [ROP_B, "ROP Beta", "Руководитель отдела продаж", TEAM_B, "Team Beta"],
      [M1, "Manager One", "Менеджер", TEAM_A, "Team Alpha"],
      [M2, "Beta Manager", "Менеджер", TEAM_B, "Team Beta"],
    ] as const) {
      await pool.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, guid_team, name_team, raw_json)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5, '{}'::jsonb)
         ON CONFLICT (guid_manager) DO UPDATE SET
           name_manager = EXCLUDED.name_manager,
           post = EXCLUDED.post,
           guid_team = EXCLUDED.guid_team,
           name_team = EXCLUDED.name_team`,
        [guid, name, post, teamGuid, teamName],
      );
    }
    await pool.query(
      `INSERT INTO onec_wholesale_employee_team_memberships (guid_manager, guid_team, name_team)
       VALUES ($1::uuid, $2::uuid, $3), ($4::uuid, $5::uuid, $6)
       ON CONFLICT DO NOTHING`,
      [M1, TEAM_A, "Team Alpha", M2, TEAM_B, "Team Beta"],
    );
    await pool.end();
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client C1", guid_manager: M1, name_manager: "Manager One" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({ clientRop: { guid: ROP_A, name: "ROP Alpha" } }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: T1, guid_client: C1 }]);
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

  async function login(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", "admin@example.com");
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  async function expectRopTeamsPanel(page: Page): Promise<void> {
    await page.waitForSelector("#teams-panel:not(.clients-hidden)", { timeout: 30_000 });
    await page.waitForSelector('[data-team-source="rop"].clients-team-mode-switch__btn--active', {
      timeout: 30_000,
    });
    await page.waitForSelector(".clients-compact-team-list .clients-compact-team", { timeout: 30_000 });
    assert.ok((await page.locator(".clients-compact-team-list .clients-compact-team").count()) >= 1);
  }

  it("1C then ROP then reload on /clients?view=teams keeps ROP teams visible", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page);
    const onecReady = page.waitForResponse(
      (r) => r.url().includes("/api/clients/org-structure/onec-teams") && r.status() === 200,
    );
    await page.goto("/clients?view=teams&teamSource=onec", { waitUntil: "domcontentloaded" });
    await onecReady;
    await page.waitForSelector(".clients-onec-team-list .clients-onec-team");

    const ropSwitch = page.locator('[data-team-source="rop"]');
    const orgStructure = page.waitForResponse(
      (r) => r.url().includes("/api/clients/org-structure") && !r.url().includes("onec-teams") && r.status() === 200,
    );
    await ropSwitch.click();
    await orgStructure;
    await expectRopTeamsPanel(page);

    const orgStructureReload = page.waitForResponse(
      (r) => r.url().includes("/api/clients/org-structure") && !r.url().includes("onec-teams") && r.status() === 200,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await orgStructureReload;
    await expectRopTeamsPanel(page);
    await page.close();
    await stopServer();
  });

  it("stale 1C response in same document does not replace active ROP overview", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await allowStaleOnecTeamsCompletionInTest(page);
    await login(page);

    const initialOnec = page.waitForResponse(
      (r) => r.url().includes("/api/clients/org-structure/onec-teams") && r.status() === 200,
    );
    await page.goto("/clients?view=teams&teamSource=onec", { waitUntil: "domcontentloaded" });
    await initialOnec;
    await page.waitForSelector(".clients-onec-team-list .clients-onec-team");
    await page.waitForSelector('[data-team-source="onec"].clients-team-mode-switch__btn--active');

    const slowGate = makeReleaseGate();
    await installOnecTeamsGateRoute(page, "Slow Alpha", slowGate);

    const slowRequest = onecTeamsRequest(page, "Slow Alpha");
    await page.locator("#clients-team-search-input").fill("Slow Alpha");
    await awaitOnecSearchInUrl(page, "Slow Alpha");
    await slowRequest;

    const ropStructure = page.waitForResponse(
      (r) =>
        r.url().includes("/api/clients/org-structure") &&
        !r.url().includes("onec-teams") &&
        r.status() === 200,
    );
    await page.locator('[data-team-source="rop"]').click();
    await ropStructure;
    await page.waitForFunction(() => new URL(window.location.href).searchParams.get("teamSource") !== "onec");
    await expectRopTeamsPanel(page);

    const ropSearchAfterSwitch = await page.inputValue("#clients-team-search-input");
    const urlAfterSwitch = new URL(page.url());

    const staleSlowResponse = onecTeamsResponse(page, "Slow Alpha");
    slowGate.release();
    await staleSlowResponse;

    await expectRopTeamsPanel(page);
    assert.equal(await page.locator(".clients-onec-team-list").count(), 0);
    assert.equal(await page.locator(".clients-onec-team").count(), 0);
    assert.equal(new URL(page.url()).searchParams.get("teamSource"), null);
    assert.equal(new URL(page.url()).searchParams.get("teamQ"), urlAfterSwitch.searchParams.get("teamQ"));
    assert.equal(await page.inputValue("#clients-team-search-input"), ropSearchAfterSwitch);
    assert.equal(await page.locator('[data-team-source="rop"].clients-team-mode-switch__btn--active').count(), 1);

    await page.close();
    await stopServer();
  });

  it("direct /clients?view=teams shows ROP teams and survives reload", async () => {
    await seed();
    await startServer();
    for (const [label, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const page = await browser.newPage({ viewport, baseURL: baseUrl });
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("response", (res) => {
        if (res.status() >= 500) {
          errors.push(`${res.status()} ${res.url()}`);
        }
      });

      await login(page);
      const orgStructure = page.waitForResponse(
        (r) => r.url().includes("/api/clients/org-structure") && !r.url().includes("onec-teams") && r.status() === 200,
      );
      await page.goto("/clients?view=teams", { waitUntil: "domcontentloaded" });
      await orgStructure;
      await expectRopTeamsPanel(page);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `director-rop-teams-direct-${label}.png`),
        fullPage: false,
      });

      const orgStructureReload = page.waitForResponse(
        (r) => r.url().includes("/api/clients/org-structure") && !r.url().includes("onec-teams") && r.status() === 200,
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await orgStructureReload;
      await expectRopTeamsPanel(page);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `director-rop-teams-reload-${label}.png`),
        fullPage: false,
      });
      assert.equal(errors.length, 0, errors.join("\n"));
      await page.close();
    }
    await stopServer();
  });
});
