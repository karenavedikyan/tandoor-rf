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
const REGIONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HARDWARE = "77777777-7777-4777-8777-777777777777";
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
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(REGIONAL, { name_manager: "Regional One" }),
      buildEmployeeRosterEntry(HARDWARE, { name_manager: "Hardware One" }),
      buildEmployeeRosterEntry(ROP, {
        name_manager: "ROP One",
        post: "Руководитель отдела продаж",
      }),
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
      if (!typeFilter) {
        return false;
      }
      return Array.from(typeFilter.selectedOptions || []).some(function (opt) {
        return opt.value === "t1";
      });
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
    const typeSelected = await page.$eval("#v3-type-filter", (sel) =>
      Array.from((sel as HTMLSelectElement).selectedOptions).map((o) => o.value),
    );
    assert.ok(typeSelected.includes("t1"));
    await assertListFilterState(page);
    if (viewport.width <= 400) {
      await page.locator(".clients-card__meta").first().waitFor({ state: "attached", timeout: 15000 });
    }

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

    const retailClick = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("entity=retail") && res.status() === 200,
    );
    await page.click('[data-v3entity="retail"]');
    await retailClick;
    await page.waitForFunction(function () {
      return document.querySelector('[data-v3entity="retail"].clients-view-switcher__btn--active');
    });

    const legalClick = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("entity=legal") && res.status() === 200,
    );
    await page.click('[data-v3entity="legal"]');
    await legalClick;
    const restoreList = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=legal") &&
        res.url().includes("typeGuid=t1") &&
        res.status() === 200,
    );
    await page.goto(listUrl);
    await restoreList;
    await waitForLegalList(page, true);
    await assertListFilterState(page);

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
    await page.locator('#clients-table-body a:has-text("Legal One"), #clients-cards a:has-text("Legal One")').first().waitFor({
      state: "attached",
      timeout: 15000,
    });
    const teamsTab = page.locator('#view-switcher [data-view="teams"]');
    await teamsTab.click();
    await page.waitForURL(/view=teams/, { timeout: 60000 });
    assert.equal(new URL(page.url()).searchParams.get("view"), "teams");
    await page.close();
  });

  it("team responsible selection filters v3 list and clears on view change", async () => {
    await seed();
    const page = await browser.newPage();
    await login(page, "admin-v3-ui@example.com");
    await page.goto(
      baseUrl +
        "/clients?v3mode=1&view=teams&v3view=teams&ropEmployee=" +
        encodeURIComponent(ROP) +
        "&v3entity=legal",
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector(
      `button[data-manager="${M1}"][data-responsible-entity="clients"]`,
      { timeout: 60000 },
    );
    const listM1 = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("responsibleGuid=" + encodeURIComponent(M1)) &&
        res.status() === 200,
      { timeout: 60000 },
    );
    await page.locator(`button[data-manager="${M1}"][data-responsible-entity="clients"]`).click();
    const respM1 = await listM1;
    const bodyM1 = (await respM1.json()) as { items: Array<{ name: string }> };
    assert.ok(bodyM1.items.some((item) => item.name === "Legal One"));
    assert.ok(!bodyM1.items.some((item) => item.name === "Legal Two"));
    assert.match(new URL(page.url()).search, new RegExp(encodeURIComponent(M1)));

    await page.locator("#v3-manager-filter").evaluate(function (el, m1) {
      (el as HTMLSelectElement).value = m1;
    }, M1);

    await page.locator('#view-switcher [data-view="teams"]').click();
    await page.waitForSelector(
      `button[data-manager="${M2}"][data-responsible-entity="clients"]`,
      { timeout: 60000 },
    );

    const listM2 = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("responsibleGuid=" + encodeURIComponent(M2)) &&
        res.status() === 200,
      { timeout: 60000 },
    );
    await page.locator(`button[data-manager="${M2}"][data-responsible-entity="clients"]`).click();
    const respM2 = await listM2;
    const bodyM2 = (await respM2.json()) as { items: Array<{ name: string }> };
    assert.ok(bodyM2.items.some((item) => item.name === "Legal Two"));
    assert.ok(!bodyM2.items.some((item) => item.name === "Legal One"));
    assert.ok(!respM2.url().includes(encodeURIComponent(M1)));

    const listAll = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=legal") &&
        !res.url().includes("responsibleGuid=") &&
        !res.url().includes("managerGuid=") &&
        res.status() === 200,
      { timeout: 60000 },
    );
    await page.locator('#view-switcher [data-view="all"]').click();
    await page.waitForURL(/view=all/, { timeout: 60000 });
    await page.waitForFunction(function () {
      var params = new URL(window.location.href).searchParams;
      return !params.get("responsibleGuid") && !params.get("v3manager");
    });
    await listAll.catch(function () {
      /* list may reuse cached response when filters unchanged */
    });
    await page
      .locator(
        '#clients-table-body a:has-text("Legal One"), #clients-table-body a:has-text("Legal Two"), #clients-cards a:has-text("Legal One")',
      )
      .first()
      .waitFor({ state: "attached", timeout: 15000 });
    await page
      .locator(
        '#clients-table-body a:has-text("Legal Two"), #clients-cards a:has-text("Legal Two")',
      )
      .first()
      .waitFor({ state: "attached", timeout: 15000 });
    await page.close();
  });

  it("team responsible kind switches without reload", async () => {
    await seed();
    const page = await browser.newPage();
    await login(page, "admin-v3-ui@example.com");
    await page.goto(
      baseUrl +
        "/clients?v3mode=1&view=teams&v3view=teams&ropEmployee=" +
        encodeURIComponent(ROP) +
        "&v3entity=legal&v3manager=" +
        encodeURIComponent(M1),
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector(
      `button[data-manager="${M1}"][data-responsible-entity="clients"]`,
      { timeout: 60000 },
    );
    const listM1 = page.waitForResponse(
      (res) =>
        res.url().includes("responsibleGuid=" + encodeURIComponent(M1)) &&
        res.url().includes("responsibleKind=manager") &&
        res.status() === 200,
    );
    await page.locator(`button[data-manager="${M1}"][data-responsible-entity="clients"]`).click();
    await listM1;

    const responsiblesReload = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/org-structure/") &&
        res.url().includes("/responsibles") &&
        res.status() === 200,
      { timeout: 60000 },
    );
    await page.locator('#view-switcher [data-view="teams"]').click();
    await responsiblesReload;
    await page.waitForSelector(
      `button[data-manager="${REGIONAL}"][data-responsible-kind="regional"][data-responsible-entity="clients"]`,
      { timeout: 60000 },
    );
    const listRegional = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("responsibleGuid=" + encodeURIComponent(REGIONAL)) &&
        res.url().includes("responsibleKind=regional") &&
        !res.url().includes("managerGuid=" + encodeURIComponent(M1)) &&
        res.status() === 200,
      { timeout: 60000 },
    );
    await page
      .locator(
        `button[data-manager="${REGIONAL}"][data-responsible-kind="regional"][data-responsible-entity="clients"]`,
      )
      .click();
    await listRegional;

    await page.locator('#view-switcher [data-view="teams"]').click();
    await page.waitForSelector(
      `button[data-manager="${HARDWARE}"][data-responsible-kind="hardware"]`,
      { timeout: 60000 },
    );
    const listHardware = page.waitForResponse(
      (res) =>
        res.url().includes("responsibleGuid=" + encodeURIComponent(HARDWARE)) &&
        res.url().includes("responsibleKind=hardware") &&
        res.status() === 200,
    );
    await page
      .locator(
        `button[data-manager="${HARDWARE}"][data-responsible-kind="hardware"][data-responsible-entity="clients"]`,
      )
      .click();
    await listHardware;

    await page.locator('#view-switcher [data-view="teams"]').click();
    await page.waitForSelector(
      `button[data-manager="${M2}"][data-responsible-entity="clients"]`,
      { timeout: 60000 },
    );
    const listClear = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        !res.url().includes("responsibleGuid=") &&
        res.status() === 200,
      { timeout: 60000 },
    );
    await page.locator('#view-switcher [data-view="all"]').click();
    await listClear.catch(() => undefined);
    assert.equal(new URL(page.url()).searchParams.get("responsibleGuid") || "", "");
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

  it("v3 retail filters persist through search, clear and pagination", async () => {
    await seed();
    const page = await browser.newPage();
    await login(page, "admin-v3-ui@example.com");
    const listReady = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=retail") &&
        res.status() === 200,
    );
    await page.goto(
      baseUrl + "/clients?v3mode=1&v3entity=retail&view=all&v3pageSize=1&page=1",
      { waitUntil: "networkidle" },
    );
    await listReady;
    await page.waitForFunction(function () {
      var wrap = document.getElementById("v3-filters-wrap");
      return wrap && !wrap.classList.contains("clients-hidden");
    });
    await page.waitForFunction(
      (m1) => {
        const sel = document.getElementById("v3-manager-filter") as HTMLSelectElement | null;
        return Boolean(sel && Array.from(sel.options).some((o) => o.value === m1));
      },
      M1,
      { timeout: 30000 },
    );

    const managerList = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("managerGuid=" + encodeURIComponent(M1)) &&
        res.status() === 200,
    );
    await page.selectOption("#v3-manager-filter", M1);
    await managerList;

    const closedList = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("closed=false") &&
        res.url().includes("managerGuid=" + encodeURIComponent(M1)) &&
        res.status() === 200,
    );
    await page.selectOption("#v3-closed-filter", "false");
    await closedList;

    const typeList = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("typeGuid=rt1") &&
        res.url().includes("managerGuid=" + encodeURIComponent(M1)) &&
        res.status() === 200,
    );
    await page.selectOption("#v3-type-filter", "rt1");
    const typeResp = await typeList;
    const typeBody = (await typeResp.json()) as { items: Array<{ name: string }> };
    assert.ok(typeBody.items.every((i) => i.name !== "Store Three Closed"));

    const searchList = page.waitForResponse(
      (res) => {
        const u = res.url();
        return (
          u.includes("/api/clients/v3/list") &&
          u.includes("q=Store") &&
          u.includes("managerGuid=" + encodeURIComponent(M1)) &&
          u.includes("closed=false") &&
          u.includes("typeGuid=rt1") &&
          res.status() === 200
        );
      },
      { timeout: 45000 },
    );
    await page.fill("#search-input", "Store");
    const searchResp = await searchList;
    const searchBody = (await searchResp.json()) as { items: Array<{ name: string }> };
    assert.ok(searchBody.items.length >= 1);
    const urlAfterSearch = new URL(page.url());
    assert.equal(urlAfterSearch.searchParams.get("v3manager"), M1);
    assert.equal(urlAfterSearch.searchParams.get("closed"), "false");
    assert.equal(urlAfterSearch.searchParams.get("v3type"), "rt1");
    assert.match(urlAfterSearch.searchParams.get("q") || "", /Store/i);

    const clearSearchList = page.waitForResponse(
      (res) => {
        const u = res.url();
        return (
          u.includes("/api/clients/v3/list") &&
          !u.includes("q=Store") &&
          u.includes("managerGuid=" + encodeURIComponent(M1)) &&
          u.includes("closed=false") &&
          u.includes("typeGuid=rt1") &&
          res.status() === 200
        );
      },
      { timeout: 45000 },
    );
    await page.fill("#search-input", "");
    await clearSearchList.catch(async function () {
      await page.waitForFunction(
        (m1) => {
          const params = new URL(window.location.href).searchParams;
          return (
            (params.get("q") || "") === "" &&
            params.get("v3manager") === m1 &&
            params.get("closed") === "false" &&
            params.get("v3type") === "rt1"
          );
        },
        M1,
        { timeout: 15000 },
      );
    });
    const urlAfterClearQ = new URL(page.url());
    assert.equal(urlAfterClearQ.searchParams.get("v3manager"), M1);
    assert.equal(urlAfterClearQ.searchParams.get("closed"), "false");
    assert.equal(urlAfterClearQ.searchParams.get("v3type"), "rt1");
    assert.equal(urlAfterClearQ.searchParams.get("q") || "", "");

    await page.waitForSelector("#page-next:not([disabled])", { timeout: 15000 });
    const page2List = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("page=2") &&
        res.url().includes("pageSize=1") &&
        res.url().includes("managerGuid=" + encodeURIComponent(M1)) &&
        res.status() === 200,
      { timeout: 45000 },
    );
    await page.click("#page-next");
    await page2List;
    assert.equal(new URL(page.url()).searchParams.get("page"), "2");

    const firstRow = page.locator("#clients-table-body a, #clients-cards a").first();
    await firstRow.click();
    await page.waitForSelector('[data-testid="v3-back-to-list"]');
    const returnQuery = new URL(page.url()).searchParams.get("return") || "";
    assert.ok(returnQuery.includes("page=2"));
    assert.ok(returnQuery.includes("v3pageSize=1"));
    assert.ok(returnQuery.includes("v3manager=" + encodeURIComponent(M1)));
    const backToList = page
      .waitForResponse(
        (res) =>
          res.url().includes("/api/clients/v3/list") &&
          res.url().includes("page=2") &&
          res.url().includes("pageSize=1") &&
          res.status() === 200,
        { timeout: 45000 },
      )
      .catch(function () {
        return null;
      });
    await Promise.all([
      page.waitForURL((url) => new URL(url).searchParams.get("page") === "2", { timeout: 45000 }),
      page.click('[data-testid="v3-back-to-list"]'),
    ]);
    await backToList;
    await page.waitForSelector("#clients-table-body a, #clients-cards a", { timeout: 15000 });
    assert.equal(new URL(page.url()).searchParams.get("page"), "2");
    assert.equal(new URL(page.url()).searchParams.get("v3manager"), M1);

    await page.waitForSelector("#v3-manager-filter", { timeout: 20000 });
    const clearManagerList = page.waitForResponse(
      (res) => {
        const u = res.url();
        return (
          u.includes("/api/clients/v3/list") &&
          !u.includes("managerGuid=") &&
          !u.includes("responsibleGuid=") &&
          res.status() === 200
        );
      },
      { timeout: 30000 },
    );
    await page.selectOption("#v3-manager-filter", "");
    await clearManagerList;
    const clearClosedList = page.waitForResponse(
      (res) => {
        const u = res.url();
        return u.includes("/api/clients/v3/list") && !u.includes("closed=") && res.status() === 200;
      },
      { timeout: 30000 },
    );
    await page.selectOption("#v3-closed-filter", "");
    await clearClosedList;
    const finalUrl = new URL(page.url());
    assert.equal(finalUrl.searchParams.get("v3manager") || "", "");
    assert.equal(finalUrl.searchParams.get("closed") || "", "");
    await page.close();
  });

  it("v3 hides legacy phone filter; type chip clears without affecting other filters", async () => {
    const creds = await seed();
    const page = await browser.newPage();
    await login(page, creds.email);
    const listReady = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=legal") &&
        res.url().includes("typeGuid=t1") &&
        res.status() === 200,
    );
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal&view=all&v3type=t1", {
      waitUntil: "networkidle",
    });
    await listReady;
    assert.ok(await page.locator("#phone-filter").isHidden());
    assert.ok(await page.locator("#holding-filter-wrap").isHidden());
    await page.waitForSelector(".clients-v3-filter-chip", { timeout: 15000 });
    const chipClear = page.waitForResponse(
      (res) => {
        const u = res.url();
        return u.includes("/api/clients/v3/list") && !u.includes("typeGuid=") && res.status() === 200;
      },
      { timeout: 30000 },
    );
    await page.click('[data-v3-clear-filter="v3type"]');
    await chipClear;
    assert.equal(new URL(page.url()).searchParams.get("v3type") || "", "");
    await page.waitForFunction(function () {
      var sel = document.getElementById("v3-type-filter") as HTMLSelectElement | null;
      return Boolean(sel && sel.value === "");
    });
    assert.ok((await page.locator(".clients-v3-filter-chip").count()) === 0);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).searchParams.get("v3type") || "", "");
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
