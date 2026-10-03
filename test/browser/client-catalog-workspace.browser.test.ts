import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  SYNTHETIC_CLIENT_GUID,
  resolveMockResponse,
  syntheticCatalogMetaPayload,
  syntheticCatalogProductDetailPayload,
  syntheticDetailPayload,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

function createMockController(page: Page, initial: MockOptions = {}) {
  const options: MockOptions = { role: "admin", ...initial };
  const state = { listCalls: 0, catalogProductsCalls: 0 };
  let installed = false;

  async function install(): Promise<void> {
    if (installed) return;
    installed = true;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const mock = resolveMockResponse(url, options, state, route.request().method());
      if (mock) {
        await route.fulfill(mock);
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"error":"not mocked"}',
      });
    });
  }

  return { state, options, install, set(next: MockOptions) { Object.assign(options, next); } };
}

async function ensureTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((expected) => {
    document.documentElement.setAttribute("data-theme", expected);
  }, theme);
}

async function captureScreenshot(
  page: Page,
  filename: string,
  viewport: { width: number; height: number },
  theme: "light" | "dark",
): Promise<void> {
  await page.setViewportSize(viewport);
  await ensureTheme(page, theme);
  await page.waitForTimeout(200);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: true });
}

describe("client catalog workspace (R3.2 visual, mocked API)", { concurrency: false }, () => {
  let server: http.Server;
  let baseUrl = "";
  let browser: Browser;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  async function openWorkspace(options: MockOptions = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const mocks = createMockController(page, options);
    await mocks.install();
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}/catalog`);
    await page.waitForSelector("#catalog-workspace-app:not(.clients-hidden)");
    await page.waitForSelector(".pc-catalog-workspace-layout");
    return { page, context, mocks };
  }

  it("renders three view modes, filters, image and detail navigation", async () => {
    const { page, context } = await openWorkspace({
      catalogProductDetail: syntheticCatalogProductDetailPayload(),
    });

    assert.match(await page.locator(".pc-catalog-outlet-picker").textContent(), /Торговая точка/);
    await page.waitForSelector(".pc-catalog-view-modes__btn");
    await page.waitForSelector(".pc-catalog-image--photo img");
    assert.equal(await page.locator(".pc-catalog-image--photo img").count(), 1);

    await page.locator('[data-view-mode="compact"]').click();
    await page.waitForSelector(".pc-catalog-grid--compact");
    await page.locator('[data-view-mode="list"]').click();
    await page.waitForSelector(".pc-catalog-list");

    await captureScreenshot(page, "clients-catalog-workspace-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-catalog-workspace-390-dark.png", { width: 390, height: 844 }, "dark");

    await page.locator("[data-catalog-zoom]").first().click();
    await page.waitForSelector(".pc-catalog-lightbox");
    await page.locator(".pc-catalog-lightbox__close").click();

    await page.fill('[name="q"]', "Product");
    await page.click('button[type="submit"].pc-catalog-btn');
    await page.waitForSelector(".pc-catalog-card");
    await page.locator('[data-catalog-open="p1"]').click();
    await page.waitForSelector(".pc-catalog-detail");
    await page.locator("[data-catalog-back]").click();
    await page.waitForSelector(".pc-catalog-workspace-layout");
    assert.equal(await page.inputValue('[name="q"]'), "Product");

    await page.close();
    await context.close();
  });

  it("shows access loss on detail without product-not-found message", async () => {
    const { page, context, mocks } = await openWorkspace({
      catalogProductDetail: syntheticCatalogProductDetailPayload(),
    });
    await page.waitForSelector(".pc-catalog-card");
    mocks.set({ catalogAccessRevoked: true });
    await page.locator('[data-catalog-open="p1"]').click();
    await page.waitForSelector('.pc-catalog-state--error');
    assert.match(await page.locator("#catalog-workspace-root").textContent(), /Каталог недоступен/);
    assert.doesNotMatch(await page.locator("#catalog-workspace-root").textContent(), /Товар не найден/);
    await page.close();
    await context.close();
  });

  it("does not multiply facet/product requests on repeated searches", async () => {
    const counts = { facets: 0, products: 0 };
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/catalog/facets")) counts.facets += 1;
      if (url.pathname.endsWith("/catalog/products")) counts.products += 1;
      const mock = resolveMockResponse(
        url,
        { role: "admin", detailBody: syntheticDetailPayload() },
        { listCalls: 0, catalogProductsCalls: 0 },
        route.request().method(),
      );
      if (mock) await route.fulfill(mock);
      else await route.fulfill({ status: 404, body: "{}" });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}/catalog`);
    await page.waitForSelector(".pc-catalog-workspace-layout");
    const baselineFacets = counts.facets;
    const baselineProducts = counts.products;

    for (let i = 0; i < 3; i += 1) {
      await page.fill('[name="q"]', "Product " + i);
      await page.locator('[data-catalog-search-form] button[type="submit"]').click();
      await page.waitForSelector(".pc-catalog-card");
    }

    assert.equal(counts.facets - baselineFacets, 3);
    assert.equal(counts.products - baselineProducts, 3);
    await page.waitForFunction(() => {
      var extras = document.querySelector("[data-catalog-toolbar-extras]");
      return extras && /Поиск: Product 2/.test(extras.textContent || "");
    });
    assert.equal(await page.inputValue('[name="q"]'), "Product 2");

    await page.locator('[data-catalog-action="reset-filters"]').click();
    await page.waitForFunction(() => {
      var extras = document.querySelector("[data-catalog-toolbar-extras]");
      return extras && !/Поиск:/.test(extras.textContent || "");
    });
    assert.equal(await page.inputValue('[name="q"]'), "");

    await page.close();
    await context.close();
  });

  it("ignores stale detail response after returning to list", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let detailDelayMs = 1200;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.match(/\/catalog\/products\/[^/]+$/) && !url.pathname.endsWith("/products")) {
        await new Promise((resolve) => setTimeout(resolve, detailDelayMs));
      }
      const mock = resolveMockResponse(
        url,
        { role: "admin", detailBody: syntheticDetailPayload(), catalogProductDetail: syntheticCatalogProductDetailPayload() },
        { listCalls: 0, catalogProductsCalls: 0 },
        route.request().method(),
      );
      if (mock) await route.fulfill(mock);
      else await route.fulfill({ status: 404, body: "{}" });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}/catalog`);
    await page.waitForSelector(".pc-catalog-card");
    await page.locator('[data-catalog-open="p1"]').click();
    await page.waitForSelector(".pc-catalog-detail");
    detailDelayMs = 1800;
    await page.locator("[data-catalog-back]").click();
    await page.waitForSelector(".pc-catalog-workspace-layout");
    await page.waitForTimeout(2200);
    assert.equal(await page.locator(".pc-catalog-detail").count(), 0);
    assert.ok(await page.locator(".pc-catalog-workspace-layout").isVisible());
    await page.close();
    await context.close();
  });

  it("shows retry state when facets endpoint fails", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let facetsFail = true;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (facetsFail && url.pathname.endsWith("/catalog/facets")) {
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Temporary"}' });
        return;
      }
      const mock = resolveMockResponse(
        url,
        { role: "admin", detailBody: syntheticDetailPayload() },
        { listCalls: 0, catalogProductsCalls: 0 },
        route.request().method(),
      );
      if (mock) await route.fulfill(mock);
      else await route.fulfill({ status: 404, body: "{}" });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}/catalog`);
    await page.waitForSelector('.pc-catalog-state--error');
    assert.match(await page.locator("#catalog-workspace-root").textContent(), /Не удалось загрузить фильтры/);
    facetsFail = false;
    await page.locator('[data-catalog-action="retry-list"]').click();
    await page.waitForSelector(".pc-catalog-card");
    await page.close();
    await context.close();
  });

  it("clears session state after access revocation", async () => {
    const { page, context, mocks } = await openWorkspace();
    await page.fill('[name="q"]', "Persist me");
    await page.locator('[data-catalog-search-form] button[type="submit"]').click();
    await page.waitForSelector(".pc-catalog-card");
    mocks.set({ catalogAccessRevoked: true });
    await page.reload();
    await page.waitForSelector('.pc-catalog-state--error');
    const stored = await page.evaluate((guid) => sessionStorage.getItem("tandoor-catalog-workspace-" + guid), SYNTHETIC_CLIENT_GUID);
    assert.equal(stored, null);
    await page.close();
    await context.close();
  });

  function truncatedFacetsBody(versionId = syntheticCatalogMetaPayload().versionId) {
    return JSON.stringify({
      state: "ready",
      versionId,
      total: 1,
      facets: [
        {
          key: "brand",
          label: "Бренд",
          values: [{ value: "Tandoor", count: 1 }],
          totalValues: 50,
          valuesTruncated: true,
        },
      ],
    });
  }

  async function openWorkspaceWithTruncatedFacets(
    page: Page,
    facetValuesHandler: (url: URL) => Promise<{ status: number; body: string; contentType?: string }>,
    options: MockOptions = {},
  ) {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/catalog/facet-values")) {
        const mock = await facetValuesHandler(url);
        await route.fulfill({
          status: mock.status,
          contentType: mock.contentType ?? "application/json",
          body: mock.body,
        });
        return;
      }
      if (url.pathname.endsWith("/catalog/facets")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: truncatedFacetsBody(),
        });
        return;
      }
      const mock = resolveMockResponse(
        url,
        { role: "admin", ...options },
        { listCalls: 0, catalogProductsCalls: 0 },
        route.request().method(),
      );
      if (mock) await route.fulfill(mock);
      else await route.fulfill({ status: 404, body: "{}" });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}/catalog`);
    await page.waitForSelector(".pc-catalog-workspace-layout");
    await page.waitForSelector('[data-facet-search="brand"]');
  }

  it("ignores stale facet-values when a newer search finishes first", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openWorkspaceWithTruncatedFacets(page, async (url) => {
      const facetQ = (url.searchParams.get("facetQ") ?? "").toLowerCase();
      if (facetQ === "old") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return {
          status: 200,
          body: JSON.stringify({
            state: "ready",
            versionId: syntheticCatalogMetaPayload().versionId,
            key: "brand",
            label: "Бренд",
            total: 1,
            values: [{ value: "OldBrand", count: 1 }],
            offset: 0,
            hasMore: false,
          }),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      return {
        status: 200,
        body: JSON.stringify({
          state: "ready",
          versionId: syntheticCatalogMetaPayload().versionId,
          key: "brand",
          label: "Бренд",
          total: 1,
          values: [{ value: "NewBrand", count: 1 }],
          offset: 0,
          hasMore: false,
        }),
      };
    });

    const search = page.locator('[data-facet-search="brand"]');
    await search.fill("old");
    await page.waitForTimeout(350);
    await search.fill("new");
    await page.waitForTimeout(600);
    await page.waitForFunction(() => /NewBrand/.test(document.body.textContent || ""));
    await page.waitForTimeout(1400);
    assert.equal(await search.inputValue(), "new");
    assert.match(await page.locator("[data-catalog-facets]").textContent(), /NewBrand/);
    assert.doesNotMatch(await page.locator("[data-catalog-facets]").textContent(), /OldBrand/);
    await page.close();
    await context.close();
  });

  it("drops facet-values results after section change during search", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openWorkspaceWithTruncatedFacets(page, async (url) => {
      const facetQ = url.searchParams.get("facetQ") ?? "";
      await new Promise((resolve) => setTimeout(resolve, 900));
      return {
        status: 200,
        body: JSON.stringify({
          state: "ready",
          versionId: syntheticCatalogMetaPayload().versionId,
          key: "brand",
          label: "Бренд",
          total: 1,
          values: [{ value: facetQ + "Result", count: 1 }],
          offset: 0,
          hasMore: false,
        }),
      };
    });

    const search = page.locator('[data-facet-search="brand"]');
    await search.fill("Section");
    await page.waitForTimeout(350);
    await page.locator('[data-section-code="s2"]').click();
    await page.waitForFunction(() => {
      var extras = document.querySelector("[data-catalog-toolbar-extras]");
      return extras && /Раздел: Section two/.test(extras.textContent || "");
    });
    await page.waitForTimeout(1200);
    assert.doesNotMatch(await page.locator("[data-catalog-facets]").textContent(), /SectionResult/);
    await page.close();
    await context.close();
  });

  it("shows catalog refresh on facet-values version conflict", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openWorkspaceWithTruncatedFacets(page, async () => ({
      status: 409,
      body: JSON.stringify({
        error: { code: "VERSION_CONFLICT", message: "Каталог обновился." },
      }),
    }));

    await page.locator('[data-facet-search="brand"]').fill("conflict");
    await page.waitForTimeout(400);
    await page.waitForSelector(".pc-catalog-state--error");
    assert.match(await page.locator("#catalog-workspace-root").textContent(), /Каталог обновился/);
    assert.doesNotMatch(await page.locator("[data-catalog-facets]").textContent(), /Не удалось найти значения/);
    await page.close();
    await context.close();
  });

  it("invalidates pending facet-values after access revocation", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let accessRevoked = false;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/catalog/facet-values")) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (accessRevoked) {
          await route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Client not found." } }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "ready",
            versionId: syntheticCatalogMetaPayload().versionId,
            key: "brand",
            label: "Бренд",
            total: 1,
            values: [{ value: "LateBrand", count: 1 }],
            offset: 0,
            hasMore: false,
          }),
        });
        return;
      }
      if (url.pathname.endsWith("/catalog/facets")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: truncatedFacetsBody(),
        });
        return;
      }
      if (accessRevoked && url.pathname.endsWith("/catalog/products")) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Client not found." } }),
        });
        return;
      }
      const mock = resolveMockResponse(
        url,
        { role: "admin", catalogAccessRevoked: accessRevoked },
        { listCalls: 0, catalogProductsCalls: 0 },
        route.request().method(),
      );
      if (mock) await route.fulfill(mock);
      else await route.fulfill({ status: 404, body: "{}" });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}/catalog`);
    await page.waitForSelector('[data-facet-search="brand"]');
    await page.locator('[data-facet-search="brand"]').fill("late");
    await page.waitForTimeout(350);
    accessRevoked = true;
    await page.waitForSelector('.pc-catalog-state--error');
    assert.match(await page.locator("#catalog-workspace-root").textContent(), /Каталог недоступен/);
    await page.close();
    await context.close();
  });

  it("links from showcase tab to workspace", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const mocks = createMockController(page, { detailBody: syntheticDetailPayload() });
    await mocks.install();
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await page.click('[data-card-tab="showcase"]');
    await page.waitForSelector(".pc-catalog-workspace-entry a");
    assert.match(await page.locator(".pc-catalog-workspace-entry a").textContent(), /Открыть каталог образцов/);
    await page.close();
    await context.close();
  });
});
