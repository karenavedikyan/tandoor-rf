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
const DIRECTOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LEGAL_ONE = "b2000000-0000-4000-8000-000000000001";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const SCREENSHOT_DIR = process.env.CLIENTS_V3_SCREENSHOT_DIR || "/opt/cursor/artifacts/screenshots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

describe("clients v3 role screens", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
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
    const userIds: Record<string, string> = {};
    const users = [
      { email: "role-manager@example.com", role: "manager" as const, emp: M1 },
      { email: "role-assistant@example.com", role: "assistant" as const, emp: M2 },
      { email: "role-regional@example.com", role: "regional_manager" as const, emp: REGIONAL },
      { email: "role-rop@example.com", role: "rop" as const, emp: ROP },
      { email: "role-director@example.com", role: "director" as const, emp: DIRECTOR },
      { email: "role-admin@example.com", role: "admin" as const, emp: null as string | null },
    ];
    for (const u of users) {
      const user = await createTestUser({
        databaseUrl,
        email: u.email,
        password: TEST_PASSWORD,
        fullName: u.role,
        role: u.role,
      });
      userIds[u.email] = user.id;
      if (u.emp) {
        await linkUserToEmployee({
          databaseUrl,
          userId: user.id,
          employeeId: u.emp,
          confirmedByUserId: admin.id,
        });
      }
    }
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const delegation = await pool.query<{ id: string }>(
      `
        INSERT INTO delegations (
          delegator_user_id, assistant_user_id, status, starts_at, ends_at, approved_by_user_id, approved_at
        )
        VALUES ($1::uuid, $2::uuid, 'active', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '30 days', $3::uuid, NOW())
        RETURNING id::text
      `,
      [userIds["role-manager@example.com"], userIds["role-assistant@example.com"], admin.id],
    );
    await pool.query(
      `INSERT INTO delegation_clients (delegation_id, guid_client) VALUES ($1::uuid, $2::uuid)`,
      [delegation.rows[0]!.id, LEGAL_ONE],
    );
    await pool.end();
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(REGIONAL, { name_manager: "Regional One" }),
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

  async function openClients(page: Page): Promise<void> {
    const list = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 60000 },
    );
    await page.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
    await list.catch(() => {
      /* teams home may not load list until responsible picked */
    });
  }

  async function capture(page: Page, slug: string, viewport: { width: number; height: number }): Promise<void> {
    await page.setViewportSize(viewport);
    const suffix = viewport.width <= 400 ? "mobile" : "desktop";
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `impl-v3-${slug}-${suffix}.png`),
      fullPage: true,
    });
  }

  it("manager: entry, scoped list, columns, mobile cards", async () => {
    const page = await browser.newPage();
    await login(page, "role-manager@example.com");
    await openClients(page);
    await page.waitForFunction(() => document.body.classList.contains("clients-role-manager"));
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("v3entity"), "legal");
    assert.equal(url.searchParams.get("view"), "all");
    await page.waitForSelector('#clients-table-body a:has-text("Legal One"), .clients-card a:has-text("Legal One")', {
      timeout: 30000,
    });
    await page.waitForSelector("th:has-text('Менеджер клиента')", { timeout: 15000 });
    await capture(page, "manager", DESKTOP);
    await capture(page, "manager", MOBILE);
    await page.locator(".clients-card__meta").first().waitFor({ state: "attached", timeout: 15000 });
    await page.close();
  });

  it("assistant: same portfolio entry as manager with scoped legal list", async () => {
    const page = await browser.newPage();
    await login(page, "role-assistant@example.com");
    await openClients(page);
    assert.equal(new URL(page.url()).searchParams.get("view"), "all");
    assert.equal(new URL(page.url()).searchParams.get("v3entity"), "legal");
    await page.waitForSelector('#clients-table-body a:has-text("Legal One"), .clients-card a:has-text("Legal One")', {
      timeout: 30000,
    });
    await capture(page, "assistant", DESKTOP);
    await page.close();
  });

  it("regional_manager: retail-first, regional columns, scoped retail rows", async () => {
    const page = await browser.newPage();
    await login(page, "role-regional@example.com");
    const list = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("entity=retail") && res.status() === 200,
    );
    await page.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
    await list;
    await page.waitForFunction(() => document.body.classList.contains("clients-role-regional"));
    assert.equal(new URL(page.url()).searchParams.get("v3entity"), "retail");
    await page.waitForSelector("th:has-text('Региональный ТТ')", { timeout: 15000 });
    await page.waitForSelector('#clients-table-body a:has-text("Store One"), .clients-card a:has-text("Store One")', {
      timeout: 30000,
    });
    await capture(page, "regional", DESKTOP);
    await capture(page, "regional", MOBILE);
    await page.close();
  });

  it("rop: teams shell, stats and team panel", async () => {
    const page = await browser.newPage();
    await login(page, "role-rop@example.com");
    await page.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.classList.contains("clients-role-rop"));
    assert.equal(new URL(page.url()).searchParams.get("view"), "teams");
    await page.waitForSelector("#view-switcher", { timeout: 15000 });
    await page.waitForSelector("#clients-stat-clients, .clients-stat__value", { timeout: 15000 });
    await capture(page, "rop", DESKTOP);
    await capture(page, "rop", MOBILE);
    await page.close();
  });

  it("director: teams overview and ROP cards", async () => {
    const page = await browser.newPage();
    await login(page, "role-director@example.com");
    await page.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.classList.contains("clients-role-director"));
    assert.equal(new URL(page.url()).searchParams.get("view"), "teams");
    await page.waitForSelector(".clients-team-card, .clients-compact-team-list", { timeout: 60000 });
    await capture(page, "director", DESKTOP);
    await capture(page, "director", MOBILE);
    await page.close();
  });

  it("admin: director layout, v3 entity switch, update panel", async () => {
    const page = await browser.newPage();
    await login(page, "role-admin@example.com");
    await page.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.classList.contains("clients-role-director"));
    assert.equal(new URL(page.url()).searchParams.get("view"), "teams");
    const list = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 60000 },
    );
    await page.locator('#view-switcher [data-view="all"]').click();
    await list;
    await page.waitForSelector('[data-v3entity="legal"]', { timeout: 15000 });
    await page.waitForSelector("#onec-update-panel", { timeout: 15000 });
    await capture(page, "admin", DESKTOP);
    await page.close();
  });
});
