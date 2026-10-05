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
  syntheticCatalogProductsPayload,
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

  return {
    state,
    options,
    install,
    set(next: MockOptions) {
      Object.assign(options, next);
    },
  };
}

async function ensureTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const current = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
  if (current === theme) return;
  await page.click("[data-theme-toggle]");
  await page.waitForFunction(
    (expected) => {
      const actual =
        document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      return actual === expected;
    },
    theme,
  );
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
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    fullPage: true,
  });
}

describe("client catalog showcase tab (R3.2, mocked API)", { concurrency: false }, () => {
  let server: http.Server;
  let baseUrl = "";
  let browser: Browser;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function openPage(
    options: MockOptions = {},
  ): Promise<{ page: Page; context: BrowserContext; mocks: ReturnType<typeof createMockController> }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const mocks = createMockController(page, options);
    await mocks.install();
    return { page, context, mocks };
  }

  async function openShowcaseTab(page: Page): Promise<void> {
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await page.click('[data-card-tab="showcase"]');
    await page.waitForSelector("#pc-panel-showcase:not([hidden])");
    await page.waitForSelector("#pc-catalog-showcase :is(.pc-catalog-meta, .pc-catalog-state)");
  }

  it("loads catalog list, missing group note, detail and future-actions notice", async () => {
    const { page, context } = await openPage({
      detailBody: syntheticDetailPayload(),
    });
    await openShowcaseTab(page);

    assert.match(await page.locator("#pc-catalog-showcase .pc-catalog-meta").textContent(), /Снимок каталога/);
    assert.match(await page.locator("#pc-catalog-showcase .pc-catalog-meta").textContent(), /Цены и остатки/);
    assert.match(
      await page.locator("#pc-catalog-showcase .pc-catalog-meta").textContent(),
      /торговую точку/i,
    );

    await page.waitForSelector(".pc-catalog-card");
    assert.match(await page.locator(".pc-catalog-note").textContent(), /Группа не найдена в выгрузке/);
    assert.match(await page.locator(".pc-catalog-card__title").textContent(), /Product one/);
    assert.match(
      await page.locator(".pc-catalog-image--placeholder").first().textContent(),
      /Просмотр изображения пока недоступен/,
    );

    await captureScreenshot(page, "clients-catalog-showcase-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-catalog-showcase-390-light.png", { width: 390, height: 844 }, "light");

    await page.locator('[data-catalog-open="p1"]').click();
    await page.waitForSelector(".pc-catalog-detail");
    assert.match(await page.locator(".pc-catalog-detail h2").first().textContent(), /Product one/);
    assert.doesNotMatch(await page.locator(".pc-catalog-detail").textContent(), /товаров —/);
    assert.match(await page.locator(".pc-catalog-detail .pc-value").first().textContent(), /ghost-group/);
    assert.match(
      await page.locator(".pc-catalog-future").textContent(),
      /торговую точку/i,
    );
    assert.equal(await page.locator(".pc-field .pc-value").filter({ hasText: "Складская" }).count(), 1);

    await captureScreenshot(page, "clients-catalog-detail-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-catalog-detail-390-dark.png", { width: 390, height: 844 }, "dark");

    await page.locator("[data-catalog-back]").click();
    await page.waitForSelector(".pc-catalog-grid");
    assert.match(await page.locator("#pc-catalog-showcase .pc-catalog-meta").textContent(), /Снимок каталога/);
    assert.doesNotMatch(await page.locator("#pc-catalog-showcase").textContent(), /Каталог не импортирован/);

    await closePage(page, context);
  });

  it("preserves search, section filter and meta after returning from detail", async () => {
    const { page, context } = await openPage({ detailBody: syntheticDetailPayload() });
    await openShowcaseTab(page);
    await page.fill('[name="q"]', "Product");
    await page.selectOption('[name="section"]', "s1");
    await page.click('button[type="submit"].pc-catalog-btn');
    await page.waitForSelector(".pc-catalog-card");
    await page.locator('[data-catalog-open="p1"]').click();
    await page.waitForSelector(".pc-catalog-detail");
    await page.locator("[data-catalog-back]").click();
    await page.waitForSelector(".pc-catalog-grid");
    assert.equal(await page.inputValue('[name="q"]'), "Product");
    assert.equal(await page.inputValue('[name="section"]'), "s1");
    assert.match(await page.locator("#pc-catalog-showcase .pc-catalog-meta").textContent(), /Снимок каталога/);
    assert.ok((await page.locator('select[name="section"] option').count()) >= 2);
    await closePage(page, context);
  });

  it("shows version conflict and recovers after refresh", async () => {
    const metaV1 = {
      ...syntheticCatalogMetaPayload(),
      versionId: "11111111-1111-4111-8111-111111111111",
    };
    const { page, context, mocks } = await openPage({
      detailBody: syntheticDetailPayload(),
      catalogMeta: metaV1,
      catalogActiveVersionId: "22222222-2222-4222-8222-222222222222",
    });
    await openShowcaseTab(page);
    await page.waitForSelector('.pc-catalog-state--error');
    assert.match(await page.locator("#pc-catalog-showcase").textContent(), /Каталог обновился/);
    mocks.set({
      catalogMeta: {
        ...metaV1,
        versionId: "22222222-2222-4222-8222-222222222222",
        importedAt: "2026-10-01T13:00:00.000Z",
      },
      catalogActiveVersionId: "22222222-2222-4222-8222-222222222222",
    });
    await page.locator('[data-catalog-action="refresh"]').click();
    await page.waitForSelector(".pc-catalog-grid");
    assert.match(await page.locator("#pc-catalog-showcase .pc-catalog-meta").textContent(), /13:00:00/);
    await closePage(page, context);
  });

  it("retries list after transient network failure", async () => {
    const { page, context } = await openPage({
      detailBody: syntheticDetailPayload(),
      catalogFailProductsOnce: true,
    });
    await openShowcaseTab(page);
    await page.waitForSelector('.pc-catalog-state--error');
    assert.match(await page.locator("#pc-catalog-showcase").textContent(), /Не удалось загрузить каталог/);
    await page.locator('[data-catalog-action="retry-list"]').click();
    await page.waitForSelector(".pc-catalog-grid");
    await closePage(page, context);
  });

  it("ignores stale catalog response after a newer search", async () => {
    const { page, context } = await openPage({ detailBody: syntheticDetailPayload() });
    let resolveSlow: ((value: unknown) => void) | null = null;
    await page.route("**/catalog/products?q=Slow**", async (route) => {
      await new Promise((resolve) => {
        resolveSlow = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...syntheticCatalogProductsPayload(),
          query: "Slow",
          items: [
            {
              code: "stale",
              name: "Stale product must not appear",
              groupStatus: "found",
              sectionNames: [],
              activity: "Y",
            },
          ],
        }),
      });
    });
    await openShowcaseTab(page);
    await page.fill('[name="q"]', "Slow");
    await page.click('button[type="submit"].pc-catalog-btn');
    await page.fill('[name="q"]', "Product");
    await page.click('button[type="submit"].pc-catalog-btn');
    await page.waitForSelector(".pc-catalog-card");
    assert.doesNotMatch(await page.locator(".pc-catalog-grid").textContent(), /Stale product/);
    resolveSlow?.(null);
    await page.waitForTimeout(300);
    assert.doesNotMatch(await page.locator(".pc-catalog-grid").textContent(), /Stale product/);
    await closePage(page, context);
  });

  it("shows empty catalog state without FTP import", async () => {
    const { page, context } = await openPage({
      catalogMeta: {
        state: "empty",
        message: "Активный снимок каталога не найден. Импорт выполняется отдельно.",
        versionId: null,
        productCount: 0,
      },
    });
    await openShowcaseTab(page);
    assert.match(
      await page.locator("#pc-catalog-showcase").textContent(),
      /Активный снимок каталога не найден/,
    );
    await closePage(page, context);
  });

  it("clears catalog metadata when detail 404 follows access revocation", async () => {
    const { page, context, mocks } = await openPage({ detailBody: syntheticDetailPayload() });
    await openShowcaseTab(page);
    await page.waitForSelector(".pc-catalog-card");
    mocks.set({ catalogAccessRevoked: true });
    await page.locator('[data-catalog-open="p1"]').click();
    await page.waitForSelector('.pc-catalog-state--error');
    assert.match(await page.locator("#pc-catalog-showcase").textContent(), /Каталог недоступен для этой карточки/);
    assert.doesNotMatch(await page.locator("#pc-catalog-showcase").textContent(), /Товар не найден/);
    assert.equal(await page.locator(".pc-catalog-meta").count(), 0);
    assert.equal(await page.locator(".pc-catalog-detail").count(), 0);
    await closePage(page, context);
  });

  it("redirects anonymous session away from client card", async () => {
    const { page, context } = await openPage({ role: "anonymous" });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForURL(`**/login**`);
    assert.match(page.url(), /\/login/);
    await closePage(page, context);
  });
});

async function closePage(page: Page, context: BrowserContext): Promise<void> {
  await page.close();
  await context.close();
}
