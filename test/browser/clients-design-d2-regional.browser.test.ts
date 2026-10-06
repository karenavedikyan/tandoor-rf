import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Pool } from "pg";
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

const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const REGIONAL_EMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const C1 = "11111111-1111-4111-8111-111111111111";
const C_REGIONAL = "12121212-1212-4121-8121-121212121212";

const T1 = "11111111-1111-4111-8111-111111111112";
const T1B = "11111111-1111-4111-8111-111111111113";
const T_REGIONAL = "13131313-1313-4131-8131-131313131313";

const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

function emptyRef() {
  return { guid: null, name: "", state: "not_provided" as const };
}

function branchSnapshot(input: {
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
    regionalManager: emptyRef(),
    hardwareManager: emptyRef(),
    headOfSales: { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
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
          ? { guid: outlet.manager.guid, name: "Manager B", state: "directory_unverified" }
          : { guid: MANAGER_A, name: "Manager A", state: "directory_unverified" },
        regionalManager: outlet.regional
          ? { guid: outlet.regional.guid, name: "Regional Mgr", state: "directory_unverified" }
          : emptyRef(),
        hardwareManager: emptyRef(),
        headOfSales: outlet.rop
          ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
          : { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
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
  };
}

describe("clients design D2 — regional manager screen", () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;
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
    regionalUserId = (
      await createTestUser({
        databaseUrl,
        email: "regional@example.com",
        password: TEST_PASSWORD,
        fullName: "Петрова Анна Сергеевна",
        role: "regional_manager",
      })
    ).id;

    await linkUserToEmployee({
      databaseUrl,
      userId: regionalUserId,
      employeeId: REGIONAL_EMP,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 3)
        ON CONFLICT (id) DO UPDATE SET employee_count = 3
      `,
      ["b".repeat(64)],
    );
    for (const [guid, name] of [
      [ROP_A, "ROP Alpha"],
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

    await insertSuccessfulImportRun(databaseUrl, { recordCount: 2 });
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Alpha Client", guid_manager: MANAGER_A, name_manager: "Manager A" },
      {
        guid_client: C_REGIONAL,
        name_client: "Regional Only Client",
        guid_manager: MANAGER_B,
        name_manager: "Manager B",
      },
    ]);

    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        outlets: [
          {
            guidStore: T1,
            rop: { guid: ROP_A, name: "ROP Alpha" },
            regional: { guid: REGIONAL_EMP, name: "Regional Mgr" },
          },
          {
            guidStore: T1B,
            rop: { guid: ROP_B, name: "ROP Beta" },
            regional: { guid: MANAGER_B, name: "Other Regional" },
          },
        ],
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
            regional: { guid: REGIONAL_EMP, name: "Regional Mgr" },
          },
        ],
      }),
    );

    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1 },
      { guid_store: T1B, guid_client: C1 },
      { guid_store: T_REGIONAL, guid_client: C_REGIONAL },
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

  async function newSession(viewport: typeof DESKTOP | typeof MOBILE): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport, baseURL: baseUrl });
    const page = await context.newPage();
    return { context, page };
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

  async function resultsText(page: Page, viewport: { width: number }): Promise<string> {
    if (viewport.width < 768) {
      return (await page.locator("#clients-cards").innerText()) ?? "";
    }
    return (await page.locator("#clients-table-body").innerText()) ?? "";
  }

  async function assertClientCardReady(page: Page): Promise<void> {
    assert.equal(await page.locator("#init-panel.clients-hidden").count(), 1);
    assert.equal(await page.locator("#state-panel.clients-hidden").count(), 1);
    assert.equal(await page.locator("#access-panel.clients-hidden").count(), 1);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
  }

  async function openOutletCard(page: Page, viewport: { width: number }): Promise<void> {
    const cardApi = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes(`/api/clients/${C1}`) &&
        !response.url().includes("/catalog/"),
    );

    if (viewport.width >= 768) {
      await page.locator('.clients-link[href*="/clients/' + C1 + '"][href*="store=' + T1 + '"]').first().click();
    } else {
      await page
        .locator('.clients-card .clients-link[href*="/clients/' + C1 + '"][href*="store=' + T1 + '"]')
        .first()
        .click();
    }

    const response = await cardApi;
    assert.equal(response.status(), 200, "client card API must return 200, got " + response.status());

    await page.waitForURL(new RegExp("/clients/" + C1.replace(/-/g, "\\-")), { timeout: 15000 });
    await assertClientCardReady(page);
    await page.waitForFunction(
      () => {
        const nameEl = document.getElementById("client-name");
        return Boolean(nameEl && nameEl.textContent && nameEl.textContent.includes("Alpha Client"));
      },
      undefined,
      { timeout: 15000 },
    );
    assert.match(await page.locator("#client-name").textContent(), /Alpha Client/);
  }

  it("regional: home outlets and clients mode, honest card E2E", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "regional@example.com");

      await page.goto("/clients", { waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);

      assert.equal(await page.locator("#clients-page-title").textContent(), "Мои торговые точки");
      assert.match(await page.locator("#clients-page-subtitle").textContent(), /Закреплённые торговые точки/);
      await page.waitForSelector("#clients-manager-chrome:not(.clients-hidden)");
      assert.match(await page.locator("#clients-employee-name").textContent(), /Петрова Анна Сергеевна/);
      assert.equal(await page.locator("#clients-employee-role").textContent(), "Региональный менеджер");
      assert.match(
        await page.locator("#clients-employee-scope-value").textContent(),
        /Только закреплённые клиенты и торговые точки/,
      );
      assert.equal(await page.locator("#clients-results-title").textContent(), "Доступные торговые точки");
      assert.equal(await page.locator("#rop-filter-wrap.clients-hidden").count(), 1);
      assert.equal(await page.locator("#regional-filter-wrap.clients-hidden").count(), 1);
      assert.equal(await page.locator("#manager-filter-wrap.clients-hidden").count(), 0);

      const bodyOutlets = await resultsText(page, viewport);
      assert.ok(bodyOutlets.includes("Alpha") || bodyOutlets.includes("Regional"));
      assert.ok(!bodyOutlets.includes("ROP Beta"));
      assert.ok(!bodyOutlets.includes(T1B));

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-design-d2-regional-home-${viewportName}.png`),
        fullPage: true,
      });

      const clientsListResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/clients" &&
          url.searchParams.get("entity") !== "outlets" &&
          response.status() === 200
        );
      });
      await page.locator('#entity-switcher [data-entity="clients"]').click();
      await clientsListResponse;
      await waitForListLoaded(page, viewport);
      assert.equal(await page.locator("#clients-results-title").textContent(), "Доступные клиенты");

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-design-d2-regional-clients-${viewportName}.png`),
        fullPage: true,
      });

      const outletsListResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/clients" &&
          url.searchParams.get("entity") === "outlets" &&
          response.status() === 200
        );
      });
      await page.locator('#entity-switcher [data-entity="outlets"]').click();
      await outletsListResponse;
      await waitForListLoaded(page, viewport);

      await openOutletCard(page, viewport);
      await page.goBack({ waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      await page.reload({ waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      assert.equal(await page.locator("#clients-page-title").textContent(), "Мои торговые точки");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, "page should not overflow horizontally on " + viewportName);

      await context.close();
    }

    await stopServer();
  });
});
