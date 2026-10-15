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
const ROP = "55555555-5555-4555-8555-555555555555";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const SCREENSHOT_DIR =
  process.env.CLIENTS_LKTANDOOR_STAGE3_DIR ??
  "/cursor/stores/self/media/clients-lktandoor-stage3-teams";

async function seed(databaseUrl: string) {
  const admin = await createTestUser({
    databaseUrl,
    email: "admin-stage3-teams@example.com",
    password: TEST_PASSWORD,
    fullName: "Admin Stage3",
    role: "admin",
  });
  const manager = await createTestUser({
    databaseUrl,
    email: "manager-stage3-teams@example.com",
    password: TEST_PASSWORD,
    fullName: "Manager Stage3",
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
    buildEmployeeRosterEntry(ROP, { name_manager: "ROP One", post: "Руководитель отдела продаж" }),
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
}

describe("lktandoor stage3 teams navigation", { concurrency: false }, () => {
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

  async function login(page: Page, email: string) {
    await page.goto(baseUrl + "/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile", { timeout: 30000 });
  }

  it("director: ROP expand, employee territory, back preserves teams context", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "admin-stage3-teams@example.com");
    await page.goto(baseUrl + "/clients?v3mode=1&v3view=teams&view=teams");
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await page.waitForSelector(".clients-compact-team", { timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "teams-director-desktop-1440.png") });

    const ropToggle = page.locator("[data-toggle-rop]").first();
    await ropToggle.click();
    await page.waitForSelector(".clients-compact-team__member-main", { timeout: 15000 });
    const memberOpen = page.locator(".clients-compact-team__member-main").first();
    const listWait = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await memberOpen.click();
    await listWait;
    await page.waitForFunction(
      () => document.querySelector("#clients-table-body")?.getAttribute("aria-busy") !== "true",
      undefined,
      { timeout: 30000 },
    );
    assert.ok(page.url().includes("responsibleGuid="));
    assert.ok(page.url().includes("ropEmployee="));
    assert.ok(page.url().includes("v3view=teams"));

    await page.locator('[data-testid="v3-lktandoor-back"]').click();
    await page.waitForSelector(".clients-compact-team__member-main", { timeout: 15000 });
    assert.ok(!page.url().includes("responsibleGuid="));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForSelector(".clients-compact-team", { timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "teams-director-mobile-390.png") });
    await page.close();
  });
});
