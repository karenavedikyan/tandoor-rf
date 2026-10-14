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
const REGIONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIRECTOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

describe("clients v3 role entry screens", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const { createApp } = await import("../../src/server");
    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const addr = appServer!.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    await seedV3Once();
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

  async function seedV3Once(): Promise<void> {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, baseUrl);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "roles-seed-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Seed",
      role: "admin",
    });
    const users = [
      { email: "role-manager@example.com", role: "manager" as const, emp: M1 },
      { email: "role-regional@example.com", role: "regional_manager" as const, emp: REGIONAL },
      { email: "role-rop@example.com", role: "rop" as const, emp: ROP },
      { email: "role-director@example.com", role: "director" as const, emp: DIRECTOR },
    ];
    for (const u of users) {
      const user = await createTestUser({
        databaseUrl,
        email: u.email,
        password: TEST_PASSWORD,
        fullName: u.role,
        role: u.role,
      });
      await linkUserToEmployee({
        databaseUrl,
        userId: user.id,
        employeeId: u.emp,
        confirmedByUserId: admin.id,
      });
    }
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
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
  }

  async function login(page: Page, email: string): Promise<void> {
    await page.goto(baseUrl + "/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work)/);
  }

  async function openClientsMenu(page: Page): Promise<void> {
    await page.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
  }

  it("manager entry: portfolio chrome and legal list default", async () => {
    const page = await browser.newPage();
    await login(page, "role-manager@example.com");
    await openClientsMenu(page);
    await page.waitForFunction(function () {
      return document.body.classList.contains("clients-role-manager");
    });
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("v3mode"), "1");
    assert.equal(url.searchParams.get("view"), "all");
    assert.equal(url.searchParams.get("v3entity"), "legal");
    await page.close();
  });

  it("regional entry: retail-first layout", async () => {
    const page = await browser.newPage();
    await login(page, "role-regional@example.com");
    await openClientsMenu(page);
    await page.waitForFunction(function () {
      return document.body.classList.contains("clients-role-regional");
    });
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("v3entity"), "retail");
    assert.equal(url.searchParams.get("entity"), "outlets");
    await page.close();
  });

  it("rop entry: teams default", async () => {
    const page = await browser.newPage();
    await login(page, "role-rop@example.com");
    await openClientsMenu(page);
    await page.waitForFunction(function () {
      return document.body.classList.contains("clients-role-rop");
    });
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("view"), "teams");
    assert.equal(url.searchParams.get("v3view"), "teams");
    await page.close();
  });

  it("director entry: teams overview layout", async () => {
    const page = await browser.newPage();
    await login(page, "role-director@example.com");
    await openClientsMenu(page);
    await page.waitForFunction(function () {
      return document.body.classList.contains("clients-role-director");
    });
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("view"), "teams");
    await page.close();
  });
});
