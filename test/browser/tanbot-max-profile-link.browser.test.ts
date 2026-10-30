/**
 * MAX profile one-step link + focus refresh (no profile confirm).
 * Run: TANBOT_STAGE2_BROWSER_SMOKE=1 npm run test:browser -- test/browser/tanbot-max-profile-link.browser.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const RUN = process.env.TANBOT_STAGE2_BROWSER_SMOKE === "1";
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const WEBHOOK_SECRET = "browser-max-webhook-sec16";
const LINK_PEPPER = "browser-max-link-pepper16";
const SYNTH_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";

describe("tanbot max profile link browser smoke", { concurrency: false, skip: !RUN }, () => {
  let browser: Browser;
  let baseUrl = "";
  let server: http.Server;
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = SYNTH_TOKEN;
    process.env.TANBOT_MAX_EXPECTED_USERNAME = "id231100522180_bot";
    process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
    process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = LINK_PEPPER;
    process.env.TANBOT_MAX_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_MAX_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "false";

    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "tanbot-max-browser@test.local",
      password: PASSWORD,
      fullName: "Browser Max",
      role: "manager",
    });

    browser = await chromium.launch({ headless: true });
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
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

  it("profile links MAX after bot_started webhook and focus refresh", async () => {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    let startToken: string | null = null;
    page.on("response", async (res) => {
      if (
        res.url().includes("/api/profile/tanbot/max/link/start") &&
        res.request().method() === "POST" &&
        res.status() === 200
      ) {
        const body = (await res.json()) as { deepLink?: string };
        if (body.deepLink) startToken = new URL(body.deepLink).searchParams.get("start");
      }
    });

    await page.goto("/login");
    await page.fill("#email", "tanbot-max-browser@test.local");
    await page.fill("#password", PASSWORD);
    await page.click("#login-button");
    await page.goto("/profile");
    await page.waitForSelector("#tanbot-max-section:not([hidden])", { timeout: 15000 });
    await page.click("button:text('Подключить MAX')");
    for (let i = 0; i < 30 && !startToken; i += 1) {
      await page.waitForTimeout(100);
    }
    assert.ok(startToken);

    await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", WEBHOOK_SECRET)
      .send({
        update_type: "bot_started",
        timestamp: 1737500139000,
        chat_id: 89001,
        user: { user_id: 89001, is_bot: false, first_name: "Max", username: "max_browser" },
        payload: startToken,
      });

    await page.evaluate(() => {
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForSelector("button:text('Отключить MAX')", { timeout: 10000 });
    await context.close();
  });
});
