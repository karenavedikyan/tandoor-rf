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
const O1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CODE = "0012345-F6UI";
const LPR_NAME = "F6 UI LPR Person";
const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts", "screenshots");

function isClientsListGet(res: Response): boolean {
  const url = new URL(res.url());
  return res.request().method() === "GET" && url.pathname === "/api/clients";
}

function listGetWithContains(value: string) {
  return (res: Response) => {
    if (!isClientsListGet(res) || res.status() !== 200) {
      return false;
    }
    return new URL(res.url()).searchParams.get("onecCode1cContains") === value;
  };
}

function primaryListGet(res: Response) {
  return isClientsListGet(res) && res.status() === 200;
}

describe("F6 local UI vs prototype checklist (real API, no mocks)", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
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
      email: "admin-f6-ui@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin F6 UI",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-f6-ui@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager F6 UI",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C1,
        name_client: "F6 UI Client",
        guid_manager: M1,
        name_manager: "Manager",
        address: "Addr F6",
        telephone: [],
      },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: O1, guid_client: C1, is_closed: false }]);
    await updateClientExtendedSnapshot(databaseUrl, C1, {
      formatVersion: "extended_v1",
      sourceSha256: "d".repeat(64),
      importedAt: new Date().toISOString(),
      isHolding: false,
      holdingLink: { state: "none", pendingGuid: null },
      clientManagerRosterState: "in_wholesale_roster",
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: null, name: "", state: "not_provided" },
      wholesaleExchange: {
        top150: "Нет",
        outletCategory: "D",
        fieldPresence: { top150: true, outletCategory: true },
      },
      counterparty: {
        counterparty: "ООО «F6 UI»",
        fullName: "F6 UI Legal Full",
        legalEntityType: "Компания",
        ogrn: "0123456789012",
        fieldPresence: {
          counterparty: true,
          fullName: true,
          legalEntityType: true,
          ogrn: true,
        },
      },
      clientContract: {
        primaryContract: "Договор F6 UI",
        mainAgreement: "Соглашение F6 UI",
        fieldPresence: { primaryContract: true, mainAgreement: true },
      },
      clientCode: { code1c: CODE, fieldPresence: { code1c: true } },
      currentRetailOutlets: [
        {
          ordinal: 1,
          guidStore: O1,
          holdingName: "",
          warehouse: null,
          outletGuidStatus: "confirmed",
          closed: false,
          closureStatus: "open",
          closureConfirmedInCurrentExport: true,
          closureHistory: [],
          address: {
            storeAddress: "F6 UI Store Address",
            deliveryAddress: "",
            routeDirection: "",
          },
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
            manager: { guid: M1, name: "Manager", state: "directory_unverified" },
            regionalManager: { guid: null, name: "", state: "not_provided" },
            hardwareManager: { guid: null, name: "", state: "not_provided" },
            headOfSales: { guid: null, name: "", state: "not_provided" },
          },
          contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
          lpr: {
            name: LPR_NAME,
            post: "Owner",
            dateOfBirth: "1990-03-20",
            phone: "+79005556677",
            email: "f6-ui-lpr@example.test",
            bonus: "0",
            conditionsBonus: "F6 UI bonus terms",
          },
          additional: { statusTandoorClub: "", bonusTandoorClub: "" },
          provenance: {
            freshness: "current",
            sourceSha256: "e".repeat(64),
            importedAt: new Date().toISOString(),
          },
          distributionAllowed: false,
        },
      ],
      retailOutletHistory: [],
      blocks: { clientExtendedReady: true, outletNormalizedReady: true },
    });
  }

  function attachGuards(page: Page) {
    const unexpected5xx: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (res) => {
      if (res.url().includes("/api/") && res.status() >= 500) {
        unexpected5xx.push(`${res.status()} ${res.url()}`);
      }
    });
    return { unexpected5xx, pageErrors };
  }

  async function loginAdmin(page: Page): Promise<void> {
    const profilePromise = page.waitForURL(/\/profile/, { timeout: 15000 });
    await page.goto("/login");
    await page.fill("#email", "admin-f6-ui@example.com");
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await profilePromise;
  }

  async function ensureFiltersPanelExpanded(page: Page): Promise<void> {
    const toggle = page.locator("#clients-filters-toggle");
    if (await toggle.isVisible()) {
      const expanded = await toggle.getAttribute("aria-expanded");
      if (expanded !== "true") {
        await toggle.click();
        await page.waitForSelector("#clients-filters-panel.clients-filters-panel--expanded");
      }
    }
  }

  async function openFieldFiltersSection(page: Page): Promise<void> {
    await ensureFiltersPanelExpanded(page);
    const summary = page.locator("#field-filters-wrap > summary");
    await summary.click();
    await page.waitForSelector("#onec-code1c-contains-filter:not(.clients-hidden)");
  }

  async function openDetailsSummary(page: Page, title: string): Promise<void> {
    const summary = page.locator("summary.pc-details__summary", { hasText: title });
    const details = summary.locator("xpath=ancestor::details[1]");
    if ((await details.getAttribute("open")) === null) {
      await summary.click();
    }
  }

  async function assertExpandedCardValues(page: Page, screenshotName: string): Promise<void> {
    await page.click("#pc-tab-data");
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    const panel = page.locator("#pc-panel-data");
    await openDetailsSummary(page, "Контрагент и реквизиты");
    await openDetailsSummary(page, "Договор и соглашение");
    await openDetailsSummary(page, "Контакт ЛПР");
    await openDetailsSummary(page, "Бонусные условия");
    const panelText = await panel.innerText();
    assert.match(panelText, /Код 1С/);
    assert.match(panelText, new RegExp(CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(panelText, /ТОП-150 \(1С\)[\s\S]*\nНет\n/);
    assert.match(panelText, /Категория 1С[\s\S]*\nD\n/);
    assert.match(panelText, /ООО «F6 UI»/);
    assert.match(panelText, /F6 UI Legal Full/);
    assert.match(panelText, /Договор F6 UI/);
    assert.match(panelText, /Соглашение F6 UI/);
    assert.match(panelText, new RegExp(LPR_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(panelText, /Личный бонус[\s\S]*\n0\n/);
    assert.match(panelText, /F6 UI bonus terms/);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: true });
  }

  async function enableCodeColumn(page: Page): Promise<void> {
    await page.click("#columns-picker-btn");
    const box = page.locator('input[data-column-id="code1c"]');
    if (!(await box.isChecked())) {
      await box.check();
    }
    await page.click("#columns-picker-btn");
  }

  async function runDesktopFlow(page: Page): Promise<void> {
    const guards = attachGuards(page);
    await page.goto("/clients?view=all&entity=clients");
    await openFieldFiltersSection(page);

    const listPromise = page.waitForResponse(listGetWithContains("F6UI"));
    await page.fill("#onec-code1c-contains-filter", "F6UI");
    await page.locator("#onec-code1c-contains-filter").dispatchEvent("change");
    const listRes = await listPromise;
    const body = (await listRes.json()) as { items: Array<{ code1c?: { label: string } }> };
    assert.equal(body.items[0]?.code1c?.label, CODE);

    await enableCodeColumn(page);
    const codeRow = page.locator("tbody tr").filter({ hasText: CODE });
    await codeRow.waitFor({ state: "visible" });
    assert.match(await codeRow.innerText(), new RegExp(CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    await page.getByRole("link", { name: "F6 UI Client" }).click();
    await page.waitForURL(new RegExp("/clients/" + C1.replace(/-/g, "\\-")));
    await assertExpandedCardValues(page, "f6-local-card-desktop-1440-expanded.png");

    await page.goBack();
    const reloadListPromise = page.waitForResponse(primaryListGet);
    await page.reload();
    await reloadListPromise;
    assert.match(await codeRow.innerText(), new RegExp(CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "f6-local-list-desktop-1440.png"), fullPage: true });

    await ensureFiltersPanelExpanded(page);
    const resetListPromise = page.waitForResponse(primaryListGet);
    await page.locator("#reset-filters").scrollIntoViewIfNeeded();
    await page.click("#reset-filters");
    await resetListPromise;

    assert.equal(guards.unexpected5xx.length, 0, guards.unexpected5xx.join("; "));
    assert.equal(guards.pageErrors.length, 0, guards.pageErrors.join("; "));
  }

  async function runMobileFlow(page: Page): Promise<void> {
    const guards = attachGuards(page);
    const initialListPromise = page.waitForResponse(primaryListGet);
    await page.goto("/clients?view=all&entity=clients");
    await initialListPromise;
    await openFieldFiltersSection(page);

    const listPromise = page.waitForResponse(listGetWithContains("F6UI"));
    await page.fill("#onec-code1c-contains-filter", "F6UI");
    await page.locator("#onec-code1c-contains-filter").dispatchEvent("change");
    await listPromise;

    await enableCodeColumn(page);
    const cardLine = page.locator(".clients-card").first();
    assert.match(await cardLine.innerText(), new RegExp(CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    await page.getByRole("link", { name: "F6 UI Client" }).click();
    await assertExpandedCardValues(page, "f6-local-card-mobile-390-expanded.png");

    await page.goBack();
    const reloadListPromise = page.waitForResponse(primaryListGet);
    await page.reload();
    await reloadListPromise;
    assert.match(await cardLine.innerText(), new RegExp(CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    await ensureFiltersPanelExpanded(page);
    const resetListPromise = page.waitForResponse(primaryListGet);
    await page.locator("#reset-filters").scrollIntoViewIfNeeded();
    await page.click("#reset-filters");
    await resetListPromise;

    assert.equal(guards.unexpected5xx.length, 0, guards.unexpected5xx.join("; "));
    assert.equal(guards.pageErrors.length, 0, guards.pageErrors.join("; "));
  }

  it("desktop and mobile: real API list/card for F1–F5 fields", async () => {
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    await seed();

    const desktop = await browser.newContext({ viewport: DESKTOP, baseURL: baseUrl });
    const dPage = await desktop.newPage();
    await loginAdmin(dPage);
    await runDesktopFlow(dPage);
    await desktop.close();

    const mobile = await browser.newContext({ viewport: MOBILE, baseURL: baseUrl });
    const mPage = await mobile.newPage();
    await loginAdmin(mPage);
    await runMobileFlow(mPage);
    await mobile.close();
  });
});
