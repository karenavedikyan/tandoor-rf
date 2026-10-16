import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const LEGAL = "b2000000-0000-4000-8000-000000000001";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const SCREENSHOT_DIR =
  process.env.SHELL_CHROME_SCREENSHOT_DIR ??
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/shell-chrome-parity";

async function waitForShellFonts(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction(() => {
    const bodyFamily = getComputedStyle(document.body).fontFamily.toLowerCase();
    if (!bodyFamily.includes("golos")) {
      return false;
    }
    return Array.from(document.fonts).some((face) => face.family.replace(/"/g, "") === "Golos" && face.status === "loaded");
  });
}

async function waitForMobileDrawer(page: Page, open: boolean) {
  await page.waitForFunction(
    (shouldOpen) => {
      const sidebar = document.getElementById("legacy-sidebar");
      if (!sidebar) {
        return false;
      }
      const rect = sidebar.getBoundingClientRect();
      const isOpen = sidebar.classList.contains("is-open");
      if (shouldOpen) {
        return isOpen && rect.x <= 0.5 && rect.width >= 199;
      }
      return !isOpen && rect.x <= -1;
    },
    open,
    { timeout: 15000 },
  );
}

describe("shell chrome evidence screenshots", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await seed(databaseUrl);
    const { createApp } = await import("../../src/server");
    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const addr = appServer!.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  });

  after(async () => {
    await browser?.close();
    if (appServer) {
      await new Promise<void>((resolve, reject) =>
        appServer!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await closePool();
  });

  async function seed(databaseUrl: string) {
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-shell-chrome@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Shell",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-shell-chrome@example.com",
      password: TEST_PASSWORD,
      fullName: "Иван Петров",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
    ]);
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    const applied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    });
    assert.equal(applied.status, "SUCCESS");
  }

  async function login(page: Page) {
    await page.goto(`${baseUrl}/login`);
    await page.fill('input[name="email"]', "manager-shell-chrome@example.com");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile" || url.pathname === "/clients", {
      timeout: 30000,
    });
  }

  it("captures desktop and mobile shell plus v3 card tabs", async () => {
    const page = await browser.newPage();
    await login(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    const listResponse = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await page.goto(`${baseUrl}/clients?v3mode=1&v3entity=legal_grouped&view=all&v3view=all`, {
      waitUntil: "domcontentloaded",
    });
    await listResponse;
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await page.waitForFunction(
      () => document.querySelectorAll(".x13-results-table tbody tr, [data-testid='v3-lktandoor-mobile-card']").length >= 1,
      undefined,
      { timeout: 30000 },
    );
    await waitForShellFonts(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-1440-clients.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await waitForShellFonts(page);
    await waitForMobileDrawer(page, false);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-390-clients-closed.png"), fullPage: false });
    await page.click("#legacy-menu-toggle");
    await waitForMobileDrawer(page, true);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-390-menu-open.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await waitForMobileDrawer(page, false);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-390-menu-closed.png"), fullPage: false });

    await page.setViewportSize({ width: 320, height: 640 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".legacy-topbar__logo");
    await waitForShellFonts(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-320-header.png"), fullPage: false });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/clients/${LEGAL}?v3Entity=legal&cardTab=orders&return=${encodeURIComponent("/clients")}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-card-tab="overview"]');
    const tabButtons = await page.locator("[data-card-tab]").allTextContents();
    assert.deepEqual(tabButtons.sort(), ["Данные", "Обзор"].sort());
    assert.doesNotMatch(page.url(), /cardTab=orders/);
    await waitForShellFonts(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-1440-v3-card-two-tabs.png"), fullPage: false });

    await page.goto(`${baseUrl}/profile`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".legacy-topbar__brand");
    await waitForShellFonts(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-1440-profile-header.png"), fullPage: false });

    await page.goto(`${baseUrl}/clients?v3mode=1&v3entity=legal_grouped&view=all&v3view=all`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".legacy-topbar__brand");
    await page.click("[data-theme-toggle]");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    await waitForShellFonts(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-1440-dark-theme.png"), fullPage: false });

    await page.close();
  });
});
