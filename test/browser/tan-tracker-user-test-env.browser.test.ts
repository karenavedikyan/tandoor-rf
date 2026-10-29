/**
 * Smoke against pre-seeded tt56 user-test DB (no schema reset).
 * Run: TT56_USER_TEST_BROWSER_SMOKE=1 npm run tt56-user-test:browser-smoke
 * Requires .env.tan-tracker-user-test.local and prior npm run tt56-user-test:seed
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { assertTanTrackerUserTestDatabaseUrl } from "../../src/shared/tan-tracker-user-test-env";

const RUN = process.env.TT56_USER_TEST_BROWSER_SMOKE === "1";
const EMPLOYEE_A = "tt56-employee-a@tt56-user-test.local";

describe("tan-tracker user-test env browser smoke", { concurrency: false, skip: !RUN }, () => {
  let browser: Browser;
  let baseUrl = "";
  let server: http.Server;

  before(async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL required");
    assertTanTrackerUserTestDatabaseUrl(databaseUrl, "browser smoke");
    const password = process.env.TT_USER_TEST_DEFAULT_PASSWORD?.trim();
    if (!password) {
      throw new Error("TT_USER_TEST_DEFAULT_PASSWORD required for browser smoke login");
    }

    process.env.TT_USER_TEST_ENV = "true";
    process.env.NODE_ENV = "development";
    process.env.TT_PHONE_VERIFICATION_PROVIDER = "test";
    process.env.TT_OTP_PEPPER =
      process.env.TT_OTP_PEPPER?.trim() || "browser-smoke-tt56-pepper-min16";
    process.env.PGSSLMODE = "disable";
    process.env.TRUSTED_PROXIES = "";
    process.env.ONEC_FTP_ENABLED = "false";
    process.env.BITRIX24_ENABLED = "false";
    process.env.TANBOT_TELEGRAM_ENABLED = "false";
    process.env.TT_ATTACHMENTS_DIR =
      process.env.TT_ATTACHMENTS_DIR?.trim() || "var/tt56-user-test/attachments";

    browser = await chromium.launch({ headless: true });
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.APP_ORIGIN = baseUrl;
  });

  after(async () => {
    await browser?.close();
    await closePool();
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("shows test banner and registry after employee A login", async () => {
    const password = process.env.TT_USER_TEST_DEFAULT_PASSWORD!.trim();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: baseUrl,
    });
    const page = await context.newPage();

    await page.goto("/login");
    await page.fill("#email", EMPLOYEE_A);
    await page.fill("#password", password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access)(\/|\?|$)/, { timeout: 20000 });

    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    const banner = page.locator(".tt-user-test-banner");
    await banner.waitFor({ state: "visible", timeout: 10000 });
    assert.match(await banner.textContent(), /ТЕСТОВАЯ СРЕДА/i);

    await page.reload();
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    await banner.waitFor({ state: "visible", timeout: 10000 });

    await context.close();
  });
});
