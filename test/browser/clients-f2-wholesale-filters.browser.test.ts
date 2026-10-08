import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  SYNTHETIC_CLIENT_GUID,
  resolveMockResponse,
  syntheticDetailPayload,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts", "screenshots");

function isPrimaryClientsListGet(url: URL, method: string): boolean {
  return method === "GET" && url.pathname === "/api/clients";
}

describe("clients F2 wholesale filters browser", { concurrency: false }, () => {
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
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function setupPage(extraOptions: MockOptions = {}) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) {
        errors.push(`HTTP ${response.status()} ${response.url()}`);
      }
    });

    const state = { listCalls: 0, catalogProductsCalls: 0, lastListUrl: "" };
    const options: MockOptions = {
      role: "admin",
      clientsBusinessRole: "director",
      detailBody: syntheticDetailPayload({
        extended: {
          formatVersion: "extended_v1",
          wholesaleExchange: {
            top150: { hasSource: true, label: "Нет", value: "Нет" },
            outletCategory: { hasSource: true, label: "SYNTH-UNKNOWN", value: "SYNTH-UNKNOWN" },
          },
          retailOutlets: [],
          retailOutletsTotalCount: 0,
          retailOutletsAccess: "granted",
          retailOutletsEmptyReason: "empty_snapshot",
          dataQualityLabel: "Частично подключено",
        },
      }),
      ...extraOptions,
    };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients") {
        state.listCalls += 1;
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

    return { page, state, errors };
  }

  async function ensureFiltersPanelExpanded(page: Page): Promise<void> {
    const toggle = page.locator("#clients-filters-toggle");
    if (await toggle.isVisible()) {
      const expanded = await toggle.getAttribute("aria-expanded");
      if (expanded !== "true") {
        await toggle.click();
        await page.waitForSelector("#clients-filters-panel.clients-filters-panel--expanded");
      }
    }
  }

  async function openFieldFiltersSection(page: Page): Promise<void> {
    await ensureFiltersPanelExpanded(page);
    const summary = page.locator("#field-filters-wrap > summary");
    await summary.click();
    await page.waitForSelector("#onec-category-filter:not(.clients-hidden)");
  }

  it("desktop: filter select, list 200, card fields, back, reload, reset", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await openFieldFiltersSection(page);

    const listResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      if (!isPrimaryClientsListGet(new URL(response.url()), request.method())) {
        return false;
      }
      return new URL(response.url()).searchParams.get("onecCategory") === "SYNTH-UNKNOWN";
    });
    await page.selectOption("#onec-category-filter", "SYNTH-UNKNOWN");
    const listResponse = await listResponsePromise;
    assert.equal(listResponse.status(), 200);
    assert.equal(await page.locator("#onec-category-filter").inputValue(), "SYNTH-UNKNOWN");

    await page.locator(`a.clients-link[href*='/clients/${SYNTHETIC_CLIENT_GUID}']`).first().click();
    await page.waitForURL(new RegExp("/clients/" + SYNTHETIC_CLIENT_GUID.replace(/-/g, "\\-")));
    await page.click("#pc-tab-data");
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    const cardText = await page.locator("#pc-panel-data").innerText();
    assert.match(cardText, /ТОП-150 \(1С\)/);
    assert.match(cardText, /Категория 1С/);
    assert.match(cardText, /SYNTH-UNKNOWN/);

    await page.goBack({ waitUntil: "networkidle" });
    await openFieldFiltersSection(page);

    const reloadListPromise = page.waitForResponse((response) => {
      const request = response.request();
      return (
        isPrimaryClientsListGet(new URL(response.url()), request.method()) &&
        new URL(response.url()).searchParams.get("onecCategory") === "SYNTH-UNKNOWN"
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    await reloadListPromise;
    await openFieldFiltersSection(page);
    assert.equal(await page.locator("#onec-category-filter").inputValue(), "SYNTH-UNKNOWN");
    assert.match(page.url(), /onecCategory=SYNTH-UNKNOWN/);

    await page.click("#reset-filters");
    await page.waitForFunction(() => !window.location.search.includes("onecCategory="));
    assert.equal(await page.locator("#onec-category-filter").inputValue(), "");
    assert.doesNotMatch(state.lastListUrl, /onecCategory=/);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f2-wholesale-filters-desktop-1440.png"),
      fullPage: true,
    });
    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });

  it("desktop: exact category keeps leading and trailing spaces in URL and reload", async () => {
    const { page, errors } = await setupPage();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await openFieldFiltersSection(page);

    const listResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isPrimaryClientsListGet(url, response.request().method()) &&
        url.searchParams.get("onecCategory") === " D "
      );
    });
    await page.selectOption("#onec-category-filter", " D ");
    const listResponse = await listResponsePromise;
    assert.equal(listResponse.status(), 200);
    assert.equal(await page.locator("#onec-category-filter").inputValue(), " D ");
    assert.equal(new URL(page.url()).searchParams.get("onecCategory"), " D ");

    const reloadListPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isPrimaryClientsListGet(url, response.request().method()) &&
        url.searchParams.get("onecCategory") === " D "
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    await reloadListPromise;
    await openFieldFiltersSection(page);
    assert.equal(await page.locator("#onec-category-filter").inputValue(), " D ");

    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });

  it("mobile: clears wholesale exact and filled/empty when switching to outlets", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(MOBILE);
    await page.goto(
      `${baseUrl}/clients?view=all&entity=clients&onecTop150=%D0%9D%D0%B5%D1%82&filled=onecTop150&bonusTandoorClub=0`,
      { waitUntil: "networkidle" },
    );
    await openFieldFiltersSection(page);
    assert.equal(await page.locator("#onec-top150-filter").inputValue(), "Нет");

    const outletListPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isPrimaryClientsListGet(url, response.request().method()) &&
        url.searchParams.get("entity") === "outlets"
      );
    });
    await page.click('#entity-switcher [data-entity="outlets"]');
    await outletListPromise;

    await page.waitForFunction(
      () =>
        window.location.search.includes("entity=outlets") &&
        !window.location.search.includes("onecTop150=") &&
        !window.location.search.includes("filled=onecTop150"),
    );
    assert.match(page.url(), /bonusTandoorClub=0/);
    assert.doesNotMatch(page.url(), /onecTop150=/);
    assert.doesNotMatch(state.lastListUrl, /onecTop150=/);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f2-wholesale-filters-mobile-390.png"),
      fullPage: true,
    });
    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });
});
