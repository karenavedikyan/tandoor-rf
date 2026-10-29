import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { randomUUID } from "node:crypto";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { getPool } from "../../src/db/pool";

const PASSWORD = "StrongPass123!";
const ORIGIN_HOST = "127.0.0.1";

describe("tan-tracker LK write capability browser", { concurrency: false }, () => {
  let browser: Browser;
  let baseUrl = "";
  let server: http.Server;
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, `http://${ORIGIN_HOST}:3000`);
    await prepareDatabase(databaseUrl);
    process.env.TT_ATTACHMENTS_BACKEND = "postgres";
    process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), "var/tt-lk-write-cap-browser");
    process.env.TANBOT_TELEGRAM_ENABLED = "false";
    process.env.ONEC_FTP_ENABLED = "false";
    process.env.BITRIX24_ENABLED = "false";

    await createTestUser({
      databaseUrl,
      email: "tt-browser-admin@test.local",
      password: PASSWORD,
      fullName: "Browser Admin",
      role: "admin",
    });
    await createTestUser({
      databaseUrl,
      email: "tt-browser-fresh@test.local",
      password: PASSWORD,
      fullName: "Browser Fresh Recipient",
      role: "manager",
    });

    const emp = randomUUID();
    await createTestUser({
      databaseUrl,
      email: "tt-browser-mgr@test.local",
      password: PASSWORD,
      fullName: "Browser Mgr",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Browser Mgr', 'Manager', '{}')`,
        [emp],
      );
      const mgr = (await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "tt-browser-mgr@test.local",
      ])).rows[0];
      await linkUserToEmployee({
        databaseUrl,
        userId: mgr.id,
        employeeId: emp,
        confirmedByUserId: mgr.id,
      });
      await ensurePartyForUserOnWrite(client, mgr.id, "Browser Mgr", "+79997778801");
    } finally {
      client.release();
    }

    browser = await chromium.launch({ headless: true });
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, ORIGIN_HOST, () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://${ORIGIN_HOST}:${address.port}`;
    process.env.APP_ORIGIN = baseUrl;
  });

  after(async () => {
    await browser?.close();
    await closePool();
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  async function login(page: import("playwright").Page, email: string) {
    await page.goto(`${baseUrl}/login`);
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 20000 });
  }

  it("technical admin sees create entry and no read-only banner (desktop + mobile)", async () => {
    for (const viewport of [
      { width: 1280, height: 800, label: "desktop" },
      { width: 375, height: 740, label: "mobile375" },
    ]) {
      const context = await browser.newContext({ viewport, baseURL: baseUrl });
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await page.goto("/tan-tracker");
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
      assert.equal(await page.locator('[data-tt="lk-readonly-banner"]').count(), 0);
      if (viewport.width >= 1280) {
        await page.waitForSelector('[data-tt="create"]', { timeout: 15000 });
      } else {
        await page.waitForSelector('[data-tt="create-fab"]', { timeout: 15000, state: "visible" });
      }
      await context.close();
    }
  });

  it("linked manager sees create entry when canWrite=true", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-mgr@test.local");
    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    assert.equal(await page.locator('[data-tt="lk-readonly-banner"]').count(), 0);
    await page.waitForSelector('[data-tt="create"]', { timeout: 15000 });
    await context.close();

    const mobile = await browser.newContext({ viewport: { width: 375, height: 740 }, baseURL: baseUrl });
    const mpage = await mobile.newPage();
    await login(mpage, "tt-browser-mgr@test.local");
    await mpage.goto("/tan-tracker");
    await mpage.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    await mpage.waitForSelector('[data-tt="create-fab"]', { timeout: 15000, state: "visible" });
    await mobile.close();
  });

  it("admin opens create wizard from CTA (real HTTP bootstrap)", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-tt="create"]', { timeout: 20000 });
    await page.click('[data-tt="create"]');
    await page.waitForSelector('[data-tt="create-wizard"]', { timeout: 10000 });
    await page.waitForSelector('[data-tt-field="item"]', { timeout: 5000 });
    await context.close();
  });

  it("admin registry renders in dark theme at 375px", async () => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 740 },
      baseURL: baseUrl,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    await page.goto("/tan-tracker");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 15000 });
    await context.close();
  });
});
