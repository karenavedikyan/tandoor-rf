import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page, type Response } from "playwright";
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
const M1 = "22222222-2222-4222-8222-222222222222";
const C1 = "11111111-1111-4111-8111-111111111111";
const T1 = "44444444-4444-4444-8444-444444444444";
const T2 = "55555555-5555-5555-8555-555555555555";

const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

const ARTIFACT_SCREENSHOT_DIR = "/opt/cursor/artifacts/screenshots";

describe("F1 LPR filters and card browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.mkdirSync(ARTIFACT_SCREENSHOT_DIR, { recursive: true });
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    if (server) {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
    await closePool();
  });

  async function seed(): Promise<void> {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-f1-browser@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const managerUser = await createTestUser({
      databaseUrl,
      email: "m1-f1-browser@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager",
      role: "manager",
    });

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C1,
        name_client: "Client LPR Browser",
        guid_manager: M1,
        name_manager: "M1",
        address: "Addr",
        telephone: [],
      },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1, is_closed: false },
      { guid_store: T2, guid_client: C1, is_closed: false },
    ]);

    const emptyRef = { guid: null, name: "", state: "not_provided" as const };
    await updateClientExtendedSnapshot(databaseUrl, C1, {
      regionalManager: emptyRef,
      hardwareManager: emptyRef,
      headOfSales: emptyRef,
      currentRetailOutlets: [
        {
          ordinal: 0,
          guidStore: T1,
          holdingName: "H",
          warehouse: false,
          outletGuidStatus: "confirmed",
          closed: false,
          closureStatus: "open",
          closureConfirmedInCurrentExport: true,
          closureHistory: [],
          address: { storeAddress: "Store One", deliveryAddress: "", routeDirection: "" },
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
            manager: { guid: M1, name: "M1", state: "directory_unverified" },
            regionalManager: emptyRef,
            hardwareManager: emptyRef,
            headOfSales: emptyRef,
          },
          contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
          lpr: {
            name: "Browser LPR",
            post: "Owner",
            dateOfBirth: "1990-06-01",
            phone: "+79001234567",
            email: "browser-lpr@example.test",
            bonus: "0",
            conditionsBonus: "Synthetic terms",
            dateOfBirthConfirmedInCurrentExport: true,
            fieldPresence: {
              name: true,
              post: true,
              phone: true,
              email: true,
              bonus: true,
              conditionsBonus: true,
              dateOfBirth: true,
            },
          },
          additional: { statusTandoorClub: "", bonusTandoorClub: "" },
          provenance: {
            freshness: "current",
            sourceSha256: "a".repeat(64),
            importedAt: "2026-01-01T10:00:00.000Z",
          },
          distributionAllowed: false,
        },
        {
          ordinal: 1,
          guidStore: T2,
          holdingName: "H",
          warehouse: false,
          outletGuidStatus: "confirmed",
          closed: false,
          closureStatus: "open",
          closureConfirmedInCurrentExport: true,
          closureHistory: [],
          address: { storeAddress: "Store Two", deliveryAddress: "", routeDirection: "" },
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
            manager: { guid: M1, name: "M1", state: "directory_unverified" },
            regionalManager: emptyRef,
            hardwareManager: emptyRef,
            headOfSales: emptyRef,
          },
          contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
          lpr: {
            name: "Other LPR",
            post: "Staff",
            dateOfBirth: null,
            phone: "",
            email: "",
            bonus: "5",
            conditionsBonus: "",
            fieldPresence: {
              name: true,
              post: true,
              phone: false,
              email: false,
              bonus: true,
              conditionsBonus: false,
              dateOfBirth: false,
            },
          },
          additional: { statusTandoorClub: "", bonusTandoorClub: "" },
          provenance: {
            freshness: "current",
            sourceSha256: "b".repeat(64),
            importedAt: "2026-01-01T10:00:00.000Z",
          },
          distributionAllowed: false,
        },
      ],
    });
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 1 });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUser.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
  }

  function attachHttpGuards(page: Page): { unexpected5xx: string[]; pageErrors: string[] } {
    const unexpected5xx: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(String(err));
    });
    page.on("response", (response: Response) => {
      const url = response.url();
      if (!url.includes("/api/")) {
        return;
      }
      const status = response.status();
      if (status >= 500) {
        unexpected5xx.push(`${status} ${response.request().method()} ${url}`);
      }
    });
    return { unexpected5xx, pageErrors };
  }

  function assertNoUnexpectedHttpFailures(
    unexpected5xx: string[],
    pageErrors: string[],
  ): void {
    assert.equal(unexpected5xx.length, 0, `unexpected 5xx: ${unexpected5xx.join("; ")}`);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join("; ")}`);
  }

  async function login(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", "m1-f1-browser@example.com");
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  async function waitForResults(page: Page): Promise<void> {
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) {
          return false;
        }
        return (
          content.querySelector(".clients-table tbody tr") ||
          content.querySelector(".clients-cards .clients-card")
        );
      },
      undefined,
      { timeout: 20000 },
    );
  }

  async function runFlow(page: Page, label: string): Promise<void> {
    const guards = attachHttpGuards(page);

    await page.goto("/clients?view=all&entity=outlets&cols=outlet,lprName,lprBonus");
    await page.waitForURL(/entity=outlets/);
    await waitForResults(page);
    const filtersToggle = page.locator("#clients-filters-toggle");
    if (await filtersToggle.isVisible()) {
      await filtersToggle.click();
    }
    await page.locator("#field-filters-wrap").evaluate((el) => {
      el.classList.remove("clients-hidden");
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
      }
    });

    function isMainListResponse(res: Response): boolean {
      return (
        res.url().includes("/api/clients?") &&
        res.request().method() === "GET" &&
        res.url().includes("pageSize=50") &&
        res.status() === 200
      );
    }

    const listResponse = page.waitForResponse(
      (res) => isMainListResponse(res) && res.url().includes("lprNameContains=Browser"),
      { timeout: 20000 },
    );
    await page.locator("#lpr-name-filter").fill("Browser", { force: true });
    await page.waitForFunction(() => window.location.search.includes("lprNameContains=Browser"), undefined, {
      timeout: 20000,
    });
    await listResponse;
    await waitForResults(page);

    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), /lprNameContains=Browser/);
    const filterValue = await page.inputValue("#lpr-name-filter");
    assert.equal(filterValue, "Browser");

    const tableText = await page.locator("#results-content").innerText();
    assert.match(tableText, /Browser LPR/);
    assert.match(tableText, /\b0\b/);
    assert.doesNotMatch(tableText, /Other LPR/);
    const rowCount = await page.locator(".clients-table tbody tr").count();
    assert.equal(rowCount, 1);

    const cardNav = page.waitForURL(/\/clients\/[0-9a-f-]+/i, { timeout: 15000 });
    await page.getByRole("link", { name: "Store One" }).click();
    await cardNav;
    await page.click('button[data-card-tab="data"]');

    const outletRoot = page.locator('[data-testid="pc-outlet-0"]');
    await outletRoot.locator('summary:has-text("Контакт ЛПР")').click();
    await outletRoot.locator('summary:has-text("Бонусные условия")').click();
    const lprPanel = await outletRoot.innerText();
    assert.match(lprPanel, /Browser LPR/);
    assert.match(lprPanel, /Synthetic terms/);
    assert.match(lprPanel, /Личный бонус[\s\S]*\b0\b/);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `f1-lpr-card-${label}.png`),
      fullPage: true,
    });
    fs.copyFileSync(
      path.join(SCREENSHOT_DIR, `f1-lpr-card-${label}.png`),
      path.join(ARTIFACT_SCREENSHOT_DIR, `f1-lpr-${label}.png`),
    );

    const backNav = page.waitForURL(/\/clients\?.*lprNameContains=Browser/, { timeout: 15000 });
    await page.click('a.workspace-button:has-text("К списку")');
    await backNav;
    await waitForResults(page);
    assert.match(page.url(), /lprNameContains=Browser/);

    const reloadList = page.waitForResponse(
      (res) => isMainListResponse(res) && res.url().includes("lprNameContains=Browser"),
      { timeout: 20000 },
    );
    await page.reload();
    await reloadList;
    await waitForResults(page);

    if (await filtersToggle.isVisible()) {
      await filtersToggle.click();
    }
    await page.locator("#reset-filters").click();
    await page.waitForFunction(() => !window.location.search.includes("lprNameContains"), undefined, {
      timeout: 20000,
    });
    await page.waitForResponse((res) => isMainListResponse(res), { timeout: 20000 });
    await waitForResults(page);
    assert.ok(!page.url().includes("lprNameContains"));
    assert.equal(await page.inputValue("#lpr-name-filter"), "");

    assertNoUnexpectedHttpFailures(guards.unexpected5xx, guards.pageErrors);
  }

  it("filter → card → expand → back → reload → reset (1440 and 390)", async () => {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    await seed();

    const desktop = await browser.newContext({ viewport: DESKTOP, baseURL: baseUrl });
    const desktopPage = await desktop.newPage();
    await login(desktopPage);
    await runFlow(desktopPage, "desktop-1440");
    await desktop.close();

    const mobile = await browser.newContext({ viewport: MOBILE, baseURL: baseUrl });
    const mobilePage = await mobile.newPage();
    await login(mobilePage);
    await runFlow(mobilePage, "mobile-390");
    await mobile.close();
  });
});
