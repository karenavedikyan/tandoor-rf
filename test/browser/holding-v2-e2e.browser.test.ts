import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Pool } from "pg";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { setHoldingV2PipelineEnabledForTests } from "../../src/onec-clients/holding-v2-pipeline-config";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { insertSuccessfulImportRun } from "../helpers/clients-db-fixtures";
import {
  buildHoldingV2FileBytes,
  headRow,
  minimalOutlet,
  typeCategory,
} from "../helpers/holding-v2-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const ORIGIN = "http://127.0.0.1:3000";
const ADMIN_EMAIL = "admin-holding-v2@example.com";

const H1 = "a1000000-0000-4000-8000-000000000001";
const S1 = "b1000000-0000-4000-8000-000000000001";
const S2 = "b1000000-0000-4000-8000-000000000002";
const MANAGER = "22222222-2222-4222-8222-222222222222";

const CLIENT_NAME = "V2 Browser Client";
const F5_CODE = "HV2-E2E-F5";
const COMPOSITION_LABEL = "Холдинг моно";
const TYPE_NAME = "E2E Holding Type";
const STORE_ONE_LABEL = "E2E Store Alpha";
const STORE_TWO_LABEL = "E2E Store Beta";

const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media";

function isPrimaryClientsListGet(url: URL, method: string): boolean {
  return method === "GET" && url.pathname === "/api/clients";
}

describe("holding v2 browser E2E (real API + PostgreSQL)", { concurrency: false }, () => {
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
    setHoldingV2PipelineEnabledForTests(undefined);
    await browser?.close();
    await closePool();
  });

  async function seedDatabase(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    setHoldingV2PipelineEnabledForTests(true);

    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        name_client: CLIENT_NAME,
        Код: F5_CODE,
        type_category: typeCategory({ guid_type: "e2e-hv2-type", name_type: TYPE_NAME }),
        retail_outlets: [
          minimalOutlet(S1, {
            address: { store_address: STORE_ONE_LABEL },
            type_category: typeCategory({
              guid_type: "e2e-out-type-a",
              name_type: "E2E Outlet Type A",
              guid_category: "e2e-out-cat-a",
              name_category: "E2E Outlet Category A",
            }),
          }),
          minimalOutlet(S2, {
            address: { store_address: STORE_TWO_LABEL },
            type_category: typeCategory({
              guid_type: "e2e-out-type-b",
              name_type: "E2E Outlet Type B",
              guid_category: "e2e-out-cat-b",
              name_category: "E2E Outlet Category B",
            }),
          }),
        ],
      }),
    ]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const fp = verificationFingerprintFromPayload({ payload: validated.payload });
    const applied = await applyClientsImport({
      databaseUrl,
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(applied.ok, true, applied.ok ? "" : JSON.stringify(applied));
    if (!applied.ok) return;
    assert.equal(applied.holdingV2Reconcile?.code, "SUCCESS");

    await createTestUser({
      databaseUrl,
      email: ADMIN_EMAIL,
      password: TEST_PASSWORD,
      fullName: "Admin Holding V2",
      role: "admin",
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
      [MANAGER, "SYNTH Manager"],
    );
    await pool.end();

    await insertSuccessfulImportRun(databaseUrl, { recordCount: 1 });
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

  async function login(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 20000 });
  }

  async function newSession(viewport: typeof DESKTOP | typeof MOBILE): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport, baseURL: baseUrl });
    const page = await context.newPage();
    return { context, page };
  }

  async function waitForClientsList(page: Page): Promise<void> {
    await page.waitForSelector("#clients-app:not(.clients-hidden)", { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) {
          return false;
        }
        return (
          document.querySelectorAll(".clients-card").length > 0 ||
          document.querySelectorAll("#clients-table-body tr").length > 0
        );
      },
      undefined,
      { timeout: 30000 },
    );
  }

  async function enableHoldingV2CompositionColumn(page: Page): Promise<void> {
    await page.click("#columns-picker-btn");
    await page.waitForSelector("#columns-picker:not(.clients-hidden)");
    const checkbox = page.locator('input[data-column-id="holdingV2CompositionLabel"]');
    if (!(await checkbox.isChecked())) {
      const listResponsePromise = page.waitForResponse((response) => {
        const request = response.request();
        return isPrimaryClientsListGet(new URL(response.url()), request.method()) && response.status() === 200;
      });
      await checkbox.check();
      await listResponsePromise;
    }
    await page.click("#columns-picker-btn");
  }

  async function assertListShowsHoldingV2(page: Page, viewport: { width: number }): Promise<void> {
    if (viewport.width >= 768) {
      const cell = page.locator("#clients-table-body td").filter({ hasText: COMPOSITION_LABEL }).first();
      await cell.waitFor({ state: "visible", timeout: 15000 });
      assert.match(await cell.innerText(), new RegExp(COMPOSITION_LABEL));
      return;
    }
    const cardLine = page.locator(".clients-card__line").filter({ hasText: COMPOSITION_LABEL }).first();
    await cardLine.waitFor({ state: "attached", timeout: 15000 });
    assert.match(await cardLine.innerText(), new RegExp(COMPOSITION_LABEL));
  }

  async function openClientCardDataPanel(page: Page, viewport?: { width: number }): Promise<void> {
    const cardApi = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes(`/api/clients/${H1}`) &&
        !response.url().includes("/catalog/") &&
        response.status() === 200,
      { timeout: 60000 },
    );
    if (viewport && viewport.width < 768) {
      await page.getByRole("link", { name: CLIENT_NAME }).first().click({ timeout: 30000 });
    } else {
      await page.locator(`.clients-link[href*="/clients/${H1}"]`).first().click({ timeout: 30000 });
    }
    const cardResponse = await cardApi;
    const cardBody = (await cardResponse.json()) as {
      client?: { holdingV2?: { compositionDetail?: { legalEntities?: unknown[]; outlets?: unknown[] } } };
    };
    assert.ok(
      cardBody.client?.holdingV2?.compositionDetail?.legalEntities?.length,
      "API must expose scoped holding v2 composition before UI checks",
    );
    assert.equal(cardBody.client?.holdingV2?.compositionDetail?.outlets?.length, 2);
    await page.waitForURL(new RegExp("/clients/" + H1.replace(/-/g, "\\-")), { timeout: 20000 });
    await page.waitForSelector("#client-detail:not(.clients-hidden)", { timeout: 20000 });
    await page.click("#pc-tab-data");
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    const details = page
      .locator("#pc-panel-data details.pc-details")
      .filter({ has: page.locator("summary", { hasText: "Основные сведения и холдинг" }) });
    if ((await details.getAttribute("open")) === null) {
      await details.locator("summary").click();
    }
  }

  async function assertClientCardHoldingV2(page: Page): Promise<void> {
    const panelText = await page.locator("#pc-panel-data").innerText();
    assert.match(panelText, /Тип 1С \(v2, клиент\)/);
    assert.match(panelText, new RegExp(TYPE_NAME));
    assert.match(panelText, new RegExp(COMPOSITION_LABEL));
    assert.match(panelText, /Состав холдинга \(v2\)/);
    assert.match(panelText, /Юрлица/);
    assert.match(panelText, /Торговые точки/);
    assert.match(panelText, new RegExp(CLIENT_NAME));
    assert.match(panelText, new RegExp(STORE_ONE_LABEL));
    assert.match(panelText, new RegExp(STORE_TWO_LABEL));
  }

  async function assertCompositionNavigation(page: Page): Promise<void> {
    await page.waitForSelector(".pc-hv2-legal", { timeout: 15000 });
    await page.waitForSelector(".pc-hv2-legal a.clients-link", { timeout: 15000 });
    const legalHref = await page.locator(".pc-hv2-legal a.clients-link").first().getAttribute("href");
    assert.ok(legalHref && legalHref.includes(H1));
    assert.equal(await page.locator(".pc-hv2-outlet a.clients-link").count(), 2);

    const secondOutletLink = page.locator(".pc-hv2-outlet a.clients-link", { hasText: STORE_TWO_LABEL });
    await secondOutletLink.click();
    await page.waitForURL(
      (url) =>
        url.pathname === `/clients/${H1}` && url.searchParams.get("store") === S2,
      { timeout: 20000 },
    );
    await page.waitForSelector('.pc-outlet-card[data-outlet-guid="' + S2 + '"].pc-outlet-card--selected', {
      timeout: 15000,
    });
    assert.match(await page.locator("#pc-panel-data").innerText(), new RegExp(STORE_TWO_LABEL));

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(
      (url) => url.searchParams.get("store") === S2,
      { timeout: 20000 },
    );
    await page.waitForSelector("#client-detail:not(.clients-hidden)", { timeout: 20000 });
    await page.click("#pc-tab-data");
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    await page.waitForSelector('.pc-outlet-card[data-outlet-guid="' + S2 + '"].pc-outlet-card--selected', {
      timeout: 15000,
    });

    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForURL(
      (url) => url.pathname === `/clients/${H1}` && !url.searchParams.get("store"),
      { timeout: 20000 },
    );
    await page.waitForSelector("#client-detail:not(.clients-hidden)", { timeout: 20000 });
    await page.click("#pc-tab-data");
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    const details = page
      .locator("#pc-panel-data details.pc-details")
      .filter({ has: page.locator("summary", { hasText: "Основные сведения и холдинг" }) });
    if ((await details.getAttribute("open")) === null) {
      await details.locator("summary").click();
    }
    await page.locator(".pc-hv2-outlet a.clients-link").first().waitFor({ state: "visible", timeout: 15000 });
    assert.match(await page.locator("#pc-panel-data").innerText(), /Торговые точки/);
  }

  it("admin sees holding v2 on list and client card (desktop + mobile)", async () => {
    await seedDatabase();
    await resetPoolForTests();
    setHoldingV2PipelineEnabledForTests(true);
    await startServer();

    {
      const { context, page } = await newSession(DESKTOP);
      await login(page, ADMIN_EMAIL);

      const listPromise = page.waitForResponse(
        (response) =>
          isPrimaryClientsListGet(new URL(response.url()), response.request().method()) &&
          response.status() === 200,
      );
      await page.goto("/clients?view=all&entity=clients", { waitUntil: "domcontentloaded" });
      await listPromise;
      await waitForClientsList(page);
      await enableHoldingV2CompositionColumn(page);
      await assertListShowsHoldingV2(page, DESKTOP);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "holding-v2-list-desktop.png"),
        fullPage: true,
      });

      await openClientCardDataPanel(page, DESKTOP);
      await assertClientCardHoldingV2(page);
      await assertCompositionNavigation(page);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "holding-v2-card-desktop.png"),
        fullPage: true,
      });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "holding-v2-composition-desktop.png"),
        fullPage: true,
      });

      await context.close();
    }

    {
      const { context, page } = await newSession(MOBILE);
      await login(page, ADMIN_EMAIL);

      const listPromise = page.waitForResponse(
        (response) =>
          isPrimaryClientsListGet(new URL(response.url()), response.request().method()) &&
          response.status() === 200,
      );
      await page.goto("/clients?view=all&entity=clients", { waitUntil: "domcontentloaded" });
      await listPromise;
      await waitForClientsList(page);
      await enableHoldingV2CompositionColumn(page);
      await assertListShowsHoldingV2(page, MOBILE);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "holding-v2-list-mobile.png"),
        fullPage: true,
      });

      await openClientCardDataPanel(page, MOBILE);
      await assertClientCardHoldingV2(page);
      await assertCompositionNavigation(page);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "holding-v2-card-mobile.png"),
        fullPage: true,
      });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "holding-v2-composition-mobile.png"),
        fullPage: true,
      });

      await context.close();
    }

    await stopServer();
  });
});
