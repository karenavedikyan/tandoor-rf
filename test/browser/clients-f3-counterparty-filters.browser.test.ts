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
const F3_OGRN = "0123456789012";
const F3_COUNTERPARTY = "ООО «Browser F3»";
const F3_FULL_NAME = "Browser Full Legal Name";
const F3_LEGAL_TYPE = "Компания";
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts", "screenshots");

function isPrimaryClientsListGet(url: URL, method: string): boolean {
  return method === "GET" && url.pathname === "/api/clients";
}

describe("clients F3 counterparty filters browser (mock-browser)", { concurrency: false }, () => {
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
          counterparty: {
            counterparty: { hasSource: true, label: F3_COUNTERPARTY, value: F3_COUNTERPARTY },
            fullName: { hasSource: true, label: F3_FULL_NAME, value: F3_FULL_NAME },
            legalEntityType: { hasSource: true, label: F3_LEGAL_TYPE, value: F3_LEGAL_TYPE },
            ogrn: { hasSource: true, label: F3_OGRN, value: F3_OGRN },
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
    await page.waitForSelector("#onec-ogrn-filter:not(.clients-hidden)");
  }

  async function collapseFiltersPanelIfExpanded(page: Page): Promise<void> {
    const toggle = page.locator("#clients-filters-toggle");
    if (!(await toggle.isVisible())) {
      return;
    }
    const expanded = await toggle.getAttribute("aria-expanded");
    if (expanded === "true") {
      await toggle.click();
      await page.waitForFunction(
        () => document.querySelector("#clients-filters-toggle")?.getAttribute("aria-expanded") !== "true",
      );
    }
  }

  async function openCounterpartyDetailsOnCard(page: Page): Promise<void> {
    await page.click("#pc-tab-data");
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    await page.locator("#pc-panel-data summary", { hasText: "Контрагент и реквизиты" }).click();
  }

  async function assertCounterpartyBlockValues(page: Page): Promise<void> {
    const cardText = await page.locator("#pc-panel-data").innerText();
    assert.match(cardText, /Контрагент и реквизиты/);
    assert.match(cardText, new RegExp(F3_COUNTERPARTY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(cardText, new RegExp(F3_FULL_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(cardText, new RegExp(F3_LEGAL_TYPE));
    assert.match(cardText, /ОГРН/);
    assert.match(cardText, new RegExp(F3_OGRN));
  }

  async function runFilterToCardFlow(page: Page): Promise<void> {
    await openFieldFiltersSection(page);
    const listResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      if (!isPrimaryClientsListGet(new URL(response.url()), request.method())) {
        return false;
      }
      return new URL(response.url()).searchParams.get("onecOgrn") === F3_OGRN;
    });
    await page.fill("#onec-ogrn-filter", F3_OGRN);
    await page.locator("#onec-ogrn-filter").press("Tab");
    const listResponse = await listResponsePromise;
    assert.equal(listResponse.status(), 200);
    assert.equal(await page.locator("#onec-ogrn-filter").inputValue(), F3_OGRN);

    await collapseFiltersPanelIfExpanded(page);
    const clientLink = page.getByRole("link", { name: "F3 Synthetic Client" });
    await clientLink.scrollIntoViewIfNeeded();
    await clientLink.click();
    await page.waitForURL(new RegExp("/clients/" + SYNTHETIC_CLIENT_GUID.replace(/-/g, "\\-")));
    await openCounterpartyDetailsOnCard(page);
    await assertCounterpartyBlockValues(page);
  }

  it("desktop mock-browser: filters, card counterparty block, back, reload, reset", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await runFilterToCardFlow(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f3-counterparty-expanded-desktop-1440.png"),
      fullPage: true,
    });

    await page.goBack({ waitUntil: "networkidle" });
    await openFieldFiltersSection(page);

    const reloadListPromise = page.waitForResponse((response) => {
      const request = response.request();
      return (
        isPrimaryClientsListGet(new URL(response.url()), request.method()) &&
        new URL(response.url()).searchParams.get("onecOgrn") === F3_OGRN
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    await reloadListPromise;
    await openFieldFiltersSection(page);
    assert.equal(await page.locator("#onec-ogrn-filter").inputValue(), F3_OGRN);
    assert.match(page.url(), new RegExp(`onecOgrn=${encodeURIComponent(F3_OGRN)}`));

    await page.click("#reset-filters");
    await page.waitForFunction(() => !window.location.search.includes("onecOgrn="));
    assert.equal(await page.locator("#onec-ogrn-filter").inputValue(), "");
    assert.doesNotMatch(state.lastListUrl, /onecOgrn=/);

    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });

  it("mobile mock-browser: filters, card counterparty block, back, reload, reset", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(MOBILE);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await runFilterToCardFlow(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "f3-counterparty-expanded-mobile-390.png"),
      fullPage: true,
    });

    await page.goBack({ waitUntil: "networkidle" });
    await openFieldFiltersSection(page);

    const reloadListPromise = page.waitForResponse((response) => {
      const request = response.request();
      return (
        isPrimaryClientsListGet(new URL(response.url()), request.method()) &&
        new URL(response.url()).searchParams.get("onecOgrn") === F3_OGRN
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    await reloadListPromise;
    await openFieldFiltersSection(page);
    assert.equal(await page.locator("#onec-ogrn-filter").inputValue(), F3_OGRN);

    await page.click("#reset-filters");
    await page.waitForFunction(() => !window.location.search.includes("onecOgrn="));
    assert.equal(await page.locator("#onec-ogrn-filter").inputValue(), "");
    assert.doesNotMatch(state.lastListUrl, /onecOgrn=/);

    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });

  it("mobile mock-browser: clears F3 counterparty filters when switching to outlets", async () => {
    const { page, state, errors } = await setupPage();
    await page.setViewportSize(MOBILE);
    await page.goto(
      `${baseUrl}/clients?view=all&entity=clients&onecOgrn=${encodeURIComponent(F3_OGRN)}&onecLegalEntityType=Компания&onecCounterpartyContains=Browser&filled=onecOgrn&bonusTandoorClub=0`,
      { waitUntil: "networkidle" },
    );
    await openFieldFiltersSection(page);
    assert.equal(await page.locator("#onec-ogrn-filter").inputValue(), F3_OGRN);

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
        !window.location.search.includes("onecOgrn=") &&
        !window.location.search.includes("onecLegalEntityType=") &&
        !window.location.search.includes("onecCounterpartyContains=") &&
        !window.location.search.includes("filled=onecOgrn"),
    );
    assert.match(page.url(), /bonusTandoorClub=0/);
    assert.doesNotMatch(state.lastListUrl, /onecOgrn=/);

    assert.equal(errors.length, 0, errors.join("; "));
    await page.close();
  });
});
