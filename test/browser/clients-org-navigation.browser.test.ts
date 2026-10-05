import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  NAV_CLIENT_C1,
  NAV_CLIENT_C2,
  NAV_ROP_A,
  NAV_ROP_B,
  resolveMockResponse,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

describe("clients org structure navigation browser", { concurrency: false }, () => {
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

  async function setupPage() {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0, lastListUrl: "" };
    const options: MockOptions = { role: "admin" };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients") {
        state.lastListUrl = url.search;
      }
      const mock = resolveMockResponse(
        url,
        options,
        state,
        route.request().method(),
        route.request().postData() ?? undefined,
      );
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    return { page, state };
  }

  it("opens branch portfolio lists from tree counters with matching query params", async () => {
    const { page, state } = await setupPage();

    await page.goto(`${baseUrl}/clients?view=teams`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-portfolio="clients"]');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-org-navigation-tree.png"),
      fullPage: true,
    });

    await page.click(`[data-portfolio="clients"][data-rop-employee="${NAV_ROP_A}"]`);
    await page.waitForSelector("#clients-table-body tr");
    assert.match(state.lastListUrl, /view=teams/);
    assert.match(state.lastListUrl, new RegExp(`ropEmployee=${NAV_ROP_A}`));
    assert.match(state.lastListUrl, /portfolio=clients/);
    assert.ok(!state.lastListUrl.includes("entity=outlets"));
    await page.waitForFunction(() => {
      const body = document.querySelector("#clients-table-body");
      return body && body.textContent?.includes("Client C1");
    });

    await page.goto(`${baseUrl}/clients?view=teams`, { waitUntil: "networkidle" });
    await page.click(`[data-portfolio="outlets"][data-rop-employee="${NAV_ROP_B}"]`);
    await page.waitForSelector("#clients-table-body tr");
    assert.match(state.lastListUrl, /entity=outlets/);
    assert.match(state.lastListUrl, /portfolio=outlets/);
    assert.match(state.lastListUrl, new RegExp(`ropEmployee=${NAV_ROP_B}`));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-org-navigation-branch-list.png"),
      fullPage: true,
    });

    await page.close();
  });

  it("preserves branch context in URL and restores list after reload", async () => {
    const { page, state } = await setupPage();

    await page.goto(
      `${baseUrl}/clients?view=teams&ropEmployee=${NAV_ROP_A}&portfolio=outlets&entity=outlets`,
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector("#clients-table-body tr");
    assert.match(state.lastListUrl, /portfolio=outlets/);
    await page.waitForFunction(() => {
      const body = document.querySelector("#clients-table-body");
      return body && body.textContent?.includes("Client C1");
    });

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#clients-table-body tr");
    assert.match(page.url(), /portfolio=outlets/);
    assert.match(page.url(), new RegExp(`ropEmployee=${NAV_ROP_A}`));

    await page.close();
  });

  it("switches ROP branch without stale list rows", async () => {
    const { page, state } = await setupPage();

    await page.goto(
      `${baseUrl}/clients?view=teams&ropEmployee=${NAV_ROP_A}&portfolio=clients`,
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector("#clients-table-body tr");
    await page.waitForFunction(() => {
      const body = document.querySelector("#clients-table-body");
      return body && body.textContent?.includes("Client C1");
    });

    await page.goto(
      `${baseUrl}/clients?view=teams&ropEmployee=${NAV_ROP_B}&portfolio=clients`,
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector("#clients-table-body tr");
    assert.match(state.lastListUrl, new RegExp(`ropEmployee=${NAV_ROP_B}`));
    await page.waitForFunction(() => {
      const body = document.querySelector("#clients-table-body");
      return body && body.textContent?.includes("Client C2");
    });
    const bodyText = await page.locator("#clients-table-body").innerText();
    assert.ok(!bodyText.includes("Client C1"));

    await page.close();
  });
});
