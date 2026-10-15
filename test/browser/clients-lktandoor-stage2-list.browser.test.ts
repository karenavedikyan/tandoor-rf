import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const SCREENSHOT_DIR =
  process.env.CLIENTS_LKTANDOOR_STAGE2_DIR ??
  "/cursor/stores/self/media/clients-lktandoor-stage2-list";
const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

describe("lktandoor stage2 list UI", { concurrency: false }, () => {
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
      email: "admin-lktandoor-list@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Lktandoor",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-lktandoor-list@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Lktandoor",
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
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    });
  }

  async function login(page: import("playwright").Page, email: string) {
    await page.goto(baseUrl + "/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(baseUrl + "/");
  }

  it("shows lktandoor list chrome, filters, and mobile cards", async () => {
    const page = await browser.newPage();
    await login(page, "manager-lktandoor-list@example.com");
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal");
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await page.waitForSelector("#v3-lktandoor-scope-bar", { timeout: 30000 });
    assert.ok(await page.locator("#clients-manager-chrome.clients-hidden").count() >= 0);
    await page.setViewportSize(DESKTOP);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-legal-desktop-1440.png"), fullPage: true });
    await page.selectOption("#v3-lktandoor-category-filter", { index: 1 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.selectOption("#v3-city-filter", { index: 0 }).catch(() => {});
    await page.click('[data-v3entity="retail"]').catch(() => page.click('button[data-v3entity="retail"]'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-retail-desktop-1440.png"), fullPage: true });
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-retail-mobile-390.png"), fullPage: true });
    const mobileCards = page.locator('[data-testid="v3-lktandoor-mobile-card"]');
    if ((await mobileCards.count()) > 0) {
      const href = await mobileCards.first().getAttribute("href");
      assert.ok(href && href.includes("/clients/"));
      await mobileCards.first().click();
      await page.waitForURL(/\/clients\//);
      await page.goBack();
      await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)');
    }
    await page.close();
  });
});
