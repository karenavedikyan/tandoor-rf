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
  syntheticDetailPayload,
  syntheticListPayload,
  syntheticLongDetailPayload,
  syntheticPagedListPayload,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR = "/opt/cursor/artifacts/screenshots";

type MockState = { listCalls: number };

function createMockState(): MockState {
  return { listCalls: 0 };
}

function createMockController(page: Page, initial: MockOptions = {}) {
  const state = createMockState();
  const options: MockOptions = { role: "admin", ...initial };
  let installed = false;

  async function install(): Promise<void> {
    if (installed) {
      return;
    }
    installed = true;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const mock = resolveMockResponse(url, options, state);
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

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((value) => {
    if (value === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, theme);
}

async function captureScreenshot(
  page: Page,
  filename: string,
  viewport: { width: number; height: number },
  theme: "light" | "dark",
): Promise<void> {
  await page.setViewportSize(viewport);
  await setTheme(page, theme);
  await page.waitForTimeout(200);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    fullPage: true,
  });
}

describe("clients workspace browser (R1.4-prep, mocked API)", { concurrency: false }, () => {
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
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
    const page = await context.newPage();
    const mocks = createMockController(page, options);
    await mocks.install();
    return { page, context, mocks };
  }

  async function closePage(page: Page, context: BrowserContext): Promise<void> {
    await page.close();
    await context.close();
  }

  it("loads list with search, filters, sync status and real shell", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients?q=Synthetic`);
    await page.waitForSelector("#clients-app:not(.clients-hidden)");
    await page.waitForSelector(".clients-table tbody tr");
    assert.match(await page.locator("#search-input").inputValue(), /Synthetic/);
    assert.match(await page.locator("#result-count").textContent(), /2/);
    assert.match(await page.locator("#sync-status").textContent(), /Последний импорт в ЛК/);
    assert.ok(await page.locator(".legacy-sidebar").isVisible());
    await closePage(page, context);
  });

  it("resets filters and supports pagination", async () => {
    const { page, context, mocks } = await openPage({
      listBody: syntheticPagedListPayload(1),
    });
    await page.goto(`${baseUrl}/clients?q=alpha&phone=yes&page=1`);
    await page.waitForSelector("#clients-app:not(.clients-hidden)");
    await page.click("#reset-filters");
    await page.waitForFunction(() => {
      const input = document.querySelector("#search-input") as HTMLInputElement | null;
      return input?.value === "";
    });
    assert.equal(await page.locator("#phone-filter").inputValue(), "all");

    mocks.set({ listBody: syntheticPagedListPayload(2) });
    await page.click("#page-next");
    await page.waitForFunction(() => window.location.search.includes("page=2"));
    assert.match(await page.textContent("#pagination"), /Страница 2/);
    await closePage(page, context);
  });

  it("opens card and returns to list preserving query", async () => {
    const { page, context } = await openPage();
    const returnQuery = encodeURIComponent("?q=Synthetic&page=1");
    await page.goto(`${baseUrl}/clients?q=Synthetic&page=1`);
    await page.waitForSelector(".clients-table tbody tr a.clients-link");
    await page.click(".clients-table tbody tr a.clients-link");
    await page.waitForURL(`**/clients/${SYNTHETIC_CLIENT_GUID}**`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    assert.match(await page.locator("#client-name").textContent(), /Synthetic Client Alpha/);
    assert.match(await page.locator("#client-loaded-at").textContent(), /28.09.2026, 12:30/);
    assert.match(await page.locator("#client-source-updated").textContent(), /не передано/);
    await page.click('a.workspace-button--ghost:has-text("К списку")');
    await page.waitForURL(`**/clients?q=Synthetic**`);
    assert.doesNotMatch(await page.textContent("#access-panel"), /Нет доступа/);
    await closePage(page, context);
  });

  it("handles address copy, empty address, and phone copy controls", async () => {
    const { page, context, mocks } = await openPage();
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await page.waitForSelector("#copy-address:not([hidden])");
    await page.click("#copy-address");
    await page.waitForFunction(() => {
      const el = document.getElementById("copy-address-status");
      return Boolean(el?.textContent?.trim());
    });
    assert.match(await page.textContent("#copy-address-status"), /скопирован|Не удалось/i);

    mocks.set({ detailBody: syntheticDetailPayload({ address: "   " }) });
    await page.reload();
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    assert.match(await page.locator("#client-address").textContent(), /Адрес не указан/);
    assert.equal(
      await page.locator("#copy-address").evaluate((el) => (el as HTMLButtonElement).hidden),
      true,
    );

    mocks.set({ detailBody: syntheticDetailPayload() });
    await page.reload();
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    const phoneRow = page.locator(".client-detail-phone-row").first();
    await phoneRow.waitFor({ state: "visible" });
    assert.match(await phoneRow.textContent(), /\+7/);
    assert.ok(await phoneRow.locator('button:has-text("Копировать")').isVisible());
    await closePage(page, context);
  });

  it("expands technical block and handles retry plus missing client", async () => {
    const { page, context, mocks } = await openPage({ failListOnce: true });
    const state = mocks.state;
    await page.goto(`${baseUrl}/clients`);
    await page.waitForSelector('#results-state[data-state="error"]');
    await page.click("#retry-load");
    await page.waitForSelector(".clients-table tbody tr");
    assert.ok(state.listCalls >= 2);

    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector('[data-testid="section-tech"] summary');
    await page.click('[data-testid="section-tech"] summary');
    await page.waitForSelector("#client-uuid");
    assert.match(await page.locator("#client-uuid").textContent(), /11111111/);

    mocks.set({ detailStatus: 404, detailBody: { error: { message: "Not found" } } });
    await page.goto(`${baseUrl}/clients/00000000-0000-4000-8000-000000000001`);
    await page.waitForSelector('#state-panel[data-state="info"]');
    assert.match(await page.textContent("#state-panel"), /не найден/i);
    await closePage(page, context);
  });

  it("shows forbidden access for non-admin and keeps keyboard focus on search", async () => {
    const { page, context } = await openPage({ role: "manager" });
    await page.goto(`${baseUrl}/clients`);
    await page.waitForSelector('#access-panel[data-state="forbidden"]');
    assert.match(await page.textContent("#access-panel"), /Нет доступа/);
    await closePage(page, context);

    const adminPage = await openPage({ role: "admin" });
    await adminPage.page.goto(`${baseUrl}/clients`);
    await adminPage.page.waitForSelector("#search-input");
    await adminPage.page.focus("#search-input");
    const focused = await adminPage.page.evaluate(() => document.activeElement?.id);
    assert.equal(focused, "search-input");
    await closePage(adminPage.page, adminPage.context);
  });

  it("captures eight real UI screenshots on synthetic mocked data", async () => {
    const { page, context, mocks } = await openPage();
    await page.goto(`${baseUrl}/clients?q=Synthetic`);
    await page.waitForSelector("#clients-app:not(.clients-hidden)");
    await page.waitForSelector(".legacy-sidebar");
    await captureScreenshot(page, "clients-list-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-list-1440-dark.png", { width: 1440, height: 900 }, "dark");
    await captureScreenshot(page, "clients-list-390-light.png", { width: 390, height: 844 }, "light");
    await captureScreenshot(page, "clients-list-390-dark.png", { width: 390, height: 844 }, "dark");

    mocks.set({ detailBody: syntheticLongDetailPayload() });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}?return=${encodeURIComponent("?q=Synthetic")}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await captureScreenshot(page, "clients-detail-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-detail-1440-dark.png", { width: 1440, height: 900 }, "dark");
    await captureScreenshot(page, "clients-detail-390-light.png", { width: 390, height: 844 }, "light");
    await captureScreenshot(page, "clients-detail-390-dark.png", { width: 390, height: 844 }, "dark");

    for (const name of [
      "clients-list-1440-light.png",
      "clients-list-1440-dark.png",
      "clients-list-390-light.png",
      "clients-list-390-dark.png",
      "clients-detail-1440-light.png",
      "clients-detail-1440-dark.png",
      "clients-detail-390-light.png",
      "clients-detail-390-dark.png",
    ]) {
      assert.ok(fs.existsSync(path.join(SCREENSHOT_DIR, name)), `missing screenshot ${name}`);
    }
    await closePage(page, context);
  });
});
