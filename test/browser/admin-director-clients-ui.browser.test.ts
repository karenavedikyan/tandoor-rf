import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import request from "supertest";
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

const DIRECTOR = ORG_DIRECTOR_EMPLOYEE_GUID;
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const R1 = "55555555-5555-4555-8555-555555555555";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "88888888-8888-4888-8888-888888888888";
const C_BOTH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

function emptyRef() {
  return { guid: null, name: "", state: "not_provided" as const };
}

function branchSnapshot(input: {
  clientRop?: { guid: string; name: string };
  clientManager?: { guid: string; name: string };
  clientRegional?: { guid: string; name: string };
  outlets?: Array<{
    guidStore: string;
    rop?: { guid: string; name: string };
    manager?: { guid: string; name: string };
  }>;
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
      : emptyRef(),
    hardwareManager: emptyRef(),
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
      address: { storeAddress: "Addr " + outlet.guidStore.slice(0, 8), deliveryAddress: "", routeDirection: "" },
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
          ? { guid: outlet.manager.guid, name: outlet.manager.name || "Manager", state: "directory_unverified" }
          : { guid: M1, name: "Manager One", state: "directory_unverified" },
        regionalManager: emptyRef(),
        hardwareManager: emptyRef(),
        headOfSales: outlet.rop
          ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
          : emptyRef(),
      },
      contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
      lpr: { name: "", post: "", dateOfBirth: null, phone: "", email: "", bonus: "", conditionsBonus: "" },
      additional: { statusTandoorClub: "", bonusTandoorClub: "" },
      provenance: {
        freshness: "current",
        sourceSha256: "a".repeat(64),
        importedAt: "2026-01-01T10:00:00.000Z",
      },
      distributionAllowed: false,
    })),
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("admin director clients UI browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;
  let managerUserId = "";

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
      fullName: "Admin Full Name",
      role: "admin",
    });
    const directorUser = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Гончаренко Дмитрий",
      role: "director",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    managerUserId = manager.id;

    await linkUserToEmployee({
      databaseUrl,
      userId: directorUser.id,
      employeeId: DIRECTOR,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 6)
        ON CONFLICT (id) DO UPDATE SET employee_count = 6
      `,
      ["b".repeat(64)],
    );
    for (const [guid, name, post] of [
      [DIRECTOR, "Гончаренко Дмитрий", "Директор"],
      [ROP_A, "ROP Alpha", "Руководитель отдела продаж"],
      [ROP_B, "ROP Beta", "Руководитель отдела продаж"],
      [M1, "Manager One", "Менеджер"],
      [M2, "Manager Two", "Менеджер"],
      [M3, "Manager Three", "Менеджер"],
      [R1, "Regional One", "Региональный менеджер"],
    ] as const) {
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, $3, '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post
        `,
        [guid, name, post],
      );
    }
    await pool.end();

    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client C1", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client C2", guid_manager: R1, name_manager: "Regional One" },
      { guid_client: C3, name_client: "Client C3", guid_manager: M2, name_manager: "Manager Two" },
      { guid_client: C_BOTH, name_client: "Client Both Missing", guid_manager: "00000000-0000-0000-0000-000000000000", name_manager: "Missing" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      branchSnapshot({ clientRop: { guid: ROP_B, name: "ROP Beta" }, clientRegional: { guid: R1, name: "Regional One" } }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M1, name: "Manager One" },
        outlets: [
          { guidStore: T1, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" } },
          { guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" } },
        ],
      }),
    );
    await updateClientExtendedSnapshot(databaseUrl, C_BOTH, branchSnapshot({}));
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1 },
      { guid_store: T2, guid_client: C1 },
    ]);
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

  async function newSession(viewport: typeof DESKTOP | typeof MOBILE): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport, baseURL: baseUrl });
    const page = await context.newPage();
    return { context, page };
  }

  async function waitForTeamsOverview(page: Page): Promise<void> {
    await page.waitForSelector("#clients-manager-chrome:not(.clients-hidden)");
    await page.waitForSelector(".clients-compact-team-list .clients-compact-team");
    await page.waitForFunction(
      () => document.querySelectorAll(".clients-compact-team-list .clients-compact-team").length >= 2,
      undefined,
      { timeout: 30000 },
    );
  }

  async function waitForListLoaded(page: Page, viewport: { width: number }): Promise<void> {
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) {
          return false;
        }
        return (
          document.querySelectorAll(".clients-card").length > 0 ||
          document.querySelectorAll("#clients-table-body tr").length > 0
        );
      },
      undefined,
      { timeout: 30000 },
    );
    if (viewport.width < 768) {
      await page.waitForSelector(".clients-card", { state: "attached", timeout: 5000 });
    } else {
      await page.waitForSelector("#clients-table-body tr", { state: "visible", timeout: 5000 });
    }
  }

  function teamCard(page: Page, ropTitle: string) {
    return page.locator(".clients-compact-team").filter({
      has: page.locator(".clients-compact-team__name", { hasText: ropTitle }),
    });
  }

  async function assertAdminAccessNav(page: Page): Promise<void> {
    await page.waitForSelector('a[href="/admin/access"]', { state: "attached" });
    assert.match(await page.locator('a[href="/admin/access"]').innerText(), /Настройка доступа/);
  }

  it("admin: director UI, navigation, access menu, preview, review permissions", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "admin@example.com");

      await page.goto("/clients", { waitUntil: "networkidle" });
      await waitForTeamsOverview(page);
      await assertAdminAccessNav(page);

      assert.equal(await page.locator("#clients-page-title").textContent(), "Вся клиентская база");
      assert.match(await page.locator("#clients-page-subtitle").textContent(), /Команды, клиенты и торговые точки/);
      assert.match(await page.locator("#clients-employee-name").textContent(), /Admin Full Name/);
      assert.equal(await page.locator("#clients-employee-role").textContent(), "Администратор");
      assert.equal(await page.locator("body.clients-role-director").count(), 1);
      assert.equal(await page.locator('#view-review-tab').textContent(), "Ревизии");

      const presentation = await page.evaluate(async () => {
        const res = await fetch("/api/clients/presentation", { credentials: "include" });
        const data = await res.json();
        return data.presentation || data;
      });
      assert.equal(presentation.businessRole, "admin");
      assert.equal(presentation.reviewReadOnly, false);
      assert.equal(presentation.directorLayout, true);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `admin-director-clients-teams-${viewportName}.png`),
        fullPage: true,
      });

      const ropACard = teamCard(page, "ROP Alpha");
      const expandAlpha = page.waitForResponse(
        (response) =>
          response.url().includes("/responsibles") &&
          response.url().includes(ROP_A) &&
          response.status() === 200,
      );
      await ropACard.locator(".clients-compact-team__toggle").click();
      await expandAlpha;
      await page.waitForSelector(
        '.clients-compact-team[data-rop-employee="' + ROP_A + '"] .clients-compact-team__member',
        { timeout: 15000 },
      );
      const ropACardExpanded = teamCard(page, "ROP Alpha");
      const employeeBtn = ropACardExpanded.locator(
        '[data-responsible-entity="clients"][data-manager="' + M1 + '"]',
      );
      await employeeBtn.waitFor({ state: "visible", timeout: 15000 });
      await employeeBtn.click();
      await waitForListLoaded(page, viewport);
      const listText =
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText();
      assert.match(listText, /Client C1/);

      await page.getByRole("link", { name: /Client C1/i }).first().click();
      await page.waitForURL(new RegExp("/clients/" + C1), { timeout: 15000 });
      await page.waitForSelector("#client-detail:not(.clients-hidden)", { timeout: 15000 });
      await assertAdminAccessNav(page);
      await page.waitForSelector("#client-review-host");
      assert.equal(await page.locator("#client-review-host").count(), 1);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `admin-director-clients-card-${viewportName}.png`),
        fullPage: true,
      });

      await page.goBack({ waitUntil: "networkidle" });
      await page.locator("#clients-breadcrumbs-back").click();
      await waitForTeamsOverview(page);

      const queueResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients/completeness-queue") && response.status() === 200,
      );
      await page.goto("/clients?view=completeness", { waitUntil: "networkidle" });
      await queueResponse;
      await waitForListLoaded(page, viewport);
      assert.match(
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText(),
        /Client Both Missing/,
      );
      await assertAdminAccessNav(page);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `admin-director-clients-completeness-${viewportName}.png`),
        fullPage: true,
      });

      await page.goto("/profile", { waitUntil: "networkidle" });
      await assertAdminAccessNav(page);

      await context.close();
    }

    const { context, page } = await newSession(DESKTOP);
    await login(page, "admin@example.com");
    await page.goto("/admin/access", { waitUntil: "networkidle" });
    await page.fill("#preview-search-input", "manager-a");
    await page.click("#preview-search-btn");
    await page.waitForSelector('[data-preview-user="' + managerUserId + '"]');
    const startResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/access/preview/start") && response.status() === 200,
    );
    await page.click('[data-preview-user="' + managerUserId + '"]');
    await startResponse;
    await page.waitForURL(/\/clients/, { timeout: 15000 });
    await page.waitForSelector(".clients-preview-banner");
    assert.equal(await page.locator('a[href="/admin/access"]').count(), 0);
    assert.equal(await page.locator("body.clients-role-director").count(), 0);
    assert.match(await page.locator("#clients-employee-name").textContent(), /Manager A/);
    assert.equal(await page.locator("#clients-employee-role").textContent(), "Менеджер");

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "admin-director-clients-preview-manager.png"),
      fullPage: true,
    });

    const stopResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/access/preview/stop") && response.status() === 200,
    );
    await page.click("#clients-preview-stop-btn");
    await stopResponse;
    await page.waitForURL(/\/admin\/access/, { timeout: 15000 });
    await context.close();

    const app = (await import("../../src/server")).createApp();

    const adminLogin = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "admin@example.com", password: TEST_PASSWORD });
    const adminCookie = adminLogin.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const adminWrite = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set({ Origin: baseUrl, "Content-Type": "application/json", Cookie: adminCookie })
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "admin ok",
        expectedVersion: null,
      });
    assert.equal(adminWrite.status, 200);

    const directorLogin = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "director@example.com", password: TEST_PASSWORD });
    const directorCookie = directorLogin.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const directorWrite = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set({ Origin: baseUrl, "Content-Type": "application/json", Cookie: directorCookie })
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "director blocked",
        expectedVersion: null,
      });
    assert.equal(directorWrite.status, 403);

    const previewStart = await request(app)
      .post("/api/admin/access/preview/start")
      .set({ Origin: baseUrl, "Content-Type": "application/json", Cookie: adminCookie })
      .send({ targetUserId: managerUserId });
    assert.equal(previewStart.status, 200);
    const previewWrite = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set({ Origin: baseUrl, "Content-Type": "application/json", Cookie: adminCookie })
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "preview blocked",
        expectedVersion: null,
      });
    assert.equal(previewWrite.status, 403);

    await stopServer();
  });
});
