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
const M2 = "33333333-3333-4333-8333-333333333333";
const ROP = "55555555-5555-4555-8555-555555555555";
const TYPE_A = "t1";
const CAT_A = "c1";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const SCREENSHOT_DIR =
  process.env.CLIENTS_LKTANDOOR_STAGE2_DIR ??
  "/cursor/stores/self/media/clients-lktandoor-stage2-list";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

describe("lktandoor stage2 list UI", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await seed(databaseUrl);
    const { createApp } = await import("../../src/server");
    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const addr = appServer!.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  });

  after(async () => {
    await browser?.close();
    if (appServer) {
      await new Promise<void>((resolve, reject) =>
        appServer!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await closePool();
  });

  async function seed(databaseUrl: string) {
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-lktandoor-list@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Lktandoor",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-lktandoor-list@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Lktandoor",
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
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(ROP, { name_manager: "ROP One", post: "РОП" }),
    ]);
    const holdings = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json"), "utf8"));
    holdings[0].legal_entities.push({
      guid_retail: "b2000000-0000-4000-8000-000000000004",
      name_retail: "Legal Two",
    });
    const holdingsBytes = Buffer.from(JSON.stringify(holdings));
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes,
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes,
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    });
  }

  async function login(page: Page, email: string) {
    await page.goto(baseUrl + "/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile", { timeout: 30000 });
  }

  async function waitForList(page: Page) {
    const response = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal_grouped&view=all&v3view=all");
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await response;
    await page.waitForSelector("#clients-table-body tr a");
  }

  async function updateList(page: Page, action: () => Promise<unknown>) {
    const response = page.waitForResponse((res) => res.url().includes("/api/clients/v3/list") && res.status() === 200);
    await action();
    await response;
    await page.waitForFunction(() => document.querySelector("#clients-table-body")?.getAttribute("aria-busy") === "false");
  }

  async function rowCount(page: Page): Promise<number> {
    return page.locator("#clients-table-body tr").count();
  }

  it("manager: category filter, chip remove, card back retains URL", async () => {
    const page = await browser.newPage();
    await login(page, "manager-lktandoor-list@example.com");
    await waitForList(page);
    const before = await rowCount(page);
    assert.ok(before >= 2);
    const bodyText = await page.locator("#clients-table-body").innerText();
    assert.match(bodyText, /SYNTH Holding One/);
    await updateList(page, () => page.selectOption("#v3-lktandoor-category-filter", CAT_A));
    const narrowed = await rowCount(page);
    assert.ok(narrowed < before);
    assert.ok(page.url().includes("filters=") || page.url().includes("v3category="));
    await updateList(page, () => page.reload());
    assert.equal(await rowCount(page), narrowed);
    await page.locator("#clients-table-body tr a.clients-link").first().click();
    await page.waitForURL(/\/clients\//);
    await updateList(page, () => page.goBack());
    assert.equal(await rowCount(page), narrowed);
    await page.locator("#v3-lktandoor-field-filters summary").click();
    await updateList(page, () => page.locator('[data-testid="v3-rule-chip"]').first().click());
    assert.equal(await rowCount(page), before);
    const href = await page.locator("#clients-table-body tr a.clients-link").first().getAttribute("href");
    assert.ok(href);
    await page.locator("#clients-table-body tr a.clients-link").first().click();
    await page.waitForURL(/\/clients\//);
    await page.goBack();
    await page.waitForSelector("#clients-table-body tr");
    assert.ok(page.url().includes("v3mode=1"));
    assert.ok(page.url().includes("v3entity=legal_grouped"));
    await page.setViewportSize(DESKTOP);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-legal-desktop-1440.png") });
    await page.setViewportSize(MOBILE);
    await updateList(page, () => page.reload());
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');
    assert.equal(await rowCount(page), before);
    assert.ok(await page.locator('[data-testid="v3-lktandoor-mobile-card"]').first().isVisible());
    await page.locator("#v3-lktandoor-field-filters summary").click();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-legal-mobile-cold-390.png") });
    await page.close();
  });

  it("retail columns and typed AND rules", async () => {
    const page = await browser.newPage();
    await login(page, "manager-lktandoor-list@example.com");
    const initial = page.waitForResponse((res) => res.url().includes("/api/clients/v3/list") && res.status() === 200);
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=retail");
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)');
    await initial;
    await page.waitForSelector("#clients-table-body tr a");
    const text = await page.locator("#clients-table-body").innerText();
    assert.ok(text.includes("SYNTH Holding One") || text.includes("Retail Cat"));
    await page.locator("#v3-lktandoor-field-filters summary").click();
    await page.selectOption("#v3-rule-field", "lprName");
    await page.selectOption("#v3-rule-op", "contains");
    await page.fill("#v3-rule-value", "Ivan");
    await updateList(page, () => page.click("#v3-rule-add"));
    assert.equal(await rowCount(page), 1);
    await page.selectOption("#v3-rule-field", "closed");
    await page.selectOption("#v3-rule-op", "yes");
    await updateList(page, () => page.click("#v3-rule-add"));
    assert.equal(await rowCount(page), 0);
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get("filters")!).length, 2);
    await updateList(page, () => page.locator('[data-testid="v3-rule-chip"]').last().click());
    assert.equal(await rowCount(page), 1);
    assert.equal(new URL(page.url()).searchParams.get("closed"), null);
    await page.setViewportSize(MOBILE);
    await updateList(page, () => page.reload());
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');
    assert.equal(await rowCount(page), 1);
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get("filters")!).length, 1);
    await page.locator("#v3-lktandoor-field-filters summary").click();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-retail-mobile-390.png") });
    await page.close();
  });

  it("reset keeps territory params for admin drill-down", async () => {
    const page = await browser.newPage();
    await login(page, "admin-lktandoor-list@example.com");
    const territoryUrl =
      baseUrl +
      "/clients?v3mode=1&v3view=teams&view=teams&ropEmployee=" +
      encodeURIComponent(ROP) +
      "&responsibleGuid=" +
      encodeURIComponent(M1) +
      "&responsibleKind=manager&teamKind=manager";
    await page.goto(territoryUrl);
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await updateList(page, () => page.selectOption("#v3-lktandoor-category-filter", CAT_A));
    await updateList(page, () => page.click("#v3-list-reset-filters"));
    const url = page.url();
    assert.ok(url.includes("ropEmployee="));
    assert.ok(url.includes("responsibleGuid="));
    assert.ok(url.includes("responsibleKind=manager"));
    assert.ok(!url.includes("filters=") || !url.includes(encodeURIComponent(CAT_A)));
    await page.close();
  });

  it("grouped client opens holding and legal cards and restores the same filtered list", async () => {
    const page = await browser.newPage({ viewport: DESKTOP });
    await login(page, "admin-lktandoor-list@example.com");
    await waitForList(page);
    const holdingRow = page.locator("#clients-table-body tr").filter({ hasText: "SYNTH Holding One" });
    assert.equal(await holdingRow.count(), 1);
    assert.ok((await holdingRow.innerText()).includes("Legal One"));
    assert.ok((await holdingRow.innerText()).includes("Legal Two"));
    await updateList(page, () => page.selectOption("#v3-lktandoor-category-filter", CAT_A));
    assert.equal(await rowCount(page), 1);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "grouped-clients-desktop-1440.png") });
    await page.locator("#clients-table-body tr td").first().locator("a").click();
    await page.waitForURL(url => url.searchParams.get("v3Entity") === "holding");
    await page.waitForSelector('[data-testid="v3-back-to-list"]');
    await updateList(page, () => page.locator('[data-testid="v3-back-to-list"]').click());
    assert.equal(await rowCount(page), 1);
    assert.ok(page.url().includes("v3entity=legal_grouped"));
    await page.locator("#clients-table-body a.clients-link--secondary").filter({ hasText: "Legal Two" }).click();
    await page.waitForURL(url => url.searchParams.get("v3Entity") === "legal");
    await page.waitForSelector('[data-testid="v3-back-to-list"]');
    await updateList(page, () => page.locator('[data-testid="v3-back-to-list"]').click());
    assert.equal(await rowCount(page), 1);
    await page.setViewportSize(MOBILE);
    await updateList(page, () => page.reload());
    const card = page.locator('[data-testid="v3-lktandoor-mobile-card"]');
    assert.equal(await card.count(), 1);
    assert.ok((await card.innerText()).includes("Legal One, Legal Two"));
    assert.ok(await card.isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "grouped-clients-mobile-390.png") });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "grouped-clients-mobile-details-390.png") });
    await page.close();
  });
});
