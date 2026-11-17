/**
 * Profile UI: one-step link, focus/pageshow refresh, in-memory deep-link fallback, opt-out preserved.
 * Run: TANBOT_STAGE2_BROWSER_SMOKE=1 npm run test:browser -- test/browser/tanbot-telegram-profile-link.browser.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
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

async function assertTelegramNotificationControls(page: Page, linked: boolean): Promise<void> {
  assert.equal(await page.locator("#tanbot-confirm-notifications").count(), 0);
  assert.equal(await page.locator("#tanbot-confirm-notifications-wrap").count(), 0);
  const row = page.locator('#messenger-accounts [data-testid^="ma-telegram-"]');
  assert.equal(await row.getByRole("checkbox").count(), linked ? 1 : 0);
  assert.equal(await row.getByRole("button", { name: linked ? "Отключить" : "Подключить Telegram", exact: true }).isVisible(), true);
}

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
      phone: "+79000000001",
    });

    browser = await chromium.launch({ headless: true, channel: "chromium" });
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

  it("profile links Telegram after webhook without profile confirm", async () => {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();

    await page.goto("/login");
    await page.fill("#email", "tanbot-browser@test.local");
    await page.fill("#password", PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile)(\/|\?|$)/, { timeout: 20000 });
    await page.goto("/profile");
    await page.waitForSelector("#messenger-accounts:not([hidden])", { timeout: 15000 });
    await page.getByRole("button", { name: "Подключить Telegram", exact: true }).waitFor();
    await assertTelegramNotificationControls(page, false);
    await page.getByRole("button", { name: "Подключить Telegram", exact: true }).click();
    await page.getByRole("button", { name: "Получить ссылку" }).click();
    await page.getByRole("link", { name: "Открыть Telegram", exact: true }).waitFor();
    const startToken = new URL((await page.getByRole("link", { name: "Открыть Telegram", exact: true }).getAttribute("href"))!).searchParams.get("start");
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
      window.dispatchEvent(new Event("pageshow"));
    });
    await page.locator('#messenger-accounts [data-testid^="ma-telegram-"]').getByRole("button", { name: "Отключить", exact: true }).waitFor();
    await assertTelegramNotificationControls(page, true);
    await context.close();
  });

  it("shows a copyable link and keeps notification opt-out after webhook replay", async () => {
    await createTestUser({
      databaseUrl,
      email: "tanbot-browser2@test.local",
      password: PASSWORD,
      fullName: "Browser Tanbot Two",
      role: "manager",
      phone: "+79000000002",
    });
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();

    await page.goto("/login");
    await page.fill("#email", "tanbot-browser2@test.local");
    await page.fill("#password", PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile)(\/|\?|$)/, { timeout: 20000 });
    await page.goto("/profile");
    await page.waitForSelector("#messenger-accounts:not([hidden])", { timeout: 15000 });
    await page.getByRole("button", { name: "Подключить Telegram", exact: true }).waitFor();
    await assertTelegramNotificationControls(page, false);

    await page.evaluate(() => {
      window.open = () => null;
    });
    await page.getByRole("button", { name: "Подключить Telegram", exact: true }).click();
    await page.getByRole("button", { name: "Получить ссылку" }).click();
    await page.getByRole("link", { name: "Открыть Telegram", exact: true }).waitFor();
    const startToken = new URL((await page.getByRole("link", { name: "Открыть Telegram", exact: true }).getAttribute("href"))!).searchParams.get("start");
    assert.ok(startToken);
    const fallbackUrl = await page.getByLabel("Ссылка подключения").inputValue();
    assert.match(fallbackUrl, /start=/);

    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send({
        update_id: 88002,
        message: {
          message_id: 1,
          from: { id: 88002, is_bot: false, username: "browser_user2" },
          chat: { id: 88002, type: "private" },
          date: 1,
          text: `/start ${startToken}`,
        },
      });

    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
    });
    const toggle = page.locator('#messenger-accounts [data-testid^="ma-telegram-"]').getByRole("checkbox");
    await toggle.waitFor();
    await assertTelegramNotificationControls(page, true);
    await toggle.uncheck();
    await page.getByText("Настройка этого аккаунта сохранена.", { exact: true }).waitFor();

    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send({
        update_id: 88003,
        message: {
          message_id: 2,
          from: { id: 88002, is_bot: false, username: "browser_user2" },
          chat: { id: 88002, type: "private" },
          date: 1,
          text: `/start ${startToken}`,
        },
      });

    await page.reload();
    await toggle.waitFor();
    const notifChecked = await toggle.isChecked();
    assert.equal(notifChecked, false);
    await context.close();
  });
});
