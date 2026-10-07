import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { getIntegrationDatabaseUrl, setIntegrationEnv } from "../helpers/test-db";
import {
  NAV_CLIENT_C1,
  NAV_ROP_A,
  resolveMockResponse,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

describe("sprint1 teams navigation browser", () => {
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

  it("navigates team → employee → list → card → back → reload", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const options: MockOptions = { role: "rop", clientsBusinessRole: "rop" };
    const state = { listCalls: 0, catalogProductsCalls: 0, lastListUrl: "" };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients") {
        state.lastListUrl = url.search;
      }
      const mock = resolveMockResponse(url, options, state, route.request().method());
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=teams`, { waitUntil: "networkidle" });
    await page.waitForSelector(".clients-compact-team-list, [data-portfolio='clients']");

    const portfolioBtn = page.locator(
      `[data-portfolio='clients'][data-rop-employee='${NAV_ROP_A}']`,
    );
    if ((await portfolioBtn.count()) > 0) {
      await portfolioBtn.first().click();
    } else {
      await page.locator(".clients-compact-team__summary").first().click();
    }
    await page.waitForSelector("#clients-table-body tr, #clients-cards .clients-card");

    const managerLink = page.locator(".clients-compact-team__count").first();
    if ((await managerLink.count()) > 0) {
      await managerLink.click();
      await page.waitForSelector("#clients-table-body tr, #clients-cards .clients-card");
    }

    await page.locator(`a.clients-link[href*='/clients/${NAV_CLIENT_C1}']`).first().click();
    await page.waitForURL(new RegExp("/clients/" + NAV_CLIENT_C1.replace(/-/g, "\\-")));
    await page.waitForSelector("#client-card-root, .pc-tabs, #clients-app");
    assert.match(await page.content(), /Менеджер клиента|Client/);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "sprint1-team-card-desktop-1440.png"),
      fullPage: true,
    });

    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForSelector("#clients-table-body tr, #clients-cards .clients-card");
    assert.match(page.url(), /view=teams/);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#clients-table-body tr, #clients-cards .clients-card");
    assert.match(page.url(), /view=teams/);

    await page.setViewportSize(MOBILE);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "sprint1-team-list-mobile-390.png"),
      fullPage: true,
    });

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    });
    assert.equal(overflow, false);

    await page.close();
    await context.close();
  });
});
