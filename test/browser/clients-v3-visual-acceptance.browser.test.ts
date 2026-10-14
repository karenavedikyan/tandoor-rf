/**
 * Visual acceptance captures for PR #77 (isolated seed, role logins).
 * Output: CLIENTS_V3_SCREENSHOT_DIR or store media path.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const SHA = "7687a2d";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const ROP = "55555555-5555-4555-8555-555555555555";
const REGIONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIRECTOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LEGAL_ONE = "b2000000-0000-4000-8000-000000000001";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const OUT =
  process.env.CLIENTS_V3_VISUAL_DIR ||
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/clients-v3-visual-review/captures-7687a2d";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

describe("clients v3 visual acceptance captures", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await prepareDatabase(databaseUrl);
    const { createApp } = await import("../../src/server");
    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const addr = appServer!.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
    await seed(databaseUrl);
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

  async function seed(databaseUrl: string): Promise<void> {
    const admin = await createTestUser({
      databaseUrl,
      email: "vis-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Vis",
      role: "admin",
    });
    const users = [
      { email: "vis-manager@example.com", role: "manager" as const, emp: M1 },
      { email: "vis-assistant@example.com", role: "assistant" as const, emp: M2 },
      { email: "vis-regional@example.com", role: "regional_manager" as const, emp: REGIONAL },
      { email: "vis-rop@example.com", role: "rop" as const, emp: ROP },
      { email: "vis-director@example.com", role: "director" as const, emp: DIRECTOR },
    ];
    const userIds: Record<string, string> = {};
    userIds["vis-admin@example.com"] = admin.id;
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
      `INSERT INTO delegations (delegator_user_id, assistant_user_id, status, starts_at, ends_at, approved_by_user_id, approved_at)
       VALUES ($1::uuid, $2::uuid, 'active', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '30 days', $3::uuid, NOW()) RETURNING id::text`,
      [userIds["vis-manager@example.com"], userIds["vis-assistant@example.com"], admin.id],
    );
    await pool.query(`INSERT INTO delegation_clients (delegation_id, guid_client) VALUES ($1::uuid, $2::uuid)`, [
      delegation.rows[0]!.id,
      LEGAL_ONE,
    ]);
    await pool.end();
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(REGIONAL, { name_manager: "Regional One" }),
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

  async function login(page: Page, email: string): Promise<void> {
    await page.goto(baseUrl + "/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work)/);
  }

  async function shot(page: Page, slug: string, viewport: { width: number; height: number }, theme?: "dark"): Promise<void> {
    await page.setViewportSize(viewport);
    if (theme === "dark") {
      await page.evaluate(function () {
        document.documentElement.setAttribute("data-theme", "dark");
        try {
          localStorage.setItem("tandoor-rf-theme", "dark");
        } catch (_e) {
          /* ignore */
        }
      });
    }
    await page.waitForTimeout(300);
    const themeSuffix = theme === "dark" ? "-dark" : "";
    const vp = viewport.width <= 400 ? "mobile" : "desktop";
    await page.screenshot({
      path: path.join(OUT, `${SHA}-${slug}-${vp}${themeSuffix}.png`),
      fullPage: true,
    });
  }

  const roles: Array<{ slug: string; email: string; path: string }> = [
    { slug: "manager", email: "vis-manager@example.com", path: "/clients" },
    { slug: "assistant", email: "vis-assistant@example.com", path: "/clients" },
    { slug: "regional", email: "vis-regional@example.com", path: "/clients" },
    { slug: "rop", email: "vis-rop@example.com", path: "/clients" },
    { slug: "director", email: "vis-director@example.com", path: "/clients" },
    { slug: "admin", email: "vis-admin@example.com", path: "/clients" },
  ];

  for (const role of roles) {
    it(`capture ${role.slug} entry desktop/mobile`, async () => {
      const page = await browser.newPage();
      await login(page, role.email);
      await page.goto(baseUrl + role.path, { waitUntil: "networkidle" });
      await page.waitForSelector("#clients-app:not(.clients-hidden)", { timeout: 60000 });
      await shot(page, `${role.slug}-entry`, DESKTOP);
      await shot(page, `${role.slug}-entry`, MOBILE);
      await shot(page, `${role.slug}-entry`, DESKTOP, "dark");
      await page.close();
    });
  }

  it("capture manager filters chips and card return", async () => {
    const page = await browser.newPage();
    await login(page, "vis-manager@example.com");
    const list = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("typeGuid=t1") &&
        res.status() === 200,
    );
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal&view=all&v3type=t1", { waitUntil: "networkidle" });
    await list;
    await page.waitForSelector(".clients-v3-filter-chip", { timeout: 20000 });
    await shot(page, "manager-filters-chips", DESKTOP);
    await page.locator('#clients-table-body a:has-text("Legal One")').first().click();
    await page.waitForSelector('[data-testid="v3-detail-title"]');
    await shot(page, "manager-card-detail", DESKTOP);
    await page.click('[data-testid="v3-back-to-list"]');
    await page.waitForURL(/\/clients\?.*v3mode=1/);
    await page.waitForSelector(".clients-v3-filter-chip", { timeout: 15000 });
    await shot(page, "manager-return-list", DESKTOP);
    await page.close();
  });

  it("capture rop team base tab and director teams", async () => {
    const ropPage = await browser.newPage();
    await login(ropPage, "vis-rop@example.com");
    await ropPage.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
    await ropPage.locator('#view-switcher [data-view="all"]').click();
    await ropPage.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 60000 },
    );
    await shot(ropPage, "rop-team-base-list", DESKTOP);
    await ropPage.close();

    const dirPage = await browser.newPage();
    await login(dirPage, "vis-director@example.com");
    await dirPage.goto(baseUrl + "/clients", { waitUntil: "networkidle" });
    await dirPage.waitForSelector(".clients-team-card, .clients-compact-team-list", { timeout: 60000 });
    await shot(dirPage, "director-teams-overview", DESKTOP);
    await dirPage.close();
  });
});
