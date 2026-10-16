import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ORG_DIRECTOR_EMPLOYEE_GUID, ROSTER_ROP_POST_LABEL } from "../../src/clients/org/constants";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const ROP = "55555555-5555-4555-8555-555555555555";
const DIRECTOR_NAME = "Browser Director Fixture";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

describe("v3 teams director smoke", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin-v3-director-ui@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Director UI",
      role: "admin",
    });
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(ORG_DIRECTOR_EMPLOYEE_GUID, {
        name_manager: DIRECTOR_NAME,
        post: ROSTER_ROP_POST_LABEL,
      }),
      buildEmployeeRosterEntry(ROP, { name_manager: "ROP Browser Fixture", post: ROSTER_ROP_POST_LABEL }),
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

  async function login(page: Page) {
    await page.goto(`${baseUrl}/login`);
    await page.fill('input[name="email"]', "admin-v3-director-ui@example.com");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/clients" || url.pathname === "/profile", {
      timeout: 30000,
    });
  }

  it("shows director label and keeps director out of ROP person rows", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);
    const orgResponse = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/org-structure") && res.status() === 200,
      { timeout: 30000 },
    );
    await page.goto(`${baseUrl}/clients?view=teams&v3mode=1&v3entity=legal_grouped&v3view=teams`);
    await orgResponse;
    await page.waitForSelector(".clients-x13-director");
    assert.match(await page.locator(".clients-x13-director").innerText(), /директор/i);
    assert.match(await page.locator(".clients-x13-director").innerText(), new RegExp(DIRECTOR_NAME));
    assert.equal(
      await page.locator('[data-open-rop-team="' + ORG_DIRECTOR_EMPLOYEE_GUID + '"]').count(),
      0,
    );
    await page.locator('[data-open-rop-team="' + ROP + '"]').click();
    await page.waitForResponse(
      (res) => res.url().includes("/responsibles") && res.status() === 200,
      { timeout: 30000 },
    );
    await page.waitForSelector('.x13-person[data-manager="' + M1 + '"]', { timeout: 30000 });
    await page.close();
  });
});
