import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  ORG_DIRECTOR_EMPLOYEE_GUID,
  ROSTER_ASSISTANT_MEMBER_POST_LABEL,
} from "../../src/clients/org/constants";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const ORIGIN = "http://127.0.0.1:3000";
const ROA_HEAD = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const ASSISTANT_ONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const ASSISTANT_NO_ACCOUNT = "ffffffff-ffff-4fff-8fff-ffffffff0003";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ?? path.join("/opt/cursor/artifacts/screenshots");

describe("clients assistants department browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seed(): Promise<void> {
    process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID = ROA_HEAD;
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const directorUser = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: directorUser.id,
      employeeId: ORG_DIRECTOR_EMPLOYEE_GUID,
      confirmedByUserId: admin.id,
    });
    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop-a@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP A User",
      role: "rop",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropUser.id,
      employeeId: ROP_A,
      confirmedByUserId: admin.id,
    });
    const roaUser = await createTestUser({
      databaseUrl,
      email: "roa@example.com",
      password: TEST_PASSWORD,
      fullName: "ROA User",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: roaUser.id,
      employeeId: ROA_HEAD,
      confirmedByUserId: admin.id,
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
       VALUES (1, $1, 4) ON CONFLICT (id) DO UPDATE SET employee_count = 4`,
      ["b".repeat(64)],
    );
    for (const [guid, name, post] of [
      [ROP_A, "ROP Alpha", "Руководитель отдела продаж"],
      [ROA_HEAD, "ROA Head", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
      [ASSISTANT_ONE, "Assistant One", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
      [ASSISTANT_NO_ACCOUNT, "Assistant No Account", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
    ] as const) {
      await pool.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, $2, $3, '{}'::jsonb)
         ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post`,
        [guid, name, post],
      );
    }
    await pool.end();
  }

  async function startServer(): Promise<void> {
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  async function login(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  it("director sees assistants block, dept filter, dual-role ROA and search", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "director@example.com");
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });

    const assistantsBlock = page.locator(".clients-compact-team--assistants");
    await assistantsBlock.waitFor({ state: "visible" });
    assert.match(await assistantsBlock.locator(".clients-compact-team__role-caption").innerText(), /РОА/);
    assert.match(await assistantsBlock.locator(".clients-compact-team__metric-value").first().innerText(), /3/);
    assert.equal(
      await assistantsBlock.locator(".clients-compact-team__badge", { hasText: "Также ассистент" }).count(),
      1,
    );
    assert.equal(await assistantsBlock.locator(".clients-compact-team__metric--link").count(), 0);

    await assistantsBlock.locator("[data-toggle-assistants]").first().click();
    await page.waitForFunction(() =>
      new URL(window.location.href).searchParams.getAll("teamExpand").includes("__assistants_dept__"),
    );
    const roaRow = assistantsBlock.locator(".clients-compact-team__member", { hasText: "ROA Head" });
    assert.equal(await roaRow.locator(".clients-compact-team__kind-tag", { hasText: "РОА" }).count(), 1);
    assert.equal(await roaRow.locator(".clients-compact-team__kind-tag", { hasText: "Ассистент" }).count(), 1);
    assert.equal(
      await assistantsBlock
        .locator(".clients-compact-team__member", { hasText: "Assistant No Account" })
        .locator(".clients-compact-team__badge", { hasText: "Нет аккаунта ЛК" })
        .count(),
      1,
    );

    await page.selectOption("#clients-team-dept-filter", "sales");
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("teamDept") === "sales",
    );
    assert.equal(await page.locator(".clients-compact-team--assistants").count(), 0);
    assert.ok(await page.locator(".clients-compact-team__name", { hasText: "ROP Alpha" }).count());

    await page.selectOption("#clients-team-dept-filter", "assistants");
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("teamDept") === "assistants",
    );
    assert.equal(await page.locator("#clients-team-kind-filter").count(), 0);
    assert.equal(await page.locator(".clients-compact-team--assistants").count(), 1);
    assert.equal(await page.locator(".clients-compact-team__name", { hasText: "ROP Alpha" }).count(), 0);

    await page.fill("#clients-team-search-input", "Assistant One");
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("teamQ") === "Assistant One",
    );
    await assistantsBlock
      .locator(".clients-compact-team__member-name", { hasText: "Assistant One" })
      .waitFor({ state: "visible", timeout: 15000 });
    assert.equal(
      await assistantsBlock.locator(".clients-compact-team__member-name", { hasText: "Assistant One" }).count(),
      1,
    );

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-assistants-dept-desktop.png"),
      fullPage: false,
    });

    await page.close();
    await stopServer();
  });

  it("mobile layout has no horizontal overflow for assistants block", async () => {
    await seed();
    await startServer();
    const page = await browser.newPage({ viewport: MOBILE, baseURL: baseUrl });
    await login(page, "admin@example.com");
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
    await page.waitForSelector(".clients-compact-team--assistants");

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 1;
    });
    assert.equal(overflow, false);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-assistants-dept-mobile.png"),
      fullPage: false,
    });

    await page.close();
    await stopServer();
  });

  it("shows roster-missing note instead of zero employees when roster empty", async () => {
    delete process.env.TANDOOR_ORG_ASSISTANTS_HEAD_IN_TEAM;
    process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID = ROA_HEAD;
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });

    await startServer();
    const page = await browser.newPage({ viewport: DESKTOP, baseURL: baseUrl });
    await login(page, "admin@example.com");
    await page.goto("/clients?view=teams", { waitUntil: "networkidle" });

    const assistantsBlock = page.locator(".clients-compact-team--assistants");
    await assistantsBlock.waitFor({ state: "visible" });
    assert.match(await assistantsBlock.locator(".clients-compact-team__metric-value").first().innerText(), /—/);
    assert.match(
      await page.locator(".clients-compact-team__assistants-note--warn").innerText(),
      /Справочник ОПТ не загружен/,
    );

    await page.close();
    await stopServer();
  });
});
