import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { resolveMockResponse } from "./helpers/clients-api-mocks";

const RETAIL = "c3000000-0000-4000-8000-000000000001";
const SCREENSHOT_DIR =
  process.env.SHELL_CHROME_SCREENSHOT_DIR ??
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/shell-chrome-parity";

function jsonResponse(status: number, body: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function retailDetailPayload() {
  return {
    entity: {
      guid: RETAIL,
      warehouse: false,
      closed: false,
      type_category: { name_type: "Retail Type", name_category: "Retail Cat" },
      address: { store_address: "Store One Address" },
      managers: { name_manager: "Manager One" },
    },
    holdingLink: { guid: "a1000000-0000-4000-8000-000000000001", name: "Holding One" },
  };
}

describe("shell chrome evidence screenshots", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function installMocks(page: import("playwright").Page, detailBody?: Record<string, unknown>) {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (detailBody && url.pathname === "/api/clients/v3/detail") {
        await route.fulfill(jsonResponse(200, detailBody));
        return;
      }
      const mock = resolveMockResponse(url, { role: "manager", fullName: "Иван Петров" }, {
        listCalls: 0,
        catalogProductsCalls: 0,
      });
      if (mock) {
        await route.fulfill(mock);
        return;
      }
      await route.fulfill(jsonResponse(404, { error: "not mocked" }));
    });
  }

  it("captures desktop and mobile shell plus v3 card tabs", async () => {
    const page = await browser.newPage();
    await installMocks(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(baseUrl + "/clients", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".legacy-topbar__brand");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-1440-clients.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForSelector(".legacy-topbar__logo");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-390-clients-closed.png"), fullPage: false });
    await page.click("#legacy-menu-toggle");
    await page.waitForSelector("#legacy-sidebar.is-open");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-390-menu-open.png"), fullPage: false });
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 320, height: 640 });
    await page.reload();
    await page.waitForSelector(".legacy-topbar__logo");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-320-clients.png"), fullPage: false });

    await installMocks(page, retailDetailPayload());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(baseUrl + "/clients/" + RETAIL + "?v3Entity=retail&cardTab=orders&return=%2Fclients");
    await page.waitForSelector('[data-card-tab="overview"]');
    const tabButtons = await page.locator("[data-card-tab]").allTextContents();
    assert.deepEqual(tabButtons.sort(), ["Данные", "Обзор"].sort());
    assert.doesNotMatch(page.url(), /cardTab=orders/);
    assert.match(page.url(), /return=%2Fclients/);
    await page.waitForFunction(() => {
      const selected = document.querySelector('[data-card-tab="overview"]');
      return selected?.getAttribute("aria-selected") === "true";
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-1440-v3-card-two-tabs.png"), fullPage: false });

    await page.click("[data-theme-toggle]");
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-1440-dark-theme.png"), fullPage: false });

    await page.close();
  });
});
