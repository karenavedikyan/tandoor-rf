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
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/clients-lktandoor-stage2-list-v2";
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

  async function closeMobileSidebar(page: Page) {
    await page.evaluate(() => {
      document.body.classList.remove("legacy-sidebar-open");
      const backdrop = document.getElementById("legacy-backdrop");
      if (backdrop) backdrop.setAttribute("hidden", "hidden");
    });
  }

  async function assertDesktopToolbarLayout(page: Page) {
    const layout = await page.evaluate(() => {
      const row = document.querySelector(".clients-lktandoor-list .clients-toolbar__search-row");
      const search = document.querySelector("#search-input");
      const switcher = document.querySelector(".clients-entity-switcher--primary");
      const shortcut = document.querySelector(".x6-field-shortcut");
      if (!row || !search || !switcher) {
        return null;
      }
      const rowRect = row.getBoundingClientRect();
      const searchRect = search.getBoundingClientRect();
      const controls = row.querySelector(".clients-toolbar__controls-row");
      const controlsRect = controls?.getBoundingClientRect();
      const switcherStyle = getComputedStyle(switcher);
      const shortcutRadius = shortcut ? getComputedStyle(shortcut).borderRadius : "";
      return {
        searchWidthRatio: searchRect.width / rowRect.width,
        gapAfterSearch: controlsRect ? controlsRect.left - searchRect.right : 999,
        switcherBorderWidth: switcherStyle.borderWidth,
        switcherBackground: switcherStyle.backgroundColor,
        shortcutRadius,
        rowDisplay: getComputedStyle(row).display,
      };
    });
    assert.ok(layout, "toolbar layout nodes missing");
    assert.equal(layout.rowDisplay, "flex");
    assert.ok(layout.searchWidthRatio > 0.35, "search should consume spare desktop width");
    assert.ok(layout.gapAfterSearch < 24, "search and controls should sit adjacent");
    assert.equal(layout.switcherBorderWidth, "0px", "entity switcher should not use segmented shell border");
    assert.ok(!layout.shortcutRadius.includes("999"), "shortcuts should be rectangular");
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
    await page.evaluate(() => {
      const details = document.getElementById("v3-lktandoor-field-filters");
      if (details) details.open = false;
    });
    await assertDesktopToolbarLayout(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "impl-list-desktop-1440.png") });
    await page.locator("#v3-lktandoor-field-filters summary").click();
    await page.waitForSelector(".x6-field-shortcuts .x6-field-shortcut", { state: "visible" });
    assert.ok(await page.locator(".x6-field-shortcut--disabled").filter({ hasText: "ИНН" }).count());
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "impl-filters-desktop-1440.png") });
    await page.setViewportSize(MOBILE);
    await closeMobileSidebar(page);
    await updateList(page, () => page.reload());
    await closeMobileSidebar(page);
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');
    assert.equal(await rowCount(page), before);
    assert.ok(await page.locator('[data-testid="v3-lktandoor-mobile-card"]').first().isVisible());
    await page.evaluate(() => {
      const details = document.getElementById("v3-lktandoor-field-filters");
      if (details) details.open = false;
    });
    const mobileToolbar = await page.evaluate(() => {
      const row = document.querySelector(".clients-lktandoor-list .clients-toolbar__controls-row");
      const buttons = row ? row.querySelectorAll("button, .clients-view-switcher__btn").length : 0;
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      return { buttons, overflow };
    });
    assert.ok(mobileToolbar.buttons >= 3, "mobile toolbar should show three controls");
    assert.equal(mobileToolbar.overflow, false, "mobile list should not overflow horizontally");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "impl-mobile-toolbar-390.png") });
    await page.locator('[data-testid="v3-lktandoor-mobile-card"]').first().click();
    await page.waitForURL(/\/clients\//);
    await page.goBack();
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "impl-mobile-card-390.png") });
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
    await closeMobileSidebar(page);
    await updateList(page, () => page.reload());
    await closeMobileSidebar(page);
    await page.waitForSelector('[data-testid="v3-lktandoor-mobile-card"]');
    assert.equal(await rowCount(page), 1);
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get("filters")!).length, 1);
    await page.locator("#v3-lktandoor-field-filters summary").click();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-retail-mobile-390.png") });
    await page.close();
  });

  it("admin primary entity switcher shows secondary registries separately", async () => {
    const page = await browser.newPage({ viewport: DESKTOP });
    await login(page, "admin-lktandoor-list@example.com");
    await waitForList(page);
    assert.equal(await page.locator(".clients-entity-switcher--primary [data-v3entity]").count(), 2);
    await page.waitForSelector('#v3-lktandoor-secondary-entities [data-v3entity="holdings"]');
    const holdingsList = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
    );
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=holdings&view=all&v3view=all");
    await holdingsList;
    assert.equal(new URL(page.url()).searchParams.get("v3entity"), "holdings");
    await page.waitForSelector("#clients-table-body tr");
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
    await closeMobileSidebar(page);
    await updateList(page, () => page.reload());
    await closeMobileSidebar(page);
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
