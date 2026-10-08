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
const F5_CODE = "0012345-Browser-F5";
const F5_FILTER_NEEDLE = "Browser-F5";
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts", "screenshots");

function isPrimaryClientsListGet(url: URL, method: string): boolean {
  return method === "GET" && url.pathname === "/api/clients";
}

describe("clients F5 code filters browser (mock-browser)", { concurrency: false }, () => {
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
          clientCode: {
            code1c: { hasSource: true, label: F5_CODE, value: F5_CODE },
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
    await page.waitForSelector("#onec-code1c-contains-filter:not(.clients-hidden)");
  }

  async function enableCode1cColumn(page: Page): Promise<void> {
    await page.click("#columns-picker-btn");
    await page.waitForSelector("#columns-picker:not(.clients-hidden)");
    const checkbox = page.locator('input[data-column-id="code1c"]');
    if (!(await checkbox.isChecked())) {
      const listResponsePromise = page.waitForResponse((response) => {
        const request = response.request();
        return isPrimaryClientsListGet(new URL(response.url()), request.method());
      });
      await checkbox.check();
      await listResponsePromise;
    }
    await page.click("#columns-picker-btn");
  }

  async function openCodeOnCard(page: Page): Promise<void> {
    await page.click("#pc-tab-data");
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    const details = page
      .locator("#pc-panel-data details.pc-details")
      .filter({ has: page.locator("summary", { hasText: "Основные сведения и холдинг" }) });
    const isOpen = await details.evaluate((el) => el.hasAttribute("open"));
    if (!isOpen) {
      await details.locator("summary").click();
    }
    await page.getByText("Код 1С", { exact: true }).first().waitFor({ state: "visible" });
  }

  async function assertCodeOnCard(page: Page): Promise<void> {
    const cardText = await page.locator("#pc-panel-data").innerText();
    assert.match(cardText, /Код 1С/);
    assert.match(cardText, new RegExp(F5_CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  async function assertListCodeColumnCell(page: Page, expectedCode: string): Promise<void> {
    const header = page.locator('th[data-column="code1c"]');
    await header.waitFor({ state: "attached" });
    const columnIndex = await header.evaluate((el) => {
      const row = el.parentElement;
      if (!row) {
        return -1;
      }
      return Array.from(row.children).indexOf(el);
    });
    assert.ok(columnIndex >= 0);
    const dataRow = page.locator("tbody tr").filter({
      has: page.getByRole("link", { name: "F5 Synthetic Client" }),
    });
    const cellText = await dataRow.locator("td").nth(columnIndex).evaluate((el) => el.textContent?.trim() ?? "");
    assert.equal(cellText, expectedCode);
  }

  async function assertMobileCardCodeLine(page: Page, expectedCode: string): Promise<void> {
    const line = page.locator(".clients-card__line", { hasText: "Код 1С:" });
    await line.first().waitFor({ state: "attached" });
    const text = await line.first().innerText();
    assert.match(text, new RegExp(expectedCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  async function runFilterToCardFlow(page: Page): Promise<import("playwright").Response> {
    await enableCode1cColumn(page);
    await openFieldFiltersSection(page);
    const listResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      if (!isPrimaryClientsListGet(new URL(response.url()), request.method())) {
        return false;
      }
      return new URL(response.url()).searchParams.get("onecCode1cContains") === F5_FILTER_NEEDLE;
    });
    await page.fill("#onec-code1c-contains-filter", F5_FILTER_NEEDLE);
    await page.locator("#onec-code1c-contains-filter").press("Tab");
    const listResponse = await listResponsePromise;
    assert.equal(listResponse.status(), 200);
    const listBody = (await listResponse.json()) as {
      items: Array<{ code1c?: { label: string; value: string } }>;
    };
    assert.equal(listBody.items[0]?.code1c?.label, F5_CODE);
    assert.equal(listBody.items[0]?.code1c?.value, F5_CODE);
    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 500) {
      await assertMobileCardCodeLine(page, F5_CODE);
    } else {
      await assertListCodeColumnCell(page, F5_CODE);
    }

    const clientLink = page.getByRole("link", { name: "F5 Synthetic Client" }).first();
    await clientLink.scrollIntoViewIfNeeded();
    await clientLink.click();
    await page.waitForURL(new RegExp("/clients/" + SYNTHETIC_CLIENT_GUID.replace(/-/g, "\\-")));
    await openCodeOnCard(page);
    await assertCodeOnCard(page);
    return listResponse;
  }

  it("desktop mock-browser: column, filter, card code, back, reload, reset", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await runFilterToCardFlow(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f5-code-card-desktop-1440.png"),
      fullPage: true,
    });

    await page.goBack({ waitUntil: "networkidle" });
    await openFieldFiltersSection(page);
    const reloadListPromise = page.waitForResponse((response) => {
      const request = response.request();
      const url = new URL(response.url());
      return (
        isPrimaryClientsListGet(url, request.method()) &&
        url.searchParams.get("onecCode1cContains") === F5_FILTER_NEEDLE &&
        response.status() === 200
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    const reloadListResponse = await reloadListPromise;
    assert.equal(reloadListResponse.status(), 200);
    await openFieldFiltersSection(page);
    assert.equal(await page.locator("#onec-code1c-contains-filter").inputValue(), F5_FILTER_NEEDLE);
    await assertListCodeColumnCell(page, F5_CODE);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f5-code-list-column-desktop-1440.png"),
      fullPage: true,
    });

    await page.click("#reset-filters");
    await page.waitForFunction(() => !window.location.search.includes("onecCode1cContains="));
    assert.doesNotMatch(state.lastListUrl, /onecCode1cContains=/);
    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });

  it("mobile mock-browser: column, filter, card code, back, reload, reset", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(MOBILE);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await runFilterToCardFlow(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f5-code-card-mobile-390.png"),
      fullPage: true,
    });

    await page.goBack({ waitUntil: "networkidle" });
    await openFieldFiltersSection(page);
    const reloadListPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isPrimaryClientsListGet(url, response.request().method()) &&
        url.searchParams.get("onecCode1cContains") === F5_FILTER_NEEDLE &&
        response.status() === 200
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    await reloadListPromise;
    await enableCode1cColumn(page);
    await assertMobileCardCodeLine(page, F5_CODE);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f5-code-list-column-mobile-390.png"),
      fullPage: true,
    });
    await openFieldFiltersSection(page);
    await page.click("#reset-filters");
    await page.waitForFunction(() => !window.location.search.includes("onecCode1cContains="));
    assert.doesNotMatch(state.lastListUrl, /onecCode1cContains=/);
    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });

  it("mobile mock-browser: clears F5 code filters when switching to outlets but keeps outlet filter", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(MOBILE);
    await page.goto(
      `${baseUrl}/clients?view=all&entity=clients&onecCode1cContains=Browser-F5&onecCode1c=0012345&filled=code1c&bonusTandoorClub=0`,
      { waitUntil: "networkidle" },
    );
    await openFieldFiltersSection(page);

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
        !window.location.search.includes("onecCode1cContains=") &&
        !window.location.search.includes("onecCode1c=") &&
        !window.location.search.includes("filled=code1c"),
    );
    assert.match(page.url(), /bonusTandoorClub=0/);
    assert.doesNotMatch(state.lastListUrl, /onecCode1cContains=/);
    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });
});
