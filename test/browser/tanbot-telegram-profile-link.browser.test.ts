/**
 * Profile UI: start from button → synthetic webhook → focus refresh → confirm (no forced reload).
 * Run: TANBOT_STAGE2_BROWSER_SMOKE=1 npm run test:browser -- test/browser/tanbot-telegram-profile-link.browser.test.ts
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
const WEBHOOK_SECRET = "browser-webhook-secret-16";
const LINK_PEPPER = "browser-link-pepper-min-16";
const SYNTH_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";

describe("tanbot profile link browser smoke", { concurrency: false, skip: !RUN }, () => {
  let browser: Browser;
  let baseUrl = "";
  let server: http.Server;
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = SYNTH_TOKEN;
    process.env.TANBOT_TELEGRAM_EXPECTED_USERNAME = "TANDOOR_IBOT";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = LINK_PEPPER;
    process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";

    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "tanbot-browser@test.local",
      password: PASSWORD,
      fullName: "Browser Tanbot",
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

  it("profile shows Telegram section and confirm links account after return refresh", async () => {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    let startToken: string | null = null;
    page.on("response", async (res) => {
      if (
        res.url().includes("/api/profile/tanbot/telegram/link/start") &&
        res.request().method() === "POST" &&
        res.status() === 200
      ) {
        const body = (await res.json()) as { deepLink?: string };
        if (body.deepLink) startToken = new URL(body.deepLink).searchParams.get("start");
      }
    });

    await page.goto("/login");
    await page.fill("#email", "tanbot-browser@test.local");
    await page.fill("#password", PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile)(\/|\?|$)/, { timeout: 20000 });
    await page.goto("/profile");
    await page.waitForSelector("#tanbot-telegram-section:not([hidden])", { timeout: 15000 });
    await page.click("button:text('Подключить Telegram')");
    for (let i = 0; i < 30 && !startToken; i += 1) {
      await page.waitForTimeout(100);
    }
    assert.ok(startToken, "UI start must produce link/start token");

    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send({
        update_id: 88001,
        message: {
          message_id: 1,
          from: { id: 88001, is_bot: false, username: "browser_user" },
          chat: { id: 88001, type: "private" },
          date: 1,
          text: `/start ${startToken}`,
        },
      });

    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForSelector("button:text('Подтвердить привязку')", { timeout: 10000 });
    await page.check("#tanbot-confirm-notifications");
    await page.click("button:text('Подтвердить привязку')");
    await page.waitForSelector("button:text('Отключить Telegram')", { timeout: 10000 });
    await context.close();
  });
});
