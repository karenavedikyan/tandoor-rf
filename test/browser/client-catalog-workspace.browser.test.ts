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

    assert.match(await page.locator(".pc-catalog-outlet-notice").textContent(), /Сохранение дистрибуции/);
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
