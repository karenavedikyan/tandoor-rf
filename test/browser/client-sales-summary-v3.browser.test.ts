import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const LEGAL_A = "11111111-1111-4111-8111-111111111101";
const LEGAL_B = "22222222-2222-4222-8222-222222222222";
const HOLDING = "33333333-3333-4333-8333-333333333333";
const SCREENSHOT_DIR =
  process.env.CLIENT_SALES_SUMMARY_BROWSER_DIR ??
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/client-sales-summary-v3";

describe("client sales summary v3 UI", { concurrency: false }, () => {
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

  async function seed(databaseUrl: string) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    await createTestUser({
      databaseUrl,
      email: "admin-sales-ui@example.test",
      password: TEST_PASSWORD,
      fullName: "Admin Sales UI",
      role: "admin",
    });
    await pool.query(
      `UPDATE onec_v3_exchange_state SET last_bundle_fingerprint = $1, updated_at = NOW() WHERE id = 1`,
      ["b".repeat(64)],
    );
    await pool.query(
      `
        INSERT INTO onec_v3_holdings (guid_holding, name_holding, type_category, managers, last_source_sha256)
        VALUES ($1::uuid, 'H Sales', '{}'::jsonb, '{}'::jsonb, 't')
        ON CONFLICT DO NOTHING
      `,
      [HOLDING],
    );
    await pool.query(
      `
        INSERT INTO onec_v3_legal_entities (guid_client, name_client, inn, guid_holding, type_category, managers, other_fields, last_source_sha256)
        VALUES
          ($1::uuid, 'Legal A Sales', '7700000001', $3::uuid, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 't'),
          ($2::uuid, 'Legal B Sales', '7700000002', $3::uuid, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 't')
        ON CONFLICT DO NOTHING
      `,
      [LEGAL_A, LEGAL_B, HOLDING],
    );
    await pool.query(
      `
        INSERT INTO onec_v3_legal_sales_import_state (id, source_sha256, row_count, imported_at)
        VALUES (1, $1, 1, NOW())
        ON CONFLICT (id) DO UPDATE SET source_sha256 = EXCLUDED.source_sha256, row_count = EXCLUDED.row_count
      `,
      ["a".repeat(64)],
    );
    await pool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
    await pool.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        ) VALUES ($1::uuid, '2026-09-01'::date, 'Doors', 2, 100.50, 0,0,0,0,0,0,0, $2, NOW())
      `,
      [LEGAL_A, "a".repeat(64)],
    );
    await pool.end();
  }

  async function login(page: Page) {
    await page.goto(baseUrl + "/login");
    await page.fill('input[name="email"]', "admin-sales-ui@example.test");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile", { timeout: 30000 });
  }

  it("card overview uses apiRequest wrapper and shows months", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(page);
    await page.goto(
      `${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-09`,
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector('[data-testid="v3-client-sales-summary"]', { timeout: 20000 });
    const monthSelect = page.locator('[data-testid="v3-client-sales-month"]');
    await monthSelect.waitFor();
    const options = await monthSelect.locator("option").allTextContents();
    assert.ok(options.some((o) => o.includes("2026-09")));
    const breakdown = page.locator('[data-testid="v3-sales-breakdown"]');
    await breakdown.waitFor();
    const breakdownText = await breakdown.innerText();
    assert.match(breakdownText, /100,50|100\.50/);
    const summaryText = await page.locator('[data-testid="v3-client-sales-summary"]').innerText();
    assert.match(summaryText, /Не все юрлица|доступная часть/i);
    const details = page.locator('[data-testid="v3-sales-details-link"]').first();
    const href = await details.getAttribute("href");
    assert.ok(href && href.includes(LEGAL_A));
    assert.ok(href.includes("cardTab=sales"));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "holding-overview.png"), fullPage: true });
    await page.close();
  });

  it("list columns enrich via GET batch wrapper", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(page);
    await page.goto(`${baseUrl}/clients?v3mode=1&v3entity=legal`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ClientSalesSummaryUi && window.TandoorRf);
    const batch = await page.evaluate(async function (ids) {
      const api = window.TandoorRf;
      const payload = await window.ClientSalesSummaryUi.fetchBatch(api, "2026-09", [
        { kind: "holding", guid: ids.holdingId },
        { kind: "legal", guid: ids.legalId },
      ]);
      return payload;
    }, { holdingId: HOLDING, legalId: LEGAL_A });
    assert.ok(batch.summaries);
    const holdingCell = batch.summaries[`holding:${HOLDING.toLowerCase()}`];
    assert.equal(holdingCell.dataState, "incomplete");
    const legalCell = batch.summaries[`legal:${LEGAL_A.toLowerCase()}`];
    assert.equal(legalCell.dataState, "loaded");
    assert.match(String(legalCell.incomeTotal), /100/);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-mobile-sales-columns.png"), fullPage: true });
    await page.close();
  });
});
