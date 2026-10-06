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
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const T1 = "11111111-1111-4111-8111-111111111112";
const T2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

function emptyRef() {
  return { guid: null, name: "", state: "not_provided" as const };
}

function branchSnapshot(input: {
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
    regionalManager: emptyRef(),
    hardwareManager: emptyRef(),
    headOfSales: { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: false,
      address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
      loading: {},
      managers: {
        manager: outlet.manager
          ? { guid: outlet.manager.guid, name: "Manager A", state: "directory_unverified" }
          : { guid: MANAGER_A, name: "Manager A", state: "directory_unverified" },
        regionalManager: emptyRef(),
        hardwareManager: emptyRef(),
        headOfSales: outlet.rop
          ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
          : { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
      },
    })),
  };
}

describe("clients design D1 — manager screen", () => {
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
    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Иванов Иван Иванович",
      role: "manager",
    });

    await linkUserToEmployee({
      databaseUrl,
      userId: managerUser.id,
      employeeId: MANAGER_A,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 2)
        ON CONFLICT (id) DO UPDATE SET employee_count = 2
      `,
      ["b".repeat(64)],
    );
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
        VALUES ($1::uuid, $2, 'Менеджер', '{}'::jsonb)
        ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
      `,
      [MANAGER_A, "Manager A"],
    );
    await pool.end();

    await insertSuccessfulImportRun(databaseUrl, { recordCount: 2 });
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Alpha Client", guid_manager: MANAGER_A, name_manager: "Manager A" },
      { guid_client: C2, name_client: "No Outlet Client", guid_manager: MANAGER_A, name_manager: "Manager A" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        outlets: [{ guidStore: T1, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: MANAGER_A, name: "Manager A" } }],
      }),
    );
    await updateClientExtendedSnapshot(databaseUrl, C2, branchSnapshot({ outlets: [] }));
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: T1, guid_client: C1 }]);
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
      await page.waitForSelector(".clients-card", { state: "attached", timeout: 5000 }).catch(() => {});
    } else {
      await page.waitForSelector("#clients-table-body tr", { state: "visible", timeout: 5000 });
    }
  }

  it("manager: prototype chrome, filters, outlets, card navigation, screenshots", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page, "manager-a@example.com");

      await page.goto("/clients", { waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);

      assert.equal(await page.locator("#clients-page-title").textContent(), "Мои клиенты");
      await page.waitForSelector("#clients-manager-chrome:not(.clients-hidden)");
      assert.match(await page.locator("#clients-employee-name").textContent(), /Иванов Иван Иванович/);
      assert.equal(await page.locator("#clients-employee-role").textContent(), "Менеджер");
      assert.equal(await page.locator("#clients-employee-avatar").textContent(), "ИИ");
      assert.match(await page.locator(".clients-workspace-nav__tab").textContent(), /Моя база/);

      const statClients = await page.locator("#clients-stat-clients").textContent();
      const statOutlets = await page.locator("#clients-stat-outlets").textContent();
      const statNoOutlets = await page.locator("#clients-stat-no-outlets").textContent();
      assert.match(statClients ?? "", /^\d+$/);
      assert.match(statOutlets ?? "", /^\d+$/);
      assert.match(statNoOutlets ?? "", /^\d+$/);

      await page.fill("#search-input", "Alpha");
      const filterResponse = page.waitForResponse(
        (response) => response.url().includes("/api/clients") && response.url().includes("q=Alpha") && response.status() === 200,
      );
      await filterResponse;
      await waitForListLoaded(page, viewport);

      const outletsResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients") &&
          response.url().includes("entity=outlets") &&
          response.status() === 200,
      );
      await page.click('[data-entity="outlets"]');
      await outletsResponse;
      await waitForListLoaded(page, viewport);

      if (viewport.width >= 768) {
        await page.click('.clients-link[href*="/clients/"]');
      } else {
        await page.click('.clients-card .clients-link');
      }
      await page.waitForURL(/\/clients\/[^/?]+/, { timeout: 15000 });
      await page.goBack({ waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);

      await page.reload({ waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
      assert.equal(await page.locator("#clients-page-title").textContent(), "Мои клиенты");

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-design-d1-manager-${viewportName}.png`),
        fullPage: true,
      });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, "page should not overflow horizontally on " + viewportName);

      await context.close();
    }

    await stopServer();
  });
});
