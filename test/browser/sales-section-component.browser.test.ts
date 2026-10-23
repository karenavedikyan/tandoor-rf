import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import { adminUserPayload } from "./helpers/clients-api-mocks";

const LEGAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MALICIOUS = '"><img src=x onerror=window.__xss=1>';

describe("sales section component browser", { concurrency: false, timeout: 120_000 }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("bind failed");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function mockSalesApis(page: Page, opts: { skuDelayMs?: number; skuReject?: boolean } = {}) {
    const overview = {
      month: "2026-09",
      currency: "RUB",
      vatNote: "Суммы с НДС",
      dataState: "loaded",
      salesSource: "items",
      returnsSource: "items",
      returnsSignedNote: "minus",
      importMeta: {
        schemaReady: true,
        salesSource: "items",
        returnsSource: "items",
        scopedMatchedSalesRows: 1,
        scopedQuarantinedSalesRows: 0,
        scopedMatchedReturnRows: 1,
        globalQuarantinedItemRows: 0,
        globalQuarantinedReturnRows: 0,
        coverageNote: "",
      },
      fieldPolicy: {
        quantity: true,
        income: true,
        manualDiscount: true,
        automaticDiscount: true,
        totalDiscount: true,
        costPrice: true,
        additionalExpenses: true,
        grossProfit: true,
        profitability: true,
      },
      returnsFinanceAvailability: {
        manualDiscount: false,
        automaticDiscount: false,
        totalDiscount: false,
        costPrice: false,
        additionalExpenses: false,
        grossProfit: false,
        profitability: false,
      },
      macroSummaries: [],
      categories: [
        {
          productType: MALICIOUS,
          macroGroup: "vh",
          quantity: "1",
          income: "100",
          manualDiscount: "1",
          automaticDiscount: "2",
          totalDiscount: "3",
          costPrice: "4",
          additionalExpenses: "5",
          grossProfit: "6",
          profitabilityPercent: "10",
        },
      ],
      returnsMacroSummaries: [],
      returnsCategories: [
        {
          productType: "Returns cat",
          macroGroup: "vh",
          quantity: "-1",
          income: "-10",
        },
      ],
      periodComparisonNote: "",
    };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      if (pathname === "/api/auth/me") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...adminUserPayload(), preview: { active: false } }),
        });
        return;
      }
      if (pathname === "/api/clients/presentation") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ presentation: { clientsHref: "/clients?v3mode=1" } }),
        });
        return;
      }
      if (pathname.startsWith("/api/clients/v3/sales/months")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ months: ["2026-08", "2026-09"] }),
        });
        return;
      }
      if (pathname.startsWith("/api/clients/v3/options")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ managers: [] }),
        });
        return;
      }
      if (pathname.startsWith("/api/clients/v3/sales/overview")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ overview }),
        });
        return;
      }
      if (pathname.startsWith("/api/clients/v3/sales/sku")) {
        const kind = url.searchParams.get("kind");
        if (opts.skuReject) {
          await route.abort("failed");
          return;
        }
        if (opts.skuDelayMs) {
          await new Promise((r) => setTimeout(r, opts.skuDelayMs));
        }
        const label = kind === "returns" ? "OLD_RETURNS_SKU" : "OLD_SALES_SKU";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                guidItem: "d1000000-0000-4000-8000-000000000001",
                nameItem: label,
                productType: "x",
                quantity: "1",
                income: "1",
              },
            ],
            fieldPolicy: overview.fieldPolicy,
          }),
        });
        return;
      }
      if (pathname.startsWith("/api/clients/v3/sales/clients")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            clients: [{ legalGuid: LEGAL, legalName: "Legal A", quantity: "1", income: "1" }],
            fieldPolicy: overview.fieldPolicy,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });
  }

  async function openSales(page: Page, viewport: { width: number; height: number }) {
    await page.setViewportSize(viewport);
    await mockSalesApis(page);
    await page.goto(`${baseUrl}/sales?month=2026-09`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="sales-categories"]', { timeout: 15_000 });
  }

  it("does not execute XSS from category drill attribute", async () => {
    const page = await browser.newPage();
    let xss = false;
    page.on("pageerror", () => {
      xss = true;
    });
    await openSales(page, { width: 1280, height: 900 });
    await page.locator('[data-testid="sales-categories"] button').first().click();
    await page.waitForSelector('[data-testid="sales-sku-table"]');
    const html = await page.content();
    assert.equal(html.includes("onerror=alert"), false);
    assert.equal(xss, false);
    await page.close();
  });

  it("drops stale sales SKU when switching to returns tab", async () => {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 375, height: 800 });
    await mockSalesApis(page, { skuDelayMs: 400 });
    await page.goto(`${baseUrl}/sales?month=2026-09`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="sales-categories"]', { timeout: 15_000 });
    await page.locator('[data-testid="sales-categories"] button').first().click();
    await page.getByRole("tab", { name: "Возвраты" }).click();
    await page.waitForTimeout(600);
    const panel = page.locator('[data-testid="sales-drill-panel"]');
    await page.waitForTimeout(600);
    const text = await panel.innerText();
    assert.equal(text.includes("OLD_SALES_SKU"), false);
    assert.equal(text.trim(), "");
    const returnsSelected = await page.getByRole("tab", { name: "Возвраты" }).getAttribute("aria-selected");
    assert.equal(returnsSelected, "true");
    await page.close();
  });

  it("shows retry after SKU network reject without pageerror", async () => {
    const page = await browser.newPage();
    let pageError = false;
    page.on("pageerror", () => {
      pageError = true;
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSalesApis(page, { skuReject: true });
    await page.goto(`${baseUrl}/sales?month=2026-09`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="sales-categories"]', { timeout: 15_000 });
    await page.locator('[data-testid="sales-categories"] button').first().click();
    await page.waitForSelector(".sales-retry-drill");
    assert.equal(pageError, false);
    await page.close();
  });

  it("keeps page width within viewport on mobile", async () => {
    const page = await browser.newPage();
    await openSales(page, { width: 375, height: 800 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollWidth <= 380, `scrollWidth=${scrollWidth}`);
    await page.close();
  });

  it("links clients drill to v3 legal detail", async () => {
    const page = await browser.newPage();
    await openSales(page, { width: 1280, height: 900 });
    await page.locator('[data-testid="sales-categories"] button').first().click();
    await page.waitForSelector('[data-testid="sales-sku-table"]');
    await page.getByRole("button", { name: "Клиенты" }).click();
    await page.waitForSelector('[data-testid="sales-clients-table"] a');
    const href = await page.locator('[data-testid="sales-clients-table"] a').first().getAttribute("href");
    assert.ok(href?.includes("v3Entity=legal"));
    assert.ok(href?.includes("return=%2Fsales"));
    await page.close();
  });
});
