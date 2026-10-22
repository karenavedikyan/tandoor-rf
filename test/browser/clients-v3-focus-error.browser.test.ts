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
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const CREDIT_GTE = "#v3-focus-filter-credit_limit-gte";
const FOCUS_SEARCH = "#v3-focus-search";

const NORMALIZER_CASES: Array<{ input: string; expectOk: boolean; value?: string }> = [
  { input: "1e3", expectOk: true, value: "1000" },
  { input: "1e-20", expectOk: true, value: "0.00000000000000000001" },
  { input: "1e21", expectOk: true, value: "1000000000000000000000" },
  { input: "9007199254740993", expectOk: true, value: "9007199254740993" },
  { input: "Infinity", expectOk: false },
];

const HUGE_EXPONENT_CASES = ["1e4294967296", "1e-4294967296", "1e1000000"];

describe("clients v3 focus error shell (real API)", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await seedDatabase(databaseUrl);
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

  async function seedDatabase(databaseUrl: string): Promise<void> {
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry("22222222-2222-4222-8222-222222222222", { name_manager: "Manager One" }),
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
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-focus-shell@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Focus Shell",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "focus-shell@example.com",
      password: TEST_PASSWORD,
      fullName: "Focus Shell",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: "22222222-2222-4222-8222-222222222222",
      confirmedByUserId: admin.id,
    });
  }

  async function login(page: Page, email = "admin-focus-shell@example.com"): Promise<void> {
    await page.goto(baseUrl + "/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile", { timeout: 30000 });
  }

  async function openLktandoorList(page: Page): Promise<void> {
    const response = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 60000 },
    );
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal_grouped&view=all&v3view=all&page=1&pageSize=50");
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 60000 });
    await response;
    await page.waitForSelector("#clients-table-body tr a", { timeout: 30000 });
  }

  async function enterFocus(page: Page): Promise<void> {
    await page.waitForSelector('[data-testid="v3-focus-enter"]:not(.clients-hidden)');
    const response = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
    );
    await page.click('[data-testid="v3-focus-enter"]');
    await page.waitForSelector('[data-testid="v3-focus-root"]', { state: "visible", timeout: 30000 });
    await response;
    await page.waitForFunction(() => document.body.classList.contains("x14-focus-mode"));
    await page.waitForSelector(CREDIT_GTE, { state: "visible", timeout: 15000 });
  }

  async function applyCreditGteViaKeyboard(page: Page, value: string): Promise<void> {
    const input = page.locator(CREDIT_GTE);
    const response = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
    );
    await input.click();
    await input.fill(value);
    await page.waitForTimeout(250);
    await response;
  }

  it("runtime JS normalizer matches safe decimal corpus and rejects huge exponents without throw", async () => {
    const page = await browser.newPage();
    await login(page);
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal_grouped&view=all");
    await page.waitForFunction(() => Boolean(window.ClientsV3FilterNumber));
    for (const row of NORMALIZER_CASES) {
      const result = await page.evaluate((input) => {
        return window.ClientsV3FilterNumber.normalizeListFilterNumberValue(input);
      }, row.input);
      assert.equal(result.ok, row.expectOk, `ok flag for ${row.input}`);
      if (row.expectOk) {
        assert.equal((result as { ok: true; value: string }).value, row.value);
      }
    }
    for (const sample of HUGE_EXPONENT_CASES) {
      const result = await page.evaluate((input) => {
        return window.ClientsV3FilterNumber.normalizeListFilterNumberValue(input);
      }, sample);
      assert.equal(result.ok, false, `huge exponent must reject: ${sample}`);
    }
    await page.close();
  });

  it("renders focus error chrome after HTTP 400 via native search", async () => {
    const page = await browser.newPage();
    await login(page);
    await openLktandoorList(page);
    await enterFocus(page);
    await page.route("**/api/clients/v3/list?*", (route) => {
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "filters: invalid number" }),
      });
    });
    const reload = page.waitForResponse((res) => res.url().includes("/api/clients/v3/list") && res.status() === 400);
    await page.locator(FOCUS_SEARCH).fill("ошибка-400");
    await page.waitForTimeout(250);
    await reload;
    await page.waitForSelector('[data-testid="v3-focus-error"]', { state: "visible", timeout: 15000 });
    await page.locator("#v3-focus-exit").waitFor({ state: "visible", timeout: 10000 });
    await page.locator("#v3-focus-columns").waitFor({ state: "visible", timeout: 10000 });
    const statusText = await page.locator(".x14-focusbar [role=status]").innerText();
    assert.ok(!/Совпало\s*0/i.test(statusText));
    assert.match(statusText, /Не удалось загрузить список|Ошибка/i);
    await page.click("#v3-focus-exit");
    await page.waitForFunction(() => !document.body.classList.contains("x14-focus-mode"));
    await page.close();
  });

  it("native numeric filter with oversized exponent blocks list API after prior rule", async () => {
    const page = await browser.newPage();
    await login(page);
    await openLktandoorList(page);
    await enterFocus(page);
    await applyCreditGteViaKeyboard(page, "1000");
    let listRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/clients/v3/list")) {
        listRequests += 1;
      }
    });
    const gte = page.locator(CREDIT_GTE);
    await gte.click();
    await gte.fill("1e100");
    await page.waitForTimeout(300);
    await page.waitForSelector('[data-testid="v3-focus-error"]', { state: "visible", timeout: 15000 });
    assert.equal(listRequests, 0, "invalid numeric filter must not call list API after native edit");
    const rules = await page.evaluate(() => {
      const rules = window.ClientsV3.readState().v3Rules || [];
      return rules.filter((r: { field: string; op: string }) => r.field === "creditLimit" && r.op === "gte");
    });
    assert.deepEqual(rules, [{ field: "creditLimit", op: "gte", value: "1000" }]);
    await page.close();
  });

  it("native number badInput keeps prior rule and skips list API", async () => {
    const page = await browser.newPage();
    await login(page);
    await openLktandoorList(page);
    await enterFocus(page);
    await applyCreditGteViaKeyboard(page, "1000");
    let listAfterRule = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/clients/v3/list")) {
        listAfterRule += 1;
      }
    });
    const gte = page.locator(CREDIT_GTE);
    await gte.click();
    await gte.press("ControlOrMeta+a");
    await gte.pressSequentially("1e", { delay: 40 });
    await page.waitForTimeout(300);
    const validity = await gte.evaluate((el) => ({
      badInput: (el as HTMLInputElement).validity.badInput,
      value: (el as HTMLInputElement).value,
    }));
    assert.equal(validity.badInput, true, "browser should mark incomplete scientific notation as badInput");
    assert.equal(listAfterRule, 0, "badInput must not trigger list reload");
    const rules = await page.evaluate(() => {
      const rules = window.ClientsV3.readState().v3Rules || [];
      return rules.filter((r: { field: string; op: string }) => r.field === "creditLimit" && r.op === "gte");
    });
    assert.deepEqual(rules, [{ field: "creditLimit", op: "gte", value: "1000" }]);
    await page.close();
  });

  it("loading state in focus mode is not shown as blocking alert error (native search)", async () => {
    const page = await browser.newPage();
    await login(page);
    await openLktandoorList(page);
    await enterFocus(page);
    await page.route("**/api/clients/v3/list?*", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    const pending = page.waitForResponse((res) => res.url().includes("/api/clients/v3/list"));
    await page.locator(FOCUS_SEARCH).fill("задержка");
    await page.waitForTimeout(100);
    const alertDuringLoad = await page.locator('[data-testid="v3-focus-error"][role=alert]').count();
    assert.equal(alertDuringLoad, 0, "loading must not render blocking error chrome");
    await pending;
    await page.waitForSelector('[data-testid="v3-focus-root"]', { state: "visible" });
    await page.close();
  });
});
