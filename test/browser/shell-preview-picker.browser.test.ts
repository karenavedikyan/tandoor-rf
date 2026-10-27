import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { insertSuccessfulImportRun, insertSyntheticClients } from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { loginCabinet } from "./helpers/cabinet-login.js";

const TEST_PASSWORD = "StrongPass123!";
const ORIGIN = "http://127.0.0.1:3000";
const MOBILE = { width: 375, height: 812 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/cursor/stores/self/media");

describe("shell preview picker browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;
  let managerUserId = "";
  let blockedRopId = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seed(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    managerUserId = manager.id;
    const rop = await createTestUser({
      databaseUrl,
      email: "rop-unlinked@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP Unlinked",
      role: "rop",
    });
    blockedRopId = rop.id;
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: "11111111-1111-4111-8111-111111111111",
      confirmedByUserId: admin.id,
    });
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name_client: "Client A",
        guid_manager: "11111111-1111-4111-8111-111111111111",
        name_manager: "Manager A",
      },
    ]);
  }

  async function startServer(): Promise<void> {
    await resetPoolForTests();
    setIntegrationEnv(databaseUrl, baseUrl);
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    server = undefined as unknown as http.Server;
  }

  async function login(page: Page): Promise<void> {
    await loginCabinet(page, "admin@example.com", TEST_PASSWORD);
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#shell-preview-open", { timeout: 20000 });
  }

  async function openPicker(page: Page): Promise<void> {
    await page.click("#shell-preview-open");
    await page.waitForSelector("#shell-preview-picker");
  }

  it("picker: failed start keeps blocked rows disabled and allows retry", async () => {
    await seed();
    await startServer();
    const context = await browser.newContext({ viewport: MOBILE, baseURL: baseUrl });
    try {
      const page = await context.newPage();
      let failOnce = true;
      await page.route("**/api/admin/access/preview/start", async (route) => {
        const body = route.request().postDataJSON() as { userId?: string };
        if (failOnce && body.userId === managerUserId) {
          failOnce = false;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "Синтетическая проверка временной ошибки" } }),
          });
          return;
        }
        await route.continue();
      });

      await login(page);
      await openPicker(page);
      await page.fill("#shell-preview-query", "rop-unlinked");
      await page.waitForResponse(
        (r) => r.url().includes("/api/admin/access/preview/candidates") && r.status() === 200,
      );
      await page.waitForSelector("button.shell-preview-person[data-can-select='false']", { timeout: 20000 });

      await page.fill("#shell-preview-query", "manager-a");
      await page.waitForResponse(
        (r) => r.url().includes("/api/admin/access/preview/candidates") && r.status() === 200,
      );
      await page.waitForSelector('[data-preview-id="' + managerUserId + '"]', { timeout: 20000 });
      await page.click('[data-preview-id="' + managerUserId + '"]');
      await page.waitForSelector("#shell-preview-status", { hasText: "Синтетическая" });

      assert.equal(await page.locator('[data-preview-id="' + managerUserId + '"]').count(), 1);
      const selectable = page.locator('[data-preview-id="' + managerUserId + '"]');
      assert.equal(await selectable.isDisabled(), false);

      await page.fill("#shell-preview-query", "rop-unlinked");
      await page.waitForResponse(
        (r) => r.url().includes("/api/admin/access/preview/candidates") && r.status() === 200,
      );
      const blocked = page.locator("button.shell-preview-person[data-can-select='false']");
      assert.ok((await blocked.count()) >= 1);
      assert.equal(await blocked.first().isDisabled(), true);

      await page.fill("#shell-preview-query", "manager-a");
      await page.waitForResponse(
        (r) => r.url().includes("/api/admin/access/preview/candidates") && r.status() === 200,
      );
      await selectable.click();
      await page.waitForURL(/\/clients/, { timeout: 15000 });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "shell-preview-picker-retry-success.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
      await stopServer();
    }
  });

  it("admin return shows shell preview control again", async () => {
    await seed();
    await startServer();
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      const page = await context.newPage();
      await login(page);
      await openPicker(page);
      await page.fill("#shell-preview-query", "manager-a");
      await page.waitForSelector('[data-preview-id="' + managerUserId + '"]');
      await page.click('[data-preview-id="' + managerUserId + '"]');
      await page.waitForURL(/\/clients/, { timeout: 15000 });

      const stop = page.waitForResponse((r) => r.url().includes("/preview/stop") && r.status() === 200);
      await page.click("#clients-preview-stop-btn");
      await stop;
      await page.waitForURL(/\/admin\/access/, { timeout: 15000 });
      await page.waitForSelector("#shell-preview-open");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "shell-preview-admin-return-control.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
      await stopServer();
    }
  });
});
