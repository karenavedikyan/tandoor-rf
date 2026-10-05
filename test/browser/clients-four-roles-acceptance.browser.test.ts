import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  grantClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
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

const DIRECTOR_EMP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const REGIONAL_EMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const C3 = "33333333-3333-4333-8333-333333333333";
const C_REGIONAL = "12121212-1212-4121-8121-121212121212";
const C_INCOMPLETE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const T1 = "11111111-1111-4111-8111-111111111112";
const T1B = "11111111-1111-4111-8111-111111111113";
const T2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T_REGIONAL = "13131313-1313-4131-8131-131313131313";
const T_INCOMPLETE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

function emptyRef() {
  return { guid: null, name: "", state: "not_provided" as const };
}

function branchSnapshot(input: {
  clientRop?: { guid: string; name: string };
  outlets?: Array<{
    guidStore: string;
    rop?: { guid: string; name: string };
    manager?: { guid: string; name: string };
    regional?: { guid: string; name: string };
    closed?: boolean;
  }>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: emptyRef(),
    hardwareManager: emptyRef(),
    headOfSales: input.clientRop
      ? { guid: input.clientRop.guid, name: input.clientRop.name, state: "directory_unverified" }
      : { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: false,
      address: { storeAddress: "Addr " + outlet.guidStore.slice(0, 8), deliveryAddress: "", routeDirection: "" },
      loading: {},
      managers: {
        manager: outlet.manager
          ? { guid: outlet.manager.guid, name: "Manager", state: "directory_unverified" }
          : { guid: MANAGER_A, name: "Manager A", state: "directory_unverified" },
        regionalManager: outlet.regional
          ? { guid: outlet.regional.guid, name: "Regional", state: "directory_unverified" }
          : emptyRef(),
        hardwareManager: emptyRef(),
        headOfSales: outlet.rop
          ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
          : { guid: null, name: "", state: "unassigned" },
      },
      contacts: {},
      lpr: {},
      additional: {},
      outletGuidStatus: "confirmed",
      closed: outlet.closed ?? false,
      closureStatus: outlet.closed ? "closed" : "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      provenance: {
        freshness: "current",
        sourceSha256: "a".repeat(64),
        importedAt: new Date().toISOString(),
      },
      distributionAllowed: false,
    })),
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients four roles acceptance (real PostgreSQL)", { concurrency: false }, () => {
  let browser: Browser;
  let databaseUrl = "";
  let baseUrl = "";
  let server: http.Server;
  let regionalUserId = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seedDatabase(): Promise<void> {
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
    const directorUser = await createTestUser({
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
      fullName: "ROP Alpha",
      role: "rop",
    });
    const managerAUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "manager-b@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager B",
      role: "manager",
    });
    regionalUserId = (
      await createTestUser({
        databaseUrl,
        email: "regional@example.com",
        password: TEST_PASSWORD,
        fullName: "Regional",
        role: "regional_manager",
      })
    ).id;

    for (const [userId, employeeId] of [
      [directorUser.id, DIRECTOR_EMP],
      [ropUser.id, ROP_A],
      [managerAUser.id, MANAGER_A],
      [regionalUserId, REGIONAL_EMP],
    ] as const) {
      await linkUserToEmployee({
        databaseUrl,
        userId,
        employeeId,
        confirmedByUserId: admin.id,
      });
    }

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 5)
        ON CONFLICT (id) DO UPDATE SET employee_count = 5
      `,
      ["b".repeat(64)],
    );
    for (const [guid, name] of [
      [ROP_A, "ROP Alpha"],
      [ROP_B, "ROP Beta"],
      [MANAGER_A, "Manager A"],
      [MANAGER_B, "Manager B"],
      [REGIONAL_EMP, "Regional Mgr"],
    ] as const) {
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, 'Менеджер', '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
        `,
        [guid, name],
      );
    }
    await pool.end();

    await insertSuccessfulImportRun(databaseUrl, { recordCount: 5 });
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Alpha Client", guid_manager: MANAGER_A, name_manager: "Manager A" },
      { guid_client: C2, name_client: "Outlet Only Client", guid_manager: MANAGER_A, name_manager: "Manager A" },
      { guid_client: C3, name_client: "Beta Client", guid_manager: MANAGER_B, name_manager: "Manager B" },
      { guid_client: C_REGIONAL, name_client: "Regional Client", guid_manager: MANAGER_B, name_manager: "Manager B" },
      { guid_client: C_INCOMPLETE, name_client: "Incomplete Client", guid_manager: MANAGER_A, name_manager: "Manager A" },
    ]);

    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        outlets: [
          { guidStore: T1, rop: { guid: ROP_A, name: "ROP Alpha" }, regional: { guid: REGIONAL_EMP, name: "Regional" } },
          { guidStore: T1B, rop: { guid: ROP_B, name: "ROP Beta" }, regional: { guid: MANAGER_B, name: "Other" } },
        ],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      branchSnapshot({
        outlets: [{ guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: MANAGER_A, name: "Manager A" } }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_REGIONAL,
      branchSnapshot({
        outlets: [
          {
            guidStore: T_REGIONAL,
            manager: { guid: MANAGER_B, name: "Manager B" },
            regional: { guid: REGIONAL_EMP, name: "Regional" },
          },
        ],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_INCOMPLETE,
      branchSnapshot({
        outlets: [{ guidStore: T_INCOMPLETE, manager: { guid: MANAGER_A, name: "Manager A" } }],
      }),
    );

    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1 },
      { guid_store: T1B, guid_client: C1 },
      { guid_store: T2, guid_client: C2 },
      { guid_store: T_REGIONAL, guid_client: C_REGIONAL },
      { guid_store: T_INCOMPLETE, guid_client: C_INCOMPLETE },
    ]);

    await grantClientAccess({
      databaseUrl,
      userId: regionalUserId,
      objectId: C1,
      grantedByUserId: admin.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: regionalUserId,
      objectId: C_REGIONAL,
      grantedByUserId: admin.id,
    });
  }

  async function startServer(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl);
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async function login(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  async function screenshotRole(role: string, viewport: "desktop" | "mobile", page: Page): Promise<void> {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `acceptance-${role}-${viewport}.png`),
      fullPage: true,
    });
  }

  async function newSession(viewport: typeof DESKTOP | typeof MOBILE): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport, baseURL: baseUrl });
    const page = await context.newPage();
    return { context, page };
  }

  function isMobileViewport(viewport: { width: number }): boolean {
    return viewport.width < 768;
  }

  async function waitForListLoaded(page: Page, viewport: { width: number }): Promise<void> {
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) {
          return false;
        }
        const cards = document.querySelectorAll(".clients-card").length;
        const rows = document.querySelectorAll("#clients-table-body tr").length;
        return cards > 0 || rows > 0;
      },
      undefined,
      { timeout: 30000 },
    );
    if (isMobileViewport(viewport)) {
      await page.waitForSelector(".clients-card", { state: "attached", timeout: 5000 }).catch(() => {});
    } else {
      await page.waitForSelector("#clients-table-body tr", { state: "visible", timeout: 5000 });
    }
  }

  async function resultsText(page: Page, viewport: { width: number }): Promise<string> {
    if (isMobileViewport(viewport)) {
      return (await page.locator("#clients-cards").innerText()) ?? "";
    }
    return (await page.locator("#clients-table-body").innerText()) ?? "";
  }

  async function assertCounterMatchesList(page: Page, viewport: { width: number }): Promise<void> {
    const countText = await page.locator("#result-count").textContent();
    const rows = isMobileViewport(viewport)
      ? await page.locator(".clients-card").count()
      : await page.locator("#clients-table-body tr").count();
    const match = countText?.match(/(\d+)/);
    if (match) {
      assert.equal(Number(match[1]), rows, `counter ${countText} vs rows ${rows}`);
    }
  }

  it("director: tree, completeness read-only, branch navigation", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "director@example.com");

      await page.goto("/clients?view=teams");
      await page.waitForSelector('[data-portfolio="clients"]');
      await screenshotRole("director", viewportName, page);

      const branchListResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients") &&
          response.url().includes("ropEmployee") &&
          response.status() === 200,
      );
      await page.click(`[data-portfolio="clients"][data-rop-employee="${ROP_A}"]`);
      await branchListResponse;
      await waitForListLoaded(page, viewport);
      await assertCounterMatchesList(page, viewport);
      assert.match(await resultsText(page, viewport), /Alpha Client/i);

      const completenessResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients/completeness-queue") && response.status() === 200,
      );
      await page.goto("/clients?view=completeness", { waitUntil: "networkidle" });
      await completenessResponse;
      await waitForListLoaded(page, viewport);
      assert.ok(!(await page.locator('[data-action="review-write"]').count()));
      assert.match(await resultsText(page, viewport), /Incomplete/i);
      if (isMobileViewport(viewport)) {
        const card = page.locator(".clients-card").first();
        await card.waitFor({ state: "visible" });
        assert.equal(await card.isVisible(), true);
      }

      await context.close();
    }

    const app = (await import("../../src/server")).createApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "director@example.com", password: TEST_PASSWORD });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const writeReview = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set({ Origin: baseUrl, "Content-Type": "application/json", Cookie: cookie })
      .send({ reviewState: "completed", reviewDecision: "confirm_current_manager", comment: "n/a", expectedVersion: null });
    assert.equal(writeReview.status, 403);

    await stopServer();
  });

  it("ROP: assignment branch without legacy team, clients and outlets", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    const app = (await import("../../src/server")).createApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "rop-a@example.com", password: TEST_PASSWORD });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const foreignBranch = await request(app)
      .get(`/api/clients?view=teams&ropEmployee=${ROP_B}&portfolio=clients`)
      .set({ Origin: baseUrl, Cookie: cookie });
    assert.equal(foreignBranch.status, 403);
    const completeness = await request(app)
      .get("/api/clients/completeness-queue")
      .set({ Origin: baseUrl, Cookie: cookie });
    assert.equal(completeness.status, 403);

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "rop-a@example.com");

      await page.goto("/clients?view=teams");
      await page.waitForSelector(`[data-portfolio="clients"][data-rop-employee="${ROP_A}"]`);
      const clientListResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients") &&
          response.url().includes("portfolio=clients") &&
          response.status() === 200,
      );
      await page.click(`[data-portfolio="clients"][data-rop-employee="${ROP_A}"]`);
      await clientListResponse;
      await waitForListLoaded(page, viewport);
      await assertCounterMatchesList(page, viewport);
      await screenshotRole("rop", viewportName, page);

      await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
      const outletListResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients") &&
          response.url().includes("entity=outlets") &&
          response.status() === 200,
      );
      await page.click(`[data-portfolio="outlets"][data-rop-employee="${ROP_A}"]`);
      await outletListResponse;
      await waitForListLoaded(page, viewport);
      await assertCounterMatchesList(page, viewport);
      const outletText = await resultsText(page, viewport);
      assert.match(outletText, /Alpha Client/i);
      assert.match(outletText, /Outlet Only/i);
      assert.ok(!outletText.includes("Beta Client"));

      const cardLink = isMobileViewport(viewport)
        ? page.locator(".clients-card a.clients-link").first()
        : page.locator("#clients-table-body a.clients-link").first();
      await cardLink.click();
      await page.waitForURL(/\/clients\/[0-9a-f-]+/i);

      await context.close();
    }

    await stopServer();
  });

  it("manager: scoped clients/outlets, no teams access", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    const app = (await import("../../src/server")).createApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "manager-a@example.com", password: TEST_PASSWORD });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const teams = await request(app).get("/api/clients?view=teams").set({ Origin: baseUrl, Cookie: cookie });
    assert.equal(teams.status, 403);
    const foreign = await request(app).get(`/api/clients/${C3}`).set({ Origin: baseUrl, Cookie: cookie });
    assert.equal(foreign.status, 404);

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "manager-a@example.com");

      await page.goto("/clients", { waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      await assertCounterMatchesList(page, viewport);
      const body = await resultsText(page, viewport);
      assert.match(body, /Alpha/i);
      assert.ok(!body.includes("Beta Client"));
      await screenshotRole("manager", viewportName, page);

      await page.goto("/clients?entity=outlets", { waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      const outlets = await resultsText(page, viewport);
      assert.ok(!outlets.includes("Beta Client"));

      await context.close();
    }

    await stopServer();
  });

  it("regional: assigned outlets only, sibling hidden", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    const app = (await import("../../src/server")).createApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "regional@example.com", password: TEST_PASSWORD });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const outletsApi = await request(app)
      .get("/api/clients?entity=outlets")
      .set({ Origin: baseUrl, Cookie: cookie });
    assert.equal(outletsApi.status, 200);
    const guids = outletsApi.body.items.map((i: { guidStore: string }) => i.guidStore);
    assert.ok(guids.includes(T1));
    assert.ok(guids.includes(T_REGIONAL));
    assert.ok(!guids.includes(T1B));
    const foreignDist = await request(app)
      .get(`/api/clients/${C1}/catalog/outlets/${T1B}/distribution`)
      .set({ Origin: baseUrl, Cookie: cookie });
    assert.equal(foreignDist.status, 404);

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "regional@example.com");

      await page.goto("/clients?entity=outlets", { waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      await assertCounterMatchesList(page, viewport);
      const body = await resultsText(page, viewport);
      assert.ok(body.includes("Alpha") || body.includes("Regional"));
      assert.ok(!body.includes("T1B") && !body.includes(ROP_B));
      await screenshotRole("regional", viewportName, page);

      const presentation = await page.evaluate(async () => {
        const res = await fetch("/api/clients/presentation", { credentials: "include" });
        return res.json();
      });
      assert.equal(presentation.presentation.defaultEntity, "outlets");

      await context.close();
    }

    await stopServer();
  });
});
