import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertSyntheticRetailOutlets,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const ORIGIN = "http://127.0.0.1:3000";
const MOBILE = { width: 390, height: 844 };

const DIRECTOR_EMP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const MANAGER_OK = "11111111-1111-4111-8111-111111111111";
const CLIENT_FILLED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STORE_MISSING = "88888888-8888-4888-8888-888888888801";
const STORE_OK = "88888888-8888-4888-8888-888888888802";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

function extendedSnapshot() {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
    currentRetailOutlets: [
      {
        ordinal: 0,
        guidStore: STORE_MISSING,
        holdingName: "TT",
        warehouse: false,
        address: { storeAddress: "Store Missing Assignments", deliveryAddress: "", routeDirection: "" },
        loading: {},
        managers: {
          manager: { guid: "", name: "", state: "unassigned" },
          regionalManager: { guid: null, name: "", state: "not_provided" },
          hardwareManager: { guid: null, name: "", state: "not_provided" },
          headOfSales: { guid: "", name: "", state: "unassigned" },
        },
        contacts: {},
        lpr: {},
        additional: {},
        outletGuidStatus: "confirmed",
        closed: false,
        closureStatus: "open",
        closureConfirmedInCurrentExport: true,
        closureHistory: [],
        provenance: {
          freshness: "current",
          sourceSha256: "a".repeat(64),
          importedAt: new Date().toISOString(),
        },
        distributionAllowed: false,
      },
      {
        ordinal: 1,
        guidStore: STORE_OK,
        holdingName: "TT",
        warehouse: false,
        address: { storeAddress: "Store OK", deliveryAddress: "", routeDirection: "" },
        loading: {},
        managers: {
          manager: { guid: MANAGER_OK, name: "Manager OK", state: "directory_unverified" },
          regionalManager: { guid: null, name: "", state: "not_provided" },
          hardwareManager: { guid: null, name: "", state: "not_provided" },
          headOfSales: { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
        },
        contacts: {},
        lpr: {},
        additional: {},
        outletGuidStatus: "confirmed",
        closed: false,
        closureStatus: "open",
        closureConfirmedInCurrentExport: true,
        closureHistory: [],
        provenance: {
          freshness: "current",
          sourceSha256: "a".repeat(64),
          importedAt: new Date().toISOString(),
        },
        distributionAllowed: false,
      },
    ],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients completeness queue mobile (real PostgreSQL)", { concurrency: false }, () => {
  let browser: Browser;
  let databaseUrl = "";
  let baseUrl = "";
  let server: http.Server;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seedDatabase(): Promise<void> {
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
      employeeId: DIRECTOR_EMP,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 1)
        ON CONFLICT (id) DO UPDATE SET employee_count = 1
      `,
      ["b".repeat(64)],
    );
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
        VALUES ($1::uuid, $2, 'Менеджер', '{}'::jsonb)
        ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
      `,
      [ROP_A, "ROP Alpha"],
    );
    await pool.end();

    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_FILLED,
        name_client: "Client Filled",
        guid_manager: MANAGER_OK,
        name_manager: "Manager OK",
      },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, CLIENT_FILLED, extendedSnapshot());
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: STORE_MISSING, guid_client: CLIENT_FILLED },
      { guid_store: STORE_OK, guid_client: CLIENT_FILLED },
    ]);
  }

  async function startServer(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl);
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async function login(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", "director@example.com");
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  async function waitForVisibleCards(page: Page): Promise<void> {
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) {
          return false;
        }
        return document.querySelectorAll(".clients-card").length > 0;
      },
      undefined,
      { timeout: 30000 },
    );
    const card = page.locator(".clients-card").first();
    await card.waitFor({ state: "visible" });
    assert.equal(await card.isVisible(), true);
  }

  it("director mobile: completeness queue outlets, reason filter, card, back and reload", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    const context = await browser.newContext({ viewport: MOBILE, baseURL: baseUrl });
    const page = await context.newPage();
    await login(page);

    const clientsQueueResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients/completeness-queue") && response.status() === 200,
    );
    await page.goto("/clients?view=completeness", { waitUntil: "networkidle" });
    await clientsQueueResponse;
    await waitForVisibleCards(page);
    const clientsCards = await page.locator("#clients-cards").innerText();
    assert.ok(clientsCards.length > 0);

    const outletsQueueResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients/completeness-queue") &&
        response.url().includes("entity=outlets") &&
        response.status() === 200,
    );
    await page.click('[data-entity="outlets"]');
    await outletsQueueResponse;
    await waitForVisibleCards(page);
    const outletsText = await page.locator("#clients-cards").innerText();
    assert.match(outletsText, /Store Missing Assignments/i);
    const outletCardTitles = await page.locator(".clients-card__title a.clients-link").allTextContents();
    assert.ok(outletCardTitles.some((title) => /Store Missing Assignments/i.test(title)));
    assert.ok(!outletCardTitles.some((title) => title.trim() === "Client Filled"));

    const filteredQueueResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients/completeness-queue") &&
        response.url().includes("completenessReason=missing_rop"),
    );
    await page.selectOption("#completeness-reason-filter", ["missing_rop"]);
    await page.dispatchEvent("#completeness-reason-filter", "change");
    await filteredQueueResponse;
    await waitForVisibleCards(page);
    const filteredText = await page.locator("#clients-cards").innerText();
    assert.match(filteredText, /Не указан РОП/i);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "completeness-queue-mobile-visible-cards.png"),
      fullPage: true,
    });

    const cardHref = `/clients/${CLIENT_FILLED}?store=${STORE_MISSING}`;
    await page.locator(`.clients-card a.clients-link[href="${cardHref}"]`).click();
    await page.waitForURL(`**${cardHref}`);
    await page.waitForSelector("#client-detail-root");

    await page.goBack({ waitUntil: "networkidle" });
    await waitForVisibleCards(page);
    assert.match(page.url(), /view=completeness/);
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), /completenessReason=missing_rop/);

    await page.reload({ waitUntil: "networkidle" });
    await waitForVisibleCards(page);
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), /completenessReason=missing_rop/);
    const reloadedText = await page.locator("#clients-cards").innerText();
    assert.match(reloadedText, /Store Missing Assignments/i);

    await context.close();
    await stopServer();
  });
});
