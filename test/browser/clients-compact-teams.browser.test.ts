import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
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
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const R1 = "55555555-5555-4555-8555-555555555555";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const VIEWPORT_SHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

function branchSnapshot(input: {
  clientRop?: { guid: string; name: string };
  clientManager?: { guid: string; name: string };
  clientRegional?: { guid: string; name: string };
  outlets?: Array<{ guidStore: string; manager?: { guid: string; name: string }; rop?: { guid: string; name: string } }>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: input.clientRegional
      ? { guid: input.clientRegional.guid, name: input.clientRegional.name, state: "directory_unverified" }
      : { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: input.clientRop
      ? { guid: input.clientRop.guid, name: input.clientRop.name, state: "directory_unverified" }
      : { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: false,
      outletGuidStatus: "confirmed",
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
      loading: {
        loadingOnMonday: null,
        loadingOnTuesday: null,
        loadingOnWednesday: null,
        loadingOnThursday: null,
        loadingOnFriday: null,
        loadingOnSaturday: null,
        loadingOnSunday: null,
        loadingTime: null,
      },
      managers: {
        manager: outlet.manager
          ? { guid: outlet.manager.guid, name: outlet.manager.name, state: "directory_unverified" }
          : { guid: M1, name: "Manager One", state: "directory_unverified" },
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: outlet.rop
          ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
          : { guid: null, name: "", state: "unassigned" },
      },
      contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
      lpr: { name: "", post: "", dateOfBirth: null, phone: "", email: "", bonus: "", conditionsBonus: "" },
      additional: { statusTandoorClub: "", bonusTandoorClub: "" },
      provenance: { freshness: "current", sourceSha256: "a".repeat(64), importedAt: "2026-01-01T10:00:00.000Z" },
      distributionAllowed: false,
    })),
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients compact teams browser", { concurrency: false }, () => {
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
    await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director",
      role: "director",
    });
    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop-a@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP A User",
      role: "rop",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropUser.id,
      employeeId: ROP_A,
      confirmedByUserId: admin.id,
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
       VALUES (1, $1, 5) ON CONFLICT (id) DO UPDATE SET employee_count = 5`,
      ["b".repeat(64)],
    );
    for (const [guid, name] of [
      [ROP_A, "ROP Alpha"],
      [ROP_B, "ROP Beta"],
      [M1, "Manager One"],
      [M2, "Manager Two"],
      [R1, "Regional One"],
    ] as const) {
      await pool.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, $2, 'Менеджер', '{}'::jsonb)
         ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager`,
        [guid, name],
      );
    }
    await pool.end();
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client C1", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client C2", guid_manager: R1, name_manager: "Regional One" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M1, name: "Manager One" },
        outlets: [{ guidStore: T1, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M1, name: "Manager One" } }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      branchSnapshot({
        clientRop: { guid: ROP_B, name: "ROP Beta" },
        clientManager: { guid: R1, name: "Regional One" },
        clientRegional: { guid: R1, name: "Regional One" },
      }),
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

  async function login(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  function teamCard(page: Page, name: string) {
    return page.locator(".clients-compact-team").filter({
      has: page.locator(".clients-compact-team__name", { hasText: name }),
    });
  }

  it("search and kind filter semantics", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "admin@example.com");
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
    await page.waitForSelector(".clients-compact-team-list .clients-compact-team");

    const ropAlphaResponsibles = page.waitForResponse(
      (r) => r.url().includes("/responsibles") && r.url().includes(ROP_A) && r.status() === 200,
    );
    await page.fill("#clients-team-search-input", "ROP Alpha");
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("teamQ") === "ROP Alpha",
    );
    await ropAlphaResponsibles;
    await teamCard(page, "ROP Alpha")
      .locator(".clients-compact-team__member-name", { hasText: "Manager One" })
      .waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await teamCard(page, "ROP Alpha").locator(".clients-compact-team__member-name").count(), 1);
    assert.equal(await teamCard(page, "ROP Beta").count(), 0);

    await page.fill("#clients-team-search-input", "");
    await page.waitForFunction(() => !new URL(window.location.href).searchParams.get("teamQ"));
    await page.selectOption("#clients-team-kind-filter", "regional");
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("teamKind") === "regional",
    );
    assert.equal(await teamCard(page, "ROP Alpha").count(), 0);
    await teamCard(page, "ROP Beta")
      .locator(".clients-compact-team__member-name", { hasText: "Regional One" })
      .waitFor({ state: "visible", timeout: 15000 });

    await page.fill("#clients-team-search-input", "Manager One");
    await page.selectOption("#clients-team-kind-filter", "regional");
    await page.waitForFunction(
      () =>
        new URL(window.location.href).searchParams.get("teamQ") === "Manager One" &&
        new URL(window.location.href).searchParams.get("teamKind") === "regional",
    );
    await page.waitForSelector(".clients-compact-team__empty", { timeout: 15000 });
    assert.equal(await page.locator(".clients-compact-team").count(), 0);

    await page.close();
    await stopServer();
  });

  it("search load error shows retry and preserves query", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "admin@example.com");
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });

    await page.route("**/api/clients/org-structure/**/responsibles", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Service unavailable" }),
      });
    });

    await page.fill("#clients-team-search-input", "Manager One");
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("teamQ") === "Manager One",
    );
    await page.waitForSelector(".clients-compact-team__search-error", { timeout: 15000 });
    assert.equal(await page.locator(".clients-compact-team__empty").count(), 0);

    const retryOk = page.waitForResponse(
      (r) => r.url().includes("/responsibles") && r.url().includes(ROP_A) && r.status() === 200,
    );
    await page.unroute("**/api/clients/org-structure/**/responsibles");
    await page.click(".clients-compact-team__retry-search");
    await retryOk;
    assert.match(page.url(), /teamQ=Manager(\+|%20)One/);
    await teamCard(page, "ROP Alpha")
      .locator(".clients-compact-team__member-name", { hasText: "Manager One" })
      .waitFor({ state: "visible", timeout: 15000 });

    await page.close();
    await stopServer();
  });

  it("search input keeps focus while typing with debounce", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "admin@example.com");
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
    const input = page.locator("#clients-team-search-input");
    await input.click();
    await input.type("Man", { delay: 120 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "clients-team-search-input");

    await page.close();
    await stopServer();
  });

  it("admin/director compact teams: expand, search, filter, restore state", async () => {
    await seed();
    await startServer();

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const context = await browser.newContext({ viewport, baseURL: baseUrl });
      const page = await context.newPage();
      await login(page, "admin@example.com");
      await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
      await page.waitForSelector(".clients-compact-team-list .clients-compact-team");
      if (viewportName === "mobile") {
        const firstTeamBox = await page.locator(".clients-compact-team").first().boundingBox();
        assert.ok(firstTeamBox && firstTeamBox.y < viewport.height);
      }
      assert.equal(await teamCard(page, "ROP Alpha").locator(".clients-compact-team__members").count(), 0);

      if (viewportName === "desktop" || viewportName === "mobile") {
        await page.screenshot({
          path: path.join(VIEWPORT_SHOT_DIR, `clients-compact-teams-viewport-${viewportName}.png`),
          fullPage: false,
        });
      }

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-compact-teams-collapsed-${viewportName}.png`),
        fullPage: true,
      });

      const expandA = page.waitForResponse(
        (r) => r.url().includes("/responsibles") && r.url().includes(ROP_A) && r.status() === 200,
      );
      await teamCard(page, "ROP Alpha").locator(".clients-compact-team__toggle").click();
      await expandA;
      assert.match(page.url(), /teamExpand=/);

      const expandB = page.waitForResponse(
        (r) => r.url().includes("/responsibles") && r.url().includes(ROP_B) && r.status() === 200,
      );
      await teamCard(page, "ROP Beta").locator(".clients-compact-team__toggle").click();
      await expandB;

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-compact-teams-expanded-${viewportName}.png`),
        fullPage: true,
      });

      await page.click("#clients-team-collapse-all");
      await page.waitForFunction(
        () =>
          new URL(window.location.href).searchParams.getAll("teamExpand").length === 0 &&
          !new URL(window.location.href).searchParams.get("teamQ"),
      );
      await page.fill("#clients-team-search-input", "Manager One");
      await page.waitForFunction(
        () => new URL(window.location.href).searchParams.get("teamQ") === "Manager One",
      );
      await teamCard(page, "ROP Alpha")
        .locator(".clients-compact-team__member-name", { hasText: "Manager One" })
        .waitFor({ state: "visible", timeout: 15000 });
      assert.ok(
        await teamCard(page, "ROP Alpha")
          .locator(".clients-compact-team__member-name", { hasText: "Manager One" })
          .isVisible(),
      );

      await page.fill("#clients-team-search-input", "");
      await page.waitForFunction(
        () => !new URL(window.location.href).searchParams.get("teamQ"),
      );
      await page.selectOption("#clients-team-kind-filter", "regional");
      await page.waitForFunction(
        () => new URL(window.location.href).searchParams.get("teamKind") === "regional",
      );
      assert.match(page.url(), /teamKind=regional/);

      await teamCard(page, "ROP Beta")
        .locator(".clients-compact-team__member-name", { hasText: "Regional One" })
        .waitFor({ state: "visible", timeout: 15000 });

      const listResp = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/clients" && r.status() === 200,
      );
      await teamCard(page, "ROP Beta")
        .locator('.clients-compact-team__count:has-text("клиентов"):has-text("региональный")')
        .click();
      await listResp;
      const savedUrl = page.url();
      await page.goBack({ waitUntil: "networkidle" });
      assert.match(page.url(), /teamExpand=/);
      assert.match(page.url(), /teamKind=regional/);

      await page.goto(savedUrl, { waitUntil: "networkidle" });
      await page.goBack({ waitUntil: "networkidle" });
      assert.match(page.url(), /teamExpand=/);

      await page.click("#clients-team-collapse-all");
      await page.waitForFunction(
        () =>
          new URL(window.location.href).searchParams.getAll("teamExpand").length === 0 &&
          !new URL(window.location.href).searchParams.get("teamQ") &&
          !new URL(window.location.href).searchParams.get("teamKind"),
      );
      assert.equal(new URL(page.url()).searchParams.getAll("teamExpand").length, 0);
      assert.equal(new URL(page.url()).searchParams.get("teamQ"), null);
      assert.equal(new URL(page.url()).searchParams.get("teamKind"), null);

      await context.close();
    }

    await stopServer();
  });

  it("ROP sees only own expanded team; foreign branch forbidden", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "rop-a@example.com");
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
    await page.waitForSelector(".clients-compact-team-list--single .clients-compact-team__member");
    assert.equal(await page.locator(".clients-compact-team__name").count(), 0);
    assert.ok(await page.locator(".clients-compact-team__member-name").count());

    const app = (await import("../../src/server")).createApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "rop-a@example.com", password: TEST_PASSWORD });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const foreign = await request(app)
      .get(`/api/clients/org-structure/${ROP_B}/responsibles`)
      .set({ Origin: baseUrl, Cookie: cookie });
    assert.equal(foreign.status, 403);
    await page.close();
    await stopServer();
  });
});
