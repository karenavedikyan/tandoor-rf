import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Pool } from "pg";
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
const M3 = "33333333-3333-4333-8333-333333333333";
const M_NO_ACCOUNT = "66666666-6666-4666-8666-666666666666";
const R1 = "55555555-5555-4555-8555-555555555555";

const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "88888888-8888-4888-8888-888888888888";
const C3_T3 = "88888888-8888-4888-8888-888888888803";
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
    regional?: { guid: string; name: string };
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
      : emptyRef(),
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
          ? { guid: outlet.manager.guid, name: "Manager", state: "directory_unverified" }
          : { guid: M1, name: "Manager One", state: "directory_unverified" },
        regionalManager: outlet.regional
          ? { guid: outlet.regional.guid, name: "Regional", state: "directory_unverified" }
          : emptyRef(),
        hardwareManager: emptyRef(),
        headOfSales: outlet.rop
          ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
          : emptyRef(),
      },
      contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
      lpr: {
        name: "",
        post: "",
        dateOfBirth: null,
        phone: "",
        email: "",
        bonus: "",
        conditionsBonus: "",
      },
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

describe("clients design D3 — ROP team screen", () => {
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
    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop-a-nav@example.com",
      password: TEST_PASSWORD,
      fullName: "Сидоров Пётр Николаевич",
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
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 7)
        ON CONFLICT (id) DO UPDATE SET employee_count = 7
      `,
      ["b".repeat(64)],
    );
    for (const [guid, name, post] of [
      [ROP_A, "ROP Alpha", "Руководитель отдела продаж"],
      [ROP_B, "ROP Beta", "Руководитель отдела продаж"],
      [M1, "Manager One", "Менеджер"],
      [M2, "Manager Two", "Менеджер"],
      [M3, "Manager Three", "Менеджер"],
      [M_NO_ACCOUNT, "No Account Manager", "Менеджер"],
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
      {
        guid_client: "44444444-4444-4444-8444-444444444444",
        name_client: "No Account Client",
        guid_manager: M_NO_ACCOUNT,
        name_manager: "No Account Manager",
      },
    ]);

    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M1, name: "Manager One" },
        clientRegional: { guid: R1, name: "Regional One" },
        outlets: [
          { guidStore: T1, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M3, name: "Manager Three" } },
          {
            guidStore: T2,
            rop: { guid: ROP_A, name: "ROP Alpha" },
            manager: { guid: M3, name: "Manager Three" },
            regional: { guid: R1, name: "Regional One" },
          },
        ],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      branchSnapshot({
        clientRop: { guid: ROP_B, name: "ROP Beta" },
        clientRegional: { guid: R1, name: "Regional One" },
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({
        outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      "44444444-4444-4444-8444-444444444444",
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M_NO_ACCOUNT, name: "No Account Manager" },
      }),
    );

    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1 },
      { guid_store: T2, guid_client: C1 },
      { guid_store: C3_T3, guid_client: C3 },
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

  async function waitForTeamLoaded(page: Page): Promise<void> {
    await page.waitForSelector("#clients-manager-chrome:not(.clients-hidden)");
    await page.waitForSelector(".clients-team-card-shell");
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

  it("ROP: team home and employee list screenshots, honest card E2E", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "rop-a-nav@example.com");

      await page.goto("/clients", { waitUntil: "networkidle" });
      await waitForTeamLoaded(page);

      assert.equal(await page.locator("#clients-page-title").textContent(), "Клиенты моей команды");
      assert.match(await page.locator("#clients-page-subtitle").textContent(), /Команда, собственные назначения/);
      assert.match(await page.locator("#clients-employee-name").textContent(), /Сидоров Пётр Николаевич/);
      assert.equal(await page.locator("#clients-employee-role").textContent(), "РОП");
      assert.match(await page.locator("#clients-employee-scope-value").textContent(), /Моя команда и собственные назначения/);
      assert.match(page.url(), new RegExp("ropEmployee=" + ROP_A.replace(/-/g, "\\-")));
      assert.match(await page.locator(".clients-team-card-shell__title").textContent(), /ROP Alpha/);
      assert.match(await page.locator(".clients-team-group__title").first().textContent(), /Менеджеры продаж/);
      assert.ok((await page.locator(".clients-team-member-row").count()) >= 2);
      assert.ok(await page.locator(".clients-team-member-row").filter({ hasText: "No Account Manager" }).count());
      assert.equal(await page.locator(".clients-team-own-row").count(), 0);
      assert.equal(await page.locator(".clients-workspace-nav.clients-hidden").count(), 1);
      assert.equal(await page.locator("#clients-breadcrumbs.clients-hidden").count(), 1);
      assert.equal(await page.locator('#view-switcher [data-view="all"]').textContent(), "Клиенты команды");
      assert.equal(await page.locator('#view-switcher [data-view="teams"]').textContent(), "Моя команда");
      assert.match(
        await page.locator(".clients-team-group", { hasText: "Региональные менеджеры" }).textContent(),
        /Regional/,
      );

      const overview = await page.evaluate(async () => {
        const res = await fetch("/api/clients/org-structure", { credentials: "include" });
        return res.json();
      });
      const ropSummary = overview.rops[0];
      assert.equal(ropSummary.uniqueClientCount, 2);
      assert.equal(ropSummary.uniqueOutletCount, 1);
      assert.equal(await page.locator("#clients-stat-clients").textContent(), "2");
      assert.equal(await page.locator("#clients-stat-outlets").textContent(), "1");

      if (viewportName === "desktop") {
        await page.click('#view-switcher [data-view="all"]');
        await page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/clients" &&
            new URL(response.url()).searchParams.get("view") === "all" &&
            response.status() === 200,
        );
        await page.click('#view-switcher [data-view="teams"]');
        await page.waitForSelector(".clients-team-card-shell");
      }

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-design-d3-rop-team-${viewportName}.png`),
        fullPage: true,
      });

      const regionalRow = page.locator(".clients-team-group", { hasText: "Региональные менеджеры" }).locator(
        ".clients-team-member-row",
      );
      const regionalListResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/clients" &&
          url.searchParams.get("view") === "teams" &&
          url.searchParams.get("regionalManager") === R1 &&
          url.searchParams.get("responsibleKind") === "regional" &&
          response.status() === 200
        );
      });
      await regionalRow.locator('.clients-team-member-row__count:has-text("клиентов")').click();
      await regionalListResponse;
      await waitForListLoaded(page, viewport);
      assert.match(page.url(), /responsibleKind=regional/);
      assert.match(page.url(), new RegExp("regionalManager=" + R1.replace(/-/g, "\\-")));
      await page.locator("#clients-breadcrumbs-back").click();
      await page.waitForSelector(".clients-team-card-shell");

      const managerRow = page.locator(".clients-team-member-row", { hasText: "Manager One" });
      const listResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/clients" &&
          url.searchParams.get("view") === "teams" &&
          url.searchParams.get("manager") === M1 &&
          url.searchParams.get("responsibleKind") === "manager" &&
          response.status() === 200
        );
      });
      await managerRow.locator('.clients-team-member-row__count:has-text("клиентов")').click();
      await listResponse;
      await waitForListLoaded(page, viewport);

      assert.match(page.url(), new RegExp("manager=" + M1.replace(/-/g, "\\-")));
      assert.match(page.url(), /responsibleKind=manager/);
      assert.match(await page.locator("#clients-breadcrumbs-row").textContent(), /Моя команда/);
      const listBody =
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText();
      assert.ok(listBody.includes("Client C1") || listBody.includes("No Account"));
      assert.ok(!listBody.includes("Client C2"));

      const cardApi = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          response.url().includes(`/api/clients/${C1}`) &&
          !response.url().includes("/catalog/"),
      );
      if (viewport.width >= 768) {
        await page.locator('.clients-link[href*="/clients/' + C1 + '"]').first().click();
      } else {
        await page.locator('.clients-card .clients-link[href*="/clients/' + C1 + '"]').first().click();
      }
      const cardResponse = await cardApi;
      assert.equal(cardResponse.status(), 200);
      await page.waitForSelector("#client-detail:not(.clients-hidden)");
      await page.goBack({ waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      await page.reload({ waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      assert.match(page.url(), /responsibleKind=manager/);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, "page should not overflow horizontally on " + viewportName);

      await context.close();
    }

    await stopServer();
  });
});
