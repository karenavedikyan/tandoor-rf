import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createApp } from "../../src/server";
import { getIntegrationDatabaseUrl, setIntegrationEnv } from "../helpers/test-db";
import { resolveMockResponse, type MockOptions } from "./helpers/clients-api-mocks";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

function createMockController(page: Page, initial: MockOptions = {}) {
  const options: MockOptions = { role: "admin", ...initial };
  let installed = false;
  const state = { listCalls: 0, catalogProductsCalls: 0 };

  async function install(): Promise<void> {
    if (installed) {
      return;
    }
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
    options,
    install,
    set(next: MockOptions) {
      Object.assign(options, next);
    },
  };
}

async function openClientsPage(
  page: Page,
  baseUrl: string,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.goto(`${baseUrl}/clients`);
  assert.equal(page.url().includes("/login"), false);
  await page.waitForSelector("#clients-app:not(.clients-hidden)", { timeout: 60_000 });
  await page.waitForSelector("#onec-update-panel:not(.clients-hidden)", { timeout: 60_000 });
  await page.waitForSelector("[data-testid='onec-update-button']", { timeout: 60_000 });
}

describe("admin clients onec update button browser", () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    setIntegrationEnv(getIntegrationDatabaseUrl(), "http://127.0.0.1:3000");
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

  async function openPage(options: MockOptions = {}): Promise<{ page: Page; context: BrowserContext }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const mock = createMockController(page, { role: "admin", onecUpdatePhase: "completed", ...options });
    await mock.install();
    return { page, context };
  }

  it("shows admin update button and completed status on desktop and mobile", async () => {
    const { page, context } = await openPage({ onecUpdatePhase: "completed" });
    await openClientsPage(page, baseUrl, DESKTOP);
    await page.waitForSelector("[data-testid='onec-update-button']");
    assert.match(await page.locator("[data-testid='onec-update-button']").textContent(), /Обновить из 1С/);
    assert.match(await page.locator("[data-testid='onec-update-status']").textContent(), /Завершено/);
    assert.match(await page.locator("#onec-update-meta").textContent(), /Дата исходной выгрузки/);
    assert.match(await page.locator("#onec-update-meta").textContent(), /Последнее успешное обновление/);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "admin-onec-update-desktop-1440.png"),
      fullPage: true,
    });

    await openClientsPage(page, baseUrl, MOBILE);
    assert.match(await page.locator("[data-testid='onec-update-status']").textContent(), /Завершено/);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "admin-onec-update-mobile-390.png"),
      fullPage: true,
    });
    await page.close();
    await context.close();
  });

  it("hides update panel for manager and admin preview", async () => {
    const managerCtx = await browser.newContext();
    const managerPage = await managerCtx.newPage();
    const managerMock = createMockController(managerPage, { role: "manager", clientsBusinessRole: "manager" });
    await managerMock.install();
    await managerPage.setViewportSize(DESKTOP);
    await managerPage.goto(`${baseUrl}/clients`);
    await managerPage.waitForSelector("#clients-app:not(.clients-hidden)", { timeout: 60_000 });
    assert.equal(await managerPage.locator("#onec-update-panel.clients-hidden").count(), 1);
    await managerPage.close();
    await managerCtx.close();

    const previewCtx = await browser.newContext();
    const previewPage = await previewCtx.newPage();
    const previewMock = createMockController(previewPage, {
      role: "admin",
      previewActive: true,
      onecUpdatePhase: "completed",
    });
    await previewMock.install();
    await previewPage.setViewportSize(DESKTOP);
    await previewPage.goto(`${baseUrl}/clients`);
    await previewPage.waitForSelector("#clients-app:not(.clients-hidden)", { timeout: 60_000 });
    assert.equal(await previewPage.locator("#onec-update-panel.clients-hidden").count(), 1);
    await previewPage.close();
    await previewCtx.close();
  });

  it("shows manifest rejection message and preserved-data note", async () => {
    const { page, context } = await openPage({ onecUpdatePhase: "rejected" });
    await openClientsPage(page, baseUrl, DESKTOP);
    assert.match(
      await page.locator("[data-testid='onec-update-status']").textContent(),
      /1С ещё не передала подтверждение готовности комплекта/,
    );
    assert.match(await page.locator("#onec-update-meta").textContent(), /Прежние данные сохранены/);
    await page.close();
    await context.close();
  });
});
