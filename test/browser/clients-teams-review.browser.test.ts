import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { resolveMockResponse, type MockOptions } from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

describe("clients teams and review browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind browser test server.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("shows team navigation and review tab for admin", async () => {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0 };
    const options: MockOptions = { role: "admin" };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const mock = resolveMockResponse(url, options, state, route.request().method());
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients?view=teams`, { waitUntil: "networkidle" });
    await page.waitForSelector("#view-switcher");
    assert.ok(await page.locator('[data-view="review"]').isVisible());
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-teams-view.png"),
      fullPage: true,
    });

    await page.click('[data-view="review"]');
    await page.waitForSelector("#unassigned-panel");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-review-view.png"),
      fullPage: true,
    });

    await page.close();
  });
});
