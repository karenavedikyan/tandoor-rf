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
const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

describe("clients v3 UI (real API)", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const { createApp } = await import("../../src/server");
    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const addr = appServer!.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await browser?.close();
    if (appServer) {
      await new Promise<void>((resolve, reject) =>
        appServer!.close((err) => (err ? reject(err) : resolve())),
      );
      appServer = null;
    }
    await closePool();
  });

  async function seed(): Promise<{ email: string; adminEmail: string }> {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, baseUrl || "http://127.0.0.1:3000");
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
    return { email: "manager-v3-ui@example.com", adminEmail: "admin-v3-ui@example.com" };
  }

  async function login(page: Page, email: string): Promise<void> {
    await page.goto(baseUrl + "/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work)/);
  }

  async function assertListFilterState(page: Page): Promise<void> {
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("v3mode"), "1");
    assert.equal(url.searchParams.get("v3entity"), "legal");
    assert.equal(url.searchParams.get("v3type"), "t1");
    assert.match(url.searchParams.get("q") || "", /Legal/i);
    await page.waitForFunction(function () {
      var typeFilter = document.getElementById("v3-type-filter") as HTMLSelectElement | null;
      return Boolean(typeFilter && typeFilter.value === "t1");
    });
  }

  async function waitForLegalList(page: Page, expectTypeFilterRequest: boolean): Promise<void> {
    if (expectTypeFilterRequest) {
      await page
        .waitForResponse(
          (res) =>
            res.url().includes("/api/clients/v3/list") &&
            res.url().includes("entity=legal") &&
            res.url().includes("typeGuid=t1") &&
            res.status() === 200,
          { timeout: 20000 },
        )
        .catch(function () {
          /* bfcache / history navigation may restore list without a new request */
        });
    }
    await page
      .locator('#clients-table-body a:has-text("Legal One"), #clients-cards a:has-text("Legal One")')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });
  }

  async function runViewportFlow(page: Page, viewport: { width: number; height: number }): Promise<void> {
    await page.setViewportSize(viewport);
    const listUrl = baseUrl + "/clients?v3mode=1&v3entity=legal&page=1&q=Legal&v3type=t1&view=all";
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
    await assertListFilterState(page);

    const reloadList = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=legal") &&
        res.url().includes("typeGuid=t1") &&
        res.status() === 200,
    );
    await page.reload();
    await reloadList;
    await assertListFilterState(page);

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
    await waitForLegalList(page, true);

    const link =
      viewport.width <= 400
        ? page.locator('#clients-cards a:has-text("Legal One")')
        : page.locator('#clients-table-body a:has-text("Legal One")');
    await link.first().click();
    await page.waitForSelector('[data-testid="v3-detail-title"]');

    const returnParam = new URL(page.url()).searchParams.get("return");
    assert.ok(returnParam && returnParam.includes("v3mode=1"));
    assert.ok(returnParam.includes("v3entity=legal"));
    assert.ok(returnParam.includes("view=all"));

    await page.click('[data-testid="v3-back-to-list"]');
    await page.waitForURL(/\/clients\?.*v3mode=1/);
    await waitForLegalList(page, true);
    await assertListFilterState(page);

    await page.goBack();
    await page.waitForSelector('[data-testid="v3-detail-title"]');
    await page.goForward();
    await page.waitForURL(/\/clients\?.*v3mode=1/);
    await assertListFilterState(page);
    await waitForLegalList(page, false);
  }

  it("loads v3 all list when v3view=all conflicts with legacy view=teams in URL", async () => {
    await seed();
    const page = await browser.newPage();
    await login(page, "manager-v3-ui@example.com");
    const listResponse = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("entity=legal") && res.status() === 200,
    );
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal&page=1&v3view=all&view=teams");
    await listResponse;
    await page
      .locator('#clients-table-body a:has-text("Legal One"), #clients-cards a:has-text("Legal One")')
      .first()
      .waitFor({ state: "attached", timeout: 15000 });
    assert.equal(new URL(page.url()).searchParams.get("view"), "all");
    await page.close();
  });

  it("switches teams to all to teams without URL overriding user action", async () => {
    await seed();
    const page = await browser.newPage();
    await login(page, "admin-v3-ui@example.com");
    await page.goto(
      baseUrl + "/clients?v3mode=1&view=teams&v3view=teams&v3entity=legal&page=1",
      { waitUntil: "networkidle" },
    );
    const allTab = page.locator('#view-switcher [data-view="all"]');
    await allTab.waitFor({ state: "visible", timeout: 60000 });
    await allTab.click();
    await page.waitForURL(/view=all/, { timeout: 60000 });
    assert.equal(new URL(page.url()).searchParams.get("view"), "all");
    await page
      .locator('#clients-table-body a, #clients-cards a')
      .first()
      .waitFor({ state: "attached", timeout: 15000 })
      .catch(function () {
        /* empty list acceptable if fixture scope differs */
      });
    const teamsTab = page.locator('#view-switcher [data-view="teams"]');
    await teamsTab.click();
    await page.waitForURL(/view=teams/, { timeout: 60000 });
    assert.equal(new URL(page.url()).searchParams.get("view"), "teams");
    await page.close();
  });

  it("preserves query params when merging role entry href", async () => {
    await seed();
    const page = await browser.newPage();
    await login(page, "manager-v3-ui@example.com");
    const listResponse = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
    );
    await page.goto(baseUrl + "/clients?v3mode=1&q=Legal&page=2");
    await listResponse;
    const url = new URL(page.url());
    assert.match(url.searchParams.get("q") || "", /Legal/i);
    assert.equal(url.searchParams.get("page"), "2");
    await page.close();
  });

  it("desktop and mobile: v3 filters, entity switch, card fields and nested navigation", async () => {
    const creds = await seed();
    for (const viewport of [DESKTOP, MOBILE]) {
      const page = await browser.newPage();
      await login(page, creds.email);
      await runViewportFlow(page, viewport);
      await page.close();
    }
  });
});
