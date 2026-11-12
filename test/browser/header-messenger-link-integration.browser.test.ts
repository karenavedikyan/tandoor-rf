import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const RUN = process.env.HEADER_MESSENGER_BROWSER_INTEGRATION === "1";
const PASSWORD = "StrongPass123!";
const SECRET = "synthetic-header-webhook-secret";

describe("header messenger link with real local API (no external network)", { concurrency: false, skip: !RUN }, () => {
  let browser: Browser, server: http.Server, baseUrl: string;
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  before(async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    for (const name of ["MAX", "TELEGRAM"]) {
      process.env[`TANBOT_${name}_ENABLED`] = "true";
      process.env[`TANBOT_${name}_BOT_TOKEN`] = name === "MAX"
        ? "SYNTH_MAX_TEST_TOKEN_0123456789abcdef" : "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";
      process.env[`TANBOT_${name}_BOT_USERNAME`] = name === "MAX" ? "id231100522180_bot" : "TANDOOR_IBOT";
      process.env[`TANBOT_${name}_EXPECTED_USERNAME`] = process.env[`TANBOT_${name}_BOT_USERNAME`];
      process.env[`TANBOT_${name}_LINK_TOKEN_PEPPER`] = "synthetic-header-link-pepper";
      process.env[`TANBOT_${name}_WEBHOOK_ENABLED`] = "true";
      process.env[`TANBOT_${name}_WEBHOOK_SECRET`] = SECRET;
      process.env[`TANBOT_${name}_DELIVERY_ENABLED`] = "false";
    }
    await prepareDatabase(databaseUrl);
    await createTestUser({ databaseUrl, email: "header-messenger@example.invalid", password: PASSWORD,
      fullName: "Локальный тест каналов", role: "manager" });
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
    process.env.APP_ORIGIN = baseUrl;
    browser = await chromium.launch({ headless: true, channel: "chromium" });
  });
  after(async () => {
    await browser?.close();
    await closePool();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("links MAX and Telegram from the bell, then saves opt-out independently", async () => {
    const context = await browser.newContext({ baseURL: baseUrl });
    const blockedExternal: string[] = [];
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== baseUrl) {
        blockedExternal.push("external-request-blocked");
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator("#email").fill("header-messenger@example.invalid");
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#login-button").click();
    await page.waitForURL(/\/(clients|profile)(\/|\?|$)/);
    await page.goto("/profile");
    await page.locator("#an-bell").click();
    const settings = page.locator("#an-inbox .mn-settings");
    await settings.getByRole("button", { name: "Подключить MAX", exact: true }).click();
    const maxLink = settings.getByRole("link", { name: "Открыть MAX", exact: true });
    await maxLink.waitFor();
    const maxToken = new URL((await maxLink.getAttribute("href"))!).searchParams.get("start");
    assert.ok(maxToken);
    const max = await request(app).post("/api/tanbot-max/webhook").set("X-Max-Bot-Api-Secret", SECRET).send({
      update_type: "bot_started", timestamp: 1737500139000, chat_id: 89001,
      user: { user_id: 89001, is_bot: false, first_name: "Synthetic", username: "header_local" }, payload: maxToken,
    });
    assert.equal(max.status, 200);

    await settings.getByRole("button", { name: "Подключить Telegram", exact: true }).click();
    const telegramLink = settings.getByRole("link", { name: "Открыть Telegram", exact: true });
    await telegramLink.waitFor();
    const telegramToken = new URL((await telegramLink.getAttribute("href"))!).searchParams.get("start");
    assert.ok(telegramToken);
    const telegram = await request(app).post("/api/tanbot-telegram/webhook").set("X-Telegram-Bot-Api-Secret-Token", SECRET).send({
      update_id: 88001, message: { message_id: 1, from: { id: 88001, is_bot: false, username: "header_local" },
        chat: { id: 88001, type: "private" }, date: 1, text: `/start ${telegramToken}` },
    });
    assert.equal(telegram.status, 200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const maxToggle = settings.getByRole("checkbox", { name: "Уведомления о новых передачах в MAX", exact: true });
    const telegramToggle = settings.getByRole("checkbox", { name: "Уведомления о новых передачах в Telegram", exact: true });
    await maxToggle.waitFor();
    await telegramToggle.waitFor();
    assert.equal(await maxToggle.isChecked(), true);
    assert.equal(await telegramToggle.isChecked(), true);
    await maxToggle.uncheck();
    await settings.getByText("Подключён · уведомления выключены", { exact: true }).waitFor();
    assert.equal(await telegramToggle.isChecked(), true);
    assert.equal(await settings.getByRole("link").count(), 0);
    const cookie = (await context.cookies()).map((c) => c.name + "=" + c.value).join("; ");
    const saved = await request(app).get("/api/profile/tanbot/max").set("Cookie", cookie);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.linked, true);
    assert.equal(saved.body.notificationsEnabled, false);
    assert.deepEqual(blockedExternal, []);
    await context.close();
  });
});
