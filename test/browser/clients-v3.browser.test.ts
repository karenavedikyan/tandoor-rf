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
const ORIGIN = "http://127.0.0.1:3000";
const M1 = "22222222-2222-4222-8222-222222222222";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

describe("clients v3 UI (real API)", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    if (server) {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
    await closePool();
  });

  async function seed(): Promise<{ email: string }> {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-v3-ui@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin V3 UI",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-v3-ui@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager V3 UI",
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
    return { email: "manager-v3-ui@example.com" };
  }

  async function login(page: Page, email: string): Promise<void> {
    await page.goto(baseUrl + "/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work)/);
  }

  async function runViewportFlow(page: Page, viewport: { width: number; height: number }): Promise<void> {
    await page.setViewportSize(viewport);
    const listUrl = baseUrl + "/clients?v3mode=1&v3entity=legal&page=1&q=Legal&v3type=t1";
    const initialList = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=legal") &&
        res.url().includes("typeGuid=t1") &&
        res.status() === 200,
    );
    const initialOptions = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/options") && res.url().includes("entity=legal") && res.status() === 200,
    );
    await page.goto(listUrl);
    await Promise.all([initialList, initialOptions]);
    await page.waitForFunction(function () {
      var wrap = document.getElementById("v3-filters-wrap");
      var typeFilter = document.getElementById("v3-type-filter");
      return wrap && !wrap.classList.contains("clients-hidden") && typeFilter && typeFilter.options.length > 1;
    });
    const typeValue = await page.$eval("#v3-type-filter", (sel) => (sel as HTMLSelectElement).value);
    assert.equal(typeValue, "t1");
    await page
      .locator('#clients-table-body a:has-text("Legal One"), #clients-cards a:has-text("Legal One")')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });

    const holdingsClick = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("entity=holdings") && res.status() === 200,
    );
    await page.click('[data-v3entity="holdings"]');
    await holdingsClick;
    await page.waitForFunction(function () {
      return document.querySelector('[data-v3entity="holdings"].clients-view-switcher__btn--active');
    });

    const legalClick = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("entity=legal") && res.status() === 200,
    );
    await page.click('[data-v3entity="legal"]');
    await legalClick;
    await page
      .locator('#clients-table-body a:has-text("Legal One"), #clients-cards a:has-text("Legal One")')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });

    const link =
      viewport.width <= 400
        ? page.locator('#clients-cards a:has-text("Legal One")')
        : page.locator('#clients-table-body a:has-text("Legal One")');
    await link.first().click();
    await page.waitForSelector('[data-testid="v3-detail-title"]');
    await page.waitForSelector("dt:has-text('Тип и категория') + dd:has-text('Type A / Cat A')");
    await page.waitForSelector("dt:has-text('РОП') + dd:has-text('ROP One')");

    const returnParam = new URL(page.url()).searchParams.get("return");
    assert.ok(returnParam && returnParam.includes("v3mode=1"));
    assert.ok(returnParam.includes("v3entity=legal"));

    await page.click('[data-testid="v3-back-to-list"]');
    await page.waitForURL(/\/clients\?.*v3mode=1/);
    assert.match(page.url(), /v3entity=legal/);

    await page
      .locator('#clients-table-body a:has-text("Legal One"), #clients-cards a:has-text("Legal One")')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });
    const cardLink =
      viewport.width <= 400
        ? page.locator('#clients-cards a:has-text("Legal One")').first()
        : page.locator('#clients-table-body a:has-text("Legal One")').first();
    await cardLink.click();
    await page.waitForSelector('[data-testid="v3-detail-title"]');
    const holdingNav = page.locator('.client-card-section a[href*="v3Entity=holding"]').first();
    await holdingNav.waitFor({ state: "visible", timeout: 15000 });
    await holdingNav.click();
    await page.waitForSelector("#v3-composition a", { timeout: 15000 });
    await page.locator("#v3-composition a").first().click();
    await page.waitForSelector('[data-testid="v3-back-to-list"]');
    await page.click('[data-testid="v3-back-to-list"]');
    await page.waitForSelector("#v3-composition", { timeout: 15000 });
    await page.click('[data-testid="v3-back-to-list"]');
    await page.waitForSelector('[data-testid="v3-detail-title"]');
    await page.click('[data-testid="v3-back-to-list"]');
    await page.waitForURL(/\/clients\?.*v3mode=1/);
    await page
      .locator('#clients-table-body a:has-text("Legal One"), #clients-cards a:has-text("Legal One")')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });
  }

  it("desktop and mobile: v3 filters, entity switch, card fields and nested navigation", async () => {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    const creds = await seed();

    for (const viewport of [DESKTOP, MOBILE]) {
      const page = await browser.newPage();
      await login(page, creds.email);
      await runViewportFlow(page, viewport);
      await page.close();
    }
  });
});
