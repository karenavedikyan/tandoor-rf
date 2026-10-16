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
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const SCREENSHOT_DIR =
  process.env.CLIENTS_MOBILE_TOOLBAR_DIR ??
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/mobile-toolbar-fix";
const WIDTHS = [320, 360, 390, 430] as const;

describe("ordinary mobile clients toolbar labels", { concurrency: false }, () => {
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
      email: "admin-mobile-toolbar@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Toolbar",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-mobile-toolbar@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Toolbar",
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
    await page.fill('input[name="email"]', "manager-mobile-toolbar@example.com");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile", { timeout: 30000 });
  }

  async function waitForOrdinaryList(page: Page) {
    const response = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await page.goto(`${baseUrl}/clients?v3mode=1&v3entity=legal_grouped&view=all&v3view=all`);
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await response;
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="v3-lktandoor-mobile-card"]').length >= 1,
      undefined,
      { timeout: 30000 },
    );
  }

  async function assertToolbarLabels(page: Page) {
    const metrics = await page.evaluate(() => {
      const row = document.querySelector(".clients-lktandoor-list .clients-toolbar__controls-row");
      if (!row) {
        return null;
      }
      const buttons = Array.from(row.querySelectorAll("button")).filter((btn) => {
        const style = getComputedStyle(btn);
        return style.display !== "none" && style.visibility !== "hidden" && btn.getBoundingClientRect().width > 0;
      });
      const expected = ["Клиенты", "Торговые точки", "Колонки", "На весь экран"];
      const texts = buttons.map((b) => b.textContent?.trim() || "");
      const labelFit = buttons.map((btn) => ({
        text: btn.textContent?.trim(),
        fits: btn.scrollWidth <= btn.clientWidth + 1,
      }));
      const rects = buttons.map((b) => b.getBoundingClientRect());
      let overlap = false;
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const horizontal =
            a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          if (horizontal) {
            overlap = true;
          }
        }
      }
      return {
        labelFit,
        overlap,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        texts,
        expectedPresent: expected.every((label) => texts.includes(label)),
      };
    });
    assert.ok(metrics, "controls row missing");
    assert.equal(metrics.overflow, false, "page must not overflow horizontally");
    assert.equal(metrics.overlap, false, "toolbar buttons must not overlap");
    assert.equal(metrics.expectedPresent, true, `expected labels, got ${metrics.texts.join(", ")}`);
    for (const entry of metrics.labelFit) {
      assert.equal(entry.fits, true, `label must fit: ${entry.text}`);
    }
  }

  it("capture before snapshot at 390 (run with CAPTURE_BEFORE=1 on main CSS)", { skip: process.env.CAPTURE_BEFORE !== "1" }, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(page);
    await waitForOrdinaryList(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "before-390.png") });
    await page.close();
  });

  it("ordinary mobile toolbar: full labels at 320–430 and entity switch", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(page);
    await waitForOrdinaryList(page);
    await page.evaluate(() => {
      document.body.classList.remove("legacy-sidebar-open");
    });

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      await assertToolbarLabels(page);
      if (width === 390) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "after-390.png") });
      }
      if (width === 320) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "after-320.png") });
      }
    }

    await page.locator('.clients-entity-switcher--primary button[data-v3entity="retail"]').click();
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');
    assert.ok(page.url().includes("v3entity=retail"));
    await page.locator('.clients-entity-switcher--primary button[data-v3entity="legal_grouped"]').click();
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');

    await page.locator('[data-testid="v3-lktandoor-mobile-card"]').first().click();
    await page.waitForURL(/\/clients\//);
    await page.goBack();
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');

    await page.close();
  });
});
