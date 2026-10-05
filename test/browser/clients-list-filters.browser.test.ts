import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  NAV_CLIENT_C1,
  NAV_ROP_A,
  NAV_ROP_B,
  SYNTHETIC_MANAGER_A,
  resolveMockResponse,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

describe("clients list filters browser", { concurrency: false }, () => {
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

  async function setupPage(optionsFailOnce = false) {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0, lastCompletenessQueueUrl: "", lastListUrl: "" };
    const options: MockOptions = { role: "admin", clientsBusinessRole: "director" };
    let optionsCalls = 0;

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients") {
        state.lastListUrl = url.search;
      }
      if (url.pathname === "/api/clients/options") {
        optionsCalls += 1;
        if (optionsFailOnce && optionsCalls === 1) {
          await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"message":"Temporary"}}' });
          return;
        }
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

    return { page, state, options };
  }

  async function selectComboboxOption(page: Page, inputId: string, label: string) {
    await page.click("#" + inputId);
    await page.locator("#" + inputId.replace("-input", "-list") + " .clients-combobox__option").filter({ hasText: label }).first().click();
  }

  it("applies ROP and manager filters with URL persistence and reset", async () => {
    const { page, state } = await setupPage();

    await page.goto(`${baseUrl}/clients?view=all`, { waitUntil: "networkidle" });
    await page.waitForSelector("#rop-filter-wrap:not(.clients-hidden)");
    const ropFilteredResponse = page.waitForResponse(
      (response) => response.url().includes("/api/clients") && response.url().includes("ropEmployee="),
    );
    await selectComboboxOption(page, "rop-filter-input", "ROP Alpha");
    await ropFilteredResponse;
    assert.match(page.url(), new RegExp(`ropEmployee=${NAV_ROP_A}`));

    const filteredResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients") &&
        response.url().includes("ropEmployee=") &&
        response.url().includes("manager="),
    );
    await selectComboboxOption(page, "manager-filter-input", "Менеджер Иванов");
    await filteredResponse;
    assert.match(state.lastListUrl, new RegExp(`ropEmployee=${NAV_ROP_A}`));
    assert.match(state.lastListUrl, new RegExp(`manager=${SYNTHETIC_MANAGER_A}`));

    await page.click('[data-entity="outlets"]');
    await page.waitForFunction(() => window.location.search.includes("entity=outlets"));
    assert.match(state.lastListUrl, /entity=outlets/);

    await page.reload({ waitUntil: "networkidle" });
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), new RegExp(`ropEmployee=${NAV_ROP_A}`));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-list-active-filters.png"),
      fullPage: true,
    });

    await page.click("#reset-filters");
    await page.waitForFunction(() => !window.location.search.includes("ropEmployee="));
    assert.ok(!state.lastListUrl.includes("ropEmployee="));

    await page.close();
  });

  it("shows options load error with retry", async () => {
    const { page } = await setupPage(true);
    await page.goto(`${baseUrl}/clients?view=all`, { waitUntil: "networkidle" });
    await page.waitForSelector("#retry-init");
    await page.click("#retry-init");
    await page.waitForSelector("#clients-table-body tr");
    await page.close();
  });

  it("hides unsupported outlet filters in completeness view", async () => {
    const { page } = await setupPage();
    await page.goto(`${baseUrl}/clients?view=completeness&entity=outlets`, { waitUntil: "networkidle" });
    await page.waitForSelector("#clients-table-body tr");
    assert.equal(await page.locator("#outlet-status-filter-wrap").isVisible(), false);
    assert.equal(await page.locator("#warehouse-filter-wrap").isVisible(), false);
    assert.equal(await page.locator("#rop-filter-wrap").isVisible(), true);
    await page.close();
  });
});
