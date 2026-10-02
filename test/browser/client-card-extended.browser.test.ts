import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  SYNTHETIC_CLIENT_GUID,
  resolveMockResponse,
  syntheticDetailPayload,
  syntheticExtendedDetailPayload,
} from "./helpers/clients-api-mocks";

describe("client card extended browser (mocked API)", { concurrency: false }, () => {
  let server: http.Server;
  let baseUrl = "";
  let browser: Browser;

  before(async () => {
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

  async function installMocks(
    page: Page,
    detailBody: ReturnType<typeof syntheticExtendedDetailPayload>,
    role: "admin" | "manager" = "admin",
  ): Promise<void> {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const mock = resolveMockResponse(url, { role, detailBody }, { listCalls: 0 }, route.request().method());
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

  async function openClientPage(
    outletAccess: "granted" | "denied",
    viewport = { width: 1440, height: 900 },
    role: "admin" | "manager" = "admin",
  ): Promise<{ page: Page; context: BrowserContext }> {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await installMocks(page, syntheticExtendedDetailPayload(outletAccess), role);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    return { page, context };
  }

  it("renders extended outlets and all-false loading schedule at desktop width", async () => {
    const { page, context } = await openClientPage("granted");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Дни не отмечены/);
    assert.match(text, /09:00/);
    assert.match(text, /Торговая точка 1/);
    assert.match(text, /Торговая точка 2/);
    assert.match(text, /2 точек в текущем снимке/);
    assert.doesNotMatch(text, /Дни приёмки не переданы/);
    await context.close();
  });

  it("shows denied outlet access message for manager mock", async () => {
    const { page, context } = await openClientPage("denied", { width: 390, height: 844 }, "manager");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Недоступны для вашей роли/);
    assert.doesNotMatch(text, /Store street/);
    await context.close();
  });

  it("does not show role denial when extended block is absent", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await installMocks(page, syntheticDetailPayload());
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.doesNotMatch(text, /Недоступны для вашей роли/);
    assert.match(text, /данные не переданы|Данные не переданы/i);
    await context.close();
  });

  it("shows preserved freshness label and honest truncated outlet count", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const detail = syntheticExtendedDetailPayload("granted");
    detail.client.extended.freshnessLabel =
      "Сохранено из предыдущей выгрузки (блок не передан в текущем снимке)";
    detail.client.extended.retailOutletsTotalCount = 25;
    detail.client.extended.retailOutletsTruncated = true;
    detail.client.extended.retailOutlets = [detail.client.extended.retailOutlets[0]!];
    await installMocks(page, detail);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Сохранено из предыдущей выгрузки/);
    assert.match(text, /1 из 25/);
    await context.close();
  });

  it("renders extended data tab in dark theme on mobile", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await installMocks(page, syntheticExtendedDetailPayload("granted"));
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("tandoor-rf-theme", "dark");
    });
    await page.click("#pc-tab-data");
    await page.waitForSelector('[data-testid="pc-outlet-0"]');
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    assert.equal(theme, "dark");
    await context.close();
  });
});
