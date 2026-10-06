import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const ORIGIN = "http://127.0.0.1:3000";
const DESKTOP = { width: 1440, height: 900 };
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const M1 = "11111111-1111-4111-8111-111111111111";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

describe("admin employee preview browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;
  let managerUserId = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seedDatabase(): Promise<void> {
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

    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });

    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client A", guid_manager: M1, name_manager: "Manager A" },
      {
        guid_client: C2,
        name_client: "Client B",
        guid_manager: "22222222-2222-4222-8222-222222222222",
        name_manager: "Other Manager",
      },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, C1, {
      formatVersion: "extended_v1",
      sourceSha256: "a".repeat(64),
      importedAt: new Date().toISOString(),
      isHolding: false,
      holdingLink: { state: "none", pendingGuid: null },
      clientManagerRosterState: "in_wholesale_roster",
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: ROP_A, name: "ROP", state: "directory_unverified" },
      currentRetailOutlets: [],
      retailOutletHistory: [],
      blocks: { clientExtendedReady: true, outletNormalizedReady: true },
    });
  }

  async function startServer(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl);
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async function login(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  it("admin preview: selector, banner, scoped list, card, return", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    const context = await browser.newContext({ viewport: DESKTOP, baseURL: baseUrl });
    const page = await context.newPage();
    await login(page, "admin@example.com");

    await page.goto("/admin/access", { waitUntil: "networkidle" });
    await page.waitForSelector("#preview-section");
    await page.fill("#preview-search-input", "manager-a");
    await page.click("#preview-search-btn");
    await page.waitForSelector('[data-preview-user="' + managerUserId + '"]');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "admin-employee-preview-selector.png"),
      fullPage: true,
    });

    const startResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/access/preview/start") && response.status() === 200,
    );
    await page.click('[data-preview-user="' + managerUserId + '"]');
    await startResponse;
    await page.waitForURL(/\/clients/, { timeout: 15000 });
    await page.waitForSelector(".clients-preview-banner");
    await page.waitForSelector("#clients-manager-chrome:not(.clients-hidden)");
    assert.match(await page.locator(".clients-preview-banner").innerText(), /Просмотр от имени: Manager A/);
    assert.match(await page.locator(".clients-preview-banner").innerText(), /Изменения запрещены/);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "admin-employee-preview-banner.png"),
      fullPage: true,
    });

    await page.waitForSelector("#clients-table-body tr");
    const listText = await page.locator("#clients-table-body").innerText();
    assert.ok(listText.includes("Client A"));
    assert.ok(!listText.includes("Client B"));

    const cardResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/clients/" + C1) &&
        !response.url().includes("/catalog/") &&
        response.status() === 200,
    );
    await page.locator('.clients-link[href*="/clients/' + C1 + '"]').first().click();
    await cardResponse;
    await page.waitForSelector("#client-detail:not(.clients-hidden)");

    const stopResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/access/preview/stop") && response.status() === 200,
    );
    await page.goto("/clients", { waitUntil: "networkidle" });
    await page.click("#clients-preview-stop-btn");
    await stopResponse;
    await page.waitForURL(/\/admin\/access/, { timeout: 15000 });
    assert.equal(await page.locator(".clients-preview-banner").count(), 0);

    await context.close();
    await stopServer();
  });
});
