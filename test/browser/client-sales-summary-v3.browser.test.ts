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
const MGR_A = "99999999-9999-4999-8999-111111111111";
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
          ($1::uuid, 'Legal A Sales', '7700000001', $3::uuid, '{}'::jsonb, jsonb_build_object('guidManager', $4::text), '{}'::jsonb, 't'),
          ($2::uuid, 'Legal B Sales', '7700000002', $3::uuid, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 't')
        ON CONFLICT DO NOTHING
      `,
      [LEGAL_A, LEGAL_B, HOLDING, MGR_A],
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
        ) VALUES
          ($1::uuid, '2026-09-01'::date, 'Doors', 2, 100.50, 0,0,0,0,0,0,0, $2, NOW()),
          ($3::uuid, '2026-09-01'::date, 'Doors', 0, 0, 0,0,0,0,0,0,0, $2, NOW())
      `,
      [LEGAL_A, "a".repeat(64), LEGAL_B],
    );
    await pool.query(`
      INSERT INTO onec_v3_legal_sale_item_import_state(id,source_sha256,row_count)
      VALUES(1,$1,52) ON CONFLICT(id) DO UPDATE SET source_sha256=$1,row_count=52
    `, ["b".repeat(64)]);
    await pool.query(`
      INSERT INTO onec_v3_legal_sales_month_activation(dataset,sale_month,source_sha256)
      VALUES('sale_items','2026-09-01',$1)
      ON CONFLICT(dataset,sale_month) DO UPDATE SET source_sha256=$1
    `, ["b".repeat(64)]);
    await pool.query(`
      INSERT INTO onec_v3_legal_sale_item_lines
        (source_sha256,source_row_index,legal_guid,sale_month,product_type,guid_item,name_item,
         quantity,income,manual_discount,automatic_discount,total_discount,cost_price,additional_expenses,
         gross_profit,profitability,catalog_matched)
      SELECT $1,n,$2::uuid,'2026-09-01','Doors',
        ('aaaaaaaa-aaaa-4aaa-8aaa-'||LPAD(n::text,12,'0'))::uuid,
        'Model '||LPAD(n::text,3,'0'),1,1,0,0,0,900,0,900,900,TRUE
      FROM generate_series(1,52) n
    `, ["b".repeat(64), LEGAL_A]);
    await pool.end();
  }

  async function login(page: Page) {
    await page.goto(baseUrl + "/login");
    await page.fill('input[name="email"]', "admin-sales-ui@example.test");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile", { timeout: 30000 });
  }

  it("card uses list return territory and requested missing month", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const cardUrls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/clients/v3/client-sales/")) {
        cardUrls.push(req.url());
      }
    });
    await login(page);
    const returnQ = encodeURIComponent(`?v3mode=1&v3manager=${MGR_A}&v3salesMonth=2026-08`);
    await page.goto(
      `${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-08&return=${returnQ}`,
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector('[data-testid="v3-client-sales-summary"]', { timeout: 20000 });
    assert.ok(cardUrls.some((u) => u.includes("managerGuid=" + MGR_A)));
    assert.ok(cardUrls.some((u) => u.includes("month=2026-08")));
    await page.waitForSelector('[data-testid="v3-sales-month-unavailable"]', { timeout: 10000 });
    const tiles = await page.locator('[data-testid="v3-sales-summary-tiles"]').innerText();
    assert.match(tiles, /—/);
    assert.doesNotMatch(tiles, /100,50/);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "card-territory-missing-month.png"), fullPage: true });
    await page.close();
  });

  it("month change updates nested return on Back href", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(page);
    const returnRaw = `?v3mode=1&v3entity=legal_grouped&v3salesMonth=2026-08`;
    await page.goto(
      `${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-08&return=${encodeURIComponent(returnRaw)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForSelector('[data-testid="v3-client-sales-month"]', { timeout: 20000 });
    await page.locator('[data-testid="v3-client-sales-month"]').selectOption("2026-09");
    await page.waitForFunction(() => {
      var back = document.querySelector('[data-testid="v3-back-to-list"]');
      return back && back.getAttribute("href") && back.getAttribute("href").includes("v3salesMonth=2026-09");
    });
    const backHref = await page.locator('[data-testid="v3-back-to-list"]').getAttribute("href");
    assert.ok(backHref && backHref.includes("v3salesMonth=2026-09"));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "back-href-month-sync.png"), fullPage: true });
    await page.close();
  });

  it("list shows four sales column headers and scope note", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(page);
    await page.goto(`${baseUrl}/clients?v3mode=1&view=all&v3view=all&v3entity=legal_grouped&v3salesMonth=2026-09`, { waitUntil: "networkidle" });
    await page.locator("#columns-picker-btn").click();
    for (const field of ["sales_income_total", "sales_quantity_total", "sales_legal_count", "sales_by_legal"]) {
      await page.locator(`[data-v3-column-id="${field}"]`).check();
    }
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#clients-table-body")?.textContent?.includes("100,50"));
    const headers = await page.locator("#clients-table-head-row th").allTextContents();
    assert.ok(headers.some((h) => h.includes("Продажи, ₽")));
    assert.ok(headers.some((h) => h.includes("юрлицам")));
    assert.equal(await page.locator("#v3-sales-month-filter").inputValue(), "2026-09");
    await page.locator("#clients-table-body a.clients-link").first().click();
    await page.locator('[data-testid="v3-client-sales-month"]').waitFor();
    const back = await page.locator('[data-testid="v3-back-to-list"]').getAttribute("href");
    assert.ok(back?.includes("v3salesMonth=2026-09") && back.includes("v3cols="));
    await page.locator('[data-testid="v3-sales-details-link"]').first().click();
    await page.waitForURL((url) => url.searchParams.get("cardTab") === "sales" && url.searchParams.get("salesLegal") === LEGAL_A);
    assert.ok(new URL(page.url()).searchParams.get("return")?.includes("v3cols="));
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForSelector("#clients-table-body tr");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#v3-sales-month-filter").inputValue(), "2026-09");
    assert.ok((await page.locator("#clients-table-head-row th").allTextContents()).some(h => h.includes("юрлицам")));
    await page.locator("#clients-table-head-row th").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-sales-desktop.png"), fullPage: true });
    await page.locator('[data-testid="v3-focus-enter"]').click();
    await page.locator("#v3-focus-columns").click();
    for (const field of ["sales_income_total", "sales_quantity_total", "sales_legal_count", "sales_by_legal"]) {
      await page.locator(`#v3-lktandoor-columns-dialog [data-v3-column-id="${field}"]`).check();
    }
    await page.locator("#v3-columns-done").click();
    await page.waitForFunction(() => document.querySelector("#x14-focus-scroll tbody")?.textContent?.includes("100,50"));
    assert.ok((await page.locator("#x14-focus-scroll th").allTextContents()).some(h => h.includes("юрлицам")));
    await page.locator("#x14-focus-scroll th").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "list-sales-fullscreen.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForURL(url => !url.searchParams.has("v3focus"));
    await page.setViewportSize({ width: 375, height: 812 });
    if (await page.locator("#legacy-menu-toggle").getAttribute("aria-expanded") === "true") {
      await page.locator("#legacy-menu-toggle").click();
    }
    await page.waitForFunction(() => (document.getElementById("legacy-sidebar")?.getBoundingClientRect().right ?? 0) <= 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "list-sales-columns-mobile-375.png"),
      fullPage: true,
    });
    await page.close();
  });

  it("details link opens sales inside the same holding card with the chosen legal and month", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(page);
    await page.goto(
      `${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-09`,
      { waitUntil: "networkidle" },
    );
    const href = await page.locator('[data-testid="v3-sales-details-link"]').first().getAttribute("href");
    assert.ok(href && href.includes(LEGAL_A));
    assert.ok(href.includes("v3salesMonth=2026-09"));
    await page.click('[data-testid="v3-sales-details-link"]');
    await page.waitForURL((url) => url.searchParams.get("cardTab") === "sales" && url.searchParams.get("salesLegal") === LEGAL_A, { timeout: 15000 });
    assert.match(new URL(page.url()).pathname, new RegExp(HOLDING));
    assert.equal(new URL(page.url()).searchParams.get("v3Entity"), "holding");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "details-legal-sales.png"), fullPage: true });
    await page.close();
  });

  it("overview preserves an existing Sales section return path", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(page);
    await page.goto(`${baseUrl}/clients/${LEGAL_A}?v3Entity=legal&return=${encodeURIComponent("/sales?month=2026-09")}`,
      { waitUntil: "networkidle" });
    await page.locator('[data-testid="v3-client-sales-month"]').waitFor();
    const back = await page.locator('[data-testid="v3-back-to-list"]').getAttribute("href");
    assert.ok(back?.startsWith("/sales?"));
    assert.equal(new URL(back!, baseUrl).searchParams.get("month"), "2026-09");
    await page.close();
  });

  it("holding categories drill down to real models with legal selection, search, pages and reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await login(page);
    await page.goto(`${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-09&return=${encodeURIComponent("?v3mode=1&view=all&v3salesMonth=2026-09")}`,
      { waitUntil: "networkidle" });
    await page.locator('[data-testid="v3-sales-open-detail"]').click();
    await page.locator('[data-testid="csd-legal"]').selectOption(LEGAL_A);
    await page.locator('[data-csd-category="Doors"]').click();
    await page.locator(".csd-products tbody tr").first().waitFor();
    assert.equal(await page.locator(".csd-products tbody tr").count(), 50);
    assert.match(new URL(page.url()).pathname, new RegExp(HOLDING));
    assert.equal(new URL(page.url()).searchParams.get("salesLegal"), LEGAL_A);
    await page.locator("[data-csd-next]").click();
    await page.waitForFunction(() => document.querySelectorAll(".csd-products tbody tr").length === 2);
    assert.equal(new URL(page.url()).searchParams.get("salesPage"), "2");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".csd-products tbody tr").count(), 2);
    await page.locator('[data-testid="csd-search"] input').fill("Model 052");
    await page.locator('[data-testid="csd-search"] button').click();
    await page.waitForFunction(() => document.querySelectorAll(".csd-products tbody tr").length === 1);
    assert.match(await page.locator(".csd-products").innerText(), /Model 052/);
    assert.equal(new URL(page.url()).searchParams.get("salesPage"), null);
    assert.equal(new URL(page.url()).searchParams.get("salesQ"), "Model 052");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "models-desktop.png"), fullPage: true });
    await page.locator("[data-csd-back]").click();
    await page.locator('[data-testid="csd-legal"]').selectOption(LEGAL_B);
    await page.locator('[data-csd-category="Doors"]').click();
    await page.getByText("Товарные строки не найдены.", { exact: false }).waitFor();
    assert.equal(await page.locator(".csd-products tbody tr").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  });

  it("mobile model drilldown is readable and legacy legal finance remains reachable", async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await login(page);
    await page.goto(`${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-09`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="v3-sales-open-detail"]').click();
    await page.locator('[data-csd-category="Doors"]').click();
    await page.locator(".csd-products tbody tr").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.locator(".csd-products tbody tr").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "models-mobile-375.png"), fullPage: false });
    await page.goto(`${baseUrl}/clients/${LEGAL_A}?v3Entity=legal&cardTab=sales&v3salesMonth=2026-09`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Расширенная сводка по категориям с финансовыми показателями" }).click();
    await page.locator('[data-testid="v3-sales-month-select"]').waitFor();
    assert.equal(new URL(page.url()).searchParams.get("salesView"), "financial");
    await page.close();
  });

  it("drilldown keeps list-return territory and escapes model names", async () => {
    const pool = new (await import("pg")).Pool({ connectionString: getIntegrationDatabaseUrl() });
    try {
      await pool.query(`UPDATE onec_v3_legal_sale_item_lines SET name_item=$1
        WHERE source_sha256=$2 AND source_row_index=51`,
        ['</td><img src=x onerror="window.__salesXss=1">', "b".repeat(64)]);
    } finally { await pool.end(); }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(page);
    const ret = encodeURIComponent(`?v3mode=1&v3manager=${MGR_A}&v3salesMonth=2026-09`);
    await page.goto(`${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-09&return=${ret}`,
      { waitUntil: "networkidle" });
    await page.locator('[data-testid="v3-sales-open-detail"]').click();
    await page.locator('[data-testid="csd-legal"]').waitFor();
    const legalOptions = await page.locator('[data-testid="csd-legal"] option').allTextContents();
    assert.ok(legalOptions.some(text => text.includes("Legal A")));
    assert.ok(!legalOptions.some(text => text.includes("Legal B")));
    await page.locator('[data-csd-category="Doors"]').click();
    await page.locator('[data-testid="csd-search"] input').fill("aaaaaaaa-aaaa-4aaa-8aaa-000000000051");
    await page.locator('[data-testid="csd-search"] button').click();
    await page.waitForFunction(() => document.querySelectorAll(".csd-products tbody tr").length === 1);
    assert.match(await page.locator(".csd-products").innerText(), /<img/);
    assert.equal(await page.locator(".csd-products img").count(), 0);
    assert.equal(await page.evaluate(() => (window as Window & { __salesXss?: number }).__salesXss), undefined);
    await page.close();
  });

  async function seedScrollClients() {
    const pool = new (await import("pg")).Pool({ connectionString: getIntegrationDatabaseUrl() });
    try {
      await pool.query(`INSERT INTO onec_v3_holdings
        (guid_holding,name_holding,type_category,managers,last_source_sha256)
        SELECT ('bbbbbbbb-bbbb-4bbb-8bbb-'||LPAD(n::text,12,'0'))::uuid,
          'Scroll client '||LPAD(n::text,3,'0'),'{}','{}','synthetic-scroll'
        FROM generate_series(1,70) n ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO onec_v3_legal_entities
        (guid_client,name_client,inn,guid_holding,type_category,managers,other_fields,last_source_sha256)
        SELECT ('cccccccc-cccc-4ccc-8ccc-'||LPAD(n::text,12,'0'))::uuid,
          'Scroll legal '||LPAD(n::text,3,'0'),'77000'||LPAD(n::text,5,'0'),
          ('bbbbbbbb-bbbb-4bbb-8bbb-'||LPAD(n::text,12,'0'))::uuid,
          '{}','{}','{}','synthetic-scroll'
        FROM generate_series(1,70) n ON CONFLICT DO NOTHING`);
    } finally { await pool.end(); }
  }

  it("a many-client fullscreen register scrolls both axes and keeps paging visible", async () => {
    await seedScrollClients();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);
    await page.goto(`${baseUrl}/clients?v3mode=1&view=all&v3view=all&v3entity=legal_grouped&v3cols=name,inn,manager,team,address,phone,sales_income_total,sales_quantity_total,sales_legal_count,sales_by_legal&v3salesMonth=2026-09`, { waitUntil: "networkidle" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.locator('[data-testid="v3-focus-enter"]').click();
    await page.locator("#x14-focus-scroll tbody tr").first().waitFor();
    const geometry = await page.locator("#x14-focus-scroll").evaluate(el => ({
      height: el.clientHeight, content: el.scrollHeight, width: el.clientWidth, contentWidth: el.scrollWidth,
      bottom: el.getBoundingClientRect().bottom, viewport: window.innerHeight,
    }));
    console.log("Fullscreen scroll geometry", geometry);
    assert.ok(geometry.content > geometry.height, "rows must scroll inside a bounded viewport");
    assert.ok(geometry.bottom <= geometry.viewport, "table must not extend below viewport");
    await page.locator("#x14-focus-scroll").hover();
    await page.mouse.wheel(0, 650);
    await page.waitForFunction(() => document.getElementById("x14-focus-scroll")!.scrollTop > 100, null, { timeout: 5000 });
    const pager = await page.locator("#v3-focus-pagination").boundingBox();
    assert.ok(pager && pager.y + pager.height <= 901, "pagination must stay on screen");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "scroll-register-desktop.png") });
    for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 375, height: 500 }]) {
      await page.setViewportSize(viewport);
      const pane = page.locator("#x14-focus-scroll");
      const box = await pane.boundingBox();
      assert.ok(box && box.height > 60 && box.y + box.height < viewport.height, "table retains usable scroll area");
      await pane.hover();
      await page.mouse.wheel(700, 0);
      await page.waitForFunction(() => document.getElementById("x14-focus-scroll")!.scrollLeft > 0, null, { timeout: 5000 });
      await page.mouse.wheel(-3000, -3000);
      await page.waitForFunction(() => {
        const el = document.getElementById("x14-focus-scroll")!;
        return el.scrollLeft === 0 && el.scrollTop === 0;
      }, null, { timeout: 5000 });
      const footer = await page.locator("#v3-focus-pagination").boundingBox();
      assert.ok(footer && footer.y + footer.height <= viewport.height + 1);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `scroll-register-${viewport.width}x${viewport.height}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#v3-focus-page-next").click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get("page") === "2");
    await page.waitForFunction(() => document.querySelectorAll("#x14-focus-scroll tbody tr").length === 21);
    assert.match(await page.locator("#v3-focus-pagination").innerText(), /51–71 из 71/);
    await page.locator("#v3-focus-page-size").selectOption("100");
    await page.waitForFunction(() => document.querySelectorAll("#x14-focus-scroll tbody tr").length === 71);
    assert.equal(new URL(page.url()).searchParams.get("v3salesMonth"), "2026-09");
    assert.equal(new URL(page.url()).searchParams.get("v3pageSize"), "100");
    assert.match(await page.locator("#v3-focus-pagination").innerText(), /1–71 из 71/);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#v3-focus-page-size").inputValue(), "100");
    await page.locator("#x14-focus-scroll").focus();
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() => document.getElementById("x14-focus-scroll")!.scrollTop > 100);
    await page.locator("#v3-focus-exit").click();
    await page.waitForFunction(() => !document.body.classList.contains("x14-focus-mode"));
    await page.locator("#clients-table-body tr").nth(70).waitFor();
    await page.locator(".clients-page-header").hover();
    await page.mouse.wheel(0, 700);
    await page.waitForFunction(() => window.scrollY > 100, null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    await page.close();
  });

  it("touch scrolling works both ways in the register and down long product details", async () => {
    await seedScrollClients();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page);
    await page.goto(`${baseUrl}/clients?v3mode=1&view=all&v3view=all&v3entity=legal_grouped&v3focus=1`, { waitUntil: "networkidle" });
    const cdp = await context.newCDPSession(page);
    async function swipe(x: number, y: number, dx: number, dy: number) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 20; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 20, y: y + dy * step / 20 }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await page.locator("#x14-focus-scroll tbody tr").first().waitFor();
    await swipe(300, 560, 0, -250);
    await page.waitForFunction(() => document.getElementById("x14-focus-scroll")!.scrollTop > 80);
    const top = await page.locator("#x14-focus-scroll").evaluate(el => el.scrollTop);
    await swipe(300, 300, 0, 250);
    await page.waitForFunction(value => document.getElementById("x14-focus-scroll")!.scrollTop < value, top);
    await swipe(330, 450, -150, 0);
    await page.waitForFunction(() => document.getElementById("x14-focus-scroll")!.scrollLeft > 30);
    const left = await page.locator("#x14-focus-scroll").evaluate(el => el.scrollLeft);
    await swipe(180, 450, 150, 0);
    await page.waitForFunction(value => document.getElementById("x14-focus-scroll")!.scrollLeft < value, left);
    await page.goto(`${baseUrl}/clients/${HOLDING}?v3Entity=holding&cardTab=sales&v3salesMonth=2026-09&salesLegal=${LEGAL_A}&salesCategory=Doors`, { waitUntil: "networkidle" });
    await page.locator(".csd-products tbody tr").first().waitFor();
    assert.equal(await page.locator(".csd-products tbody tr").count(), 50);
    await swipe(300, 650, 0, -350);
    await page.waitForFunction(() => window.scrollY > 100);
    await page.locator("[data-csd-next]").click();
    await page.waitForFunction(() => document.querySelectorAll(".csd-products tbody tr").length === 2);
    await swipe(300, 250, 0, 350);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "scroll-card-mobile.png") });
    await page.goto(`${baseUrl}/clients/${HOLDING}?v3Entity=holding&v3salesMonth=2026-09`, { waitUntil: "networkidle" });
    const breakdown = page.locator(".v3-sales-breakdown-wrap");
    await breakdown.scrollIntoViewIfNeeded();
    const box = await breakdown.boundingBox();
    assert.ok(box);
    await swipe(310, box.y + box.height / 2, -150, 0);
    await page.waitForFunction(() => document.querySelector(".v3-sales-breakdown-wrap")!.scrollLeft > 30);
    const breakdownLeft = await breakdown.evaluate(el => el.scrollLeft);
    await swipe(155, box.y + box.height / 2, 150, 0);
    await page.waitForFunction(value => document.querySelector(".v3-sales-breakdown-wrap")!.scrollLeft < value, breakdownLeft);
    const previousY = await page.evaluate(() => window.scrollY);
    await swipe(280, box.y + box.height / 2, 0, -150);
    await page.waitForFunction(value => window.scrollY > value, previousY);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "scroll-card-overview-mobile.png") });
    await context.close();
  });
});
