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
const CODE = "0012345-F6UI";
const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts", "screenshots");

function isClientsListGet(res: Response): boolean {
  const url = new URL(res.url());
  return res.request().method() === "GET" && url.pathname === "/api/clients";
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
      currentRetailOutlets: [],
      retailOutletHistory: [],
      blocks: { clientExtendedReady: true, outletNormalizedReady: true },
    });
  }

  function attachGuards(page: Page) {
    const unexpected5xx: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/api/") && res.status() >= 500) {
        unexpected5xx.push(`${res.status()} ${res.url()}`);
      }
    });
    return { unexpected5xx };
  }

  async function loginAdmin(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", "admin-f6-ui@example.com");
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
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
    const listPromise = page.waitForResponse(
      (res) => isClientsListGet(res) && res.url().includes("onecCode1cContains=F6UI") && res.status() === 200,
    );
    await page.goto("/clients?view=all&entity=clients&onecCode1cContains=F6UI");
    const listRes = await listPromise;
    const body = (await listRes.json()) as { items: Array<{ code1c?: { label: string } }> };
    assert.equal(body.items[0]?.code1c?.label, CODE);
    await enableCodeColumn(page);
    await page.getByRole("link", { name: "F6 UI Client" }).click();
    await page.waitForURL(new RegExp("/clients/" + C1.replace(/-/g, "\\-")));
    await page.click("#pc-tab-data");
    const panelText = await page.locator("#pc-panel-data").innerText();
    assert.match(panelText, /Код 1С/);
    assert.match(panelText, new RegExp(CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(panelText, /ТОП-150 \(1С\)/);
    assert.match(panelText, /Категория 1С/);
    assert.match(panelText, /Контрагент и реквизиты/);
    assert.match(panelText, /Договор и соглашение/);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "f6-local-card-desktop-1440.png"), fullPage: true });
    await page.goBack();
    await page.reload();
    await page.waitForResponse((res) => isClientsListGet(res) && res.status() === 200);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "f6-local-list-desktop-1440.png"), fullPage: true });
    assert.equal(guards.unexpected5xx.length, 0, guards.unexpected5xx.join("; "));
  }

  async function runMobileFlow(page: Page): Promise<void> {
    const guards = attachGuards(page);
    await page.goto("/clients?view=all&entity=clients&onecCode1cContains=F6UI");
    await page.waitForResponse((res) => isClientsListGet(res) && res.status() === 200);
    await enableCodeColumn(page);
    assert.match(await page.locator(".clients-card").first().innerText(), /Код 1С/);
    await page.getByRole("link", { name: "F6 UI Client" }).click();
    await page.click("#pc-tab-data");
    assert.match(await page.locator("#pc-panel-data").innerText(), /Код 1С/);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "f6-local-card-mobile-390.png"), fullPage: true });
    assert.equal(guards.unexpected5xx.length, 0, guards.unexpected5xx.join("; "));
  }

  it("desktop and mobile: real API list/card for F2–F5 fields", async () => {
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
