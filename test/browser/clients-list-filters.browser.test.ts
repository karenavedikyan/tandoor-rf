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
  syntheticOptionsPayload,
  resolveMockResponse,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

type ListRouteState = {
  listCalls: number;
  catalogProductsCalls: number;
  lastCompletenessQueueUrl: string;
  lastListUrl: string;
};

async function waitForResetListState(
  state: ListRouteState,
  callsBeforeReset: number,
): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (
      state.listCalls > callsBeforeReset &&
      !state.lastListUrl.includes("ropEmployee=") &&
      !state.lastListUrl.includes("clientRopEmployee=") &&
      !state.lastListUrl.includes("manager=") &&
      !state.lastListUrl.includes("clientManager=")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(
    `reset list state not reached; calls=${state.listCalls} before=${callsBeforeReset} lastListUrl=${state.lastListUrl}`,
  );
}

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
    const state: ListRouteState = {
      listCalls: 0,
      catalogProductsCalls: 0,
      lastCompletenessQueueUrl: "",
      lastListUrl: "",
    };
    const options: MockOptions = { role: "admin", clientsBusinessRole: "director" };
    let optionsCalls = 0;

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients") {
        state.listCalls += 1;
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

  async function ensureFiltersPanelExpanded(page: Page): Promise<void> {
    const toggle = page.locator("#clients-filters-toggle");
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForSelector("#clients-filters-panel.clients-filters-panel--expanded");
    }
  }

  async function comboboxOptionLabels(page: Page, inputId: string): Promise<string[]> {
    await ensureFiltersPanelExpanded(page);
    await page.click("#" + inputId);
    await page.waitForSelector("#" + inputId.replace("-input", "-list") + ":not(.clients-hidden)");
    const labels = await page
      .locator("#" + inputId.replace("-input", "-list") + " .clients-combobox__option")
      .allTextContents();
    await page.keyboard.press("Escape");
    return labels.map((label) => label.trim()).filter(Boolean);
  }

  it("applies ROP and manager filters with URL persistence and reset", async () => {
    const { page, state } = await setupPage();

    await page.goto(`${baseUrl}/clients?view=all`, { waitUntil: "networkidle" });
    await page.waitForSelector("#rop-filter-wrap:not(.clients-hidden)");
    const ropFilteredResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients") &&
        (response.url().includes("clientRopEmployee=") || response.url().includes("ropEmployee=")),
    );
    await selectComboboxOption(page, "rop-filter-input", "ROP Alpha");
    await ropFilteredResponse;
    assert.match(page.url(), new RegExp(`(clientRopEmployee|ropEmployee)=${NAV_ROP_A}`));

    const filteredResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients") &&
        (response.url().includes("clientRopEmployee=") || response.url().includes("ropEmployee=")) &&
        (response.url().includes("clientManager=") || response.url().includes("manager=")),
    );
    await selectComboboxOption(page, "manager-filter-input", "Менеджер Иванов");
    await filteredResponse;
    assert.match(state.lastListUrl, new RegExp(`(clientRopEmployee|ropEmployee)=${NAV_ROP_A}`));
    assert.match(state.lastListUrl, new RegExp(`(clientManager|manager)=${SYNTHETIC_MANAGER_A}`));

    await page.click('[data-entity="outlets"]');
    await page.waitForFunction(() => window.location.search.includes("entity=outlets"));
    assert.match(state.lastListUrl, /entity=outlets/);

    await page.reload({ waitUntil: "networkidle" });
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), new RegExp(`(outletRopEmployee|ropEmployee)=${NAV_ROP_A}`));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-list-active-filters.png"),
      fullPage: true,
    });

    const listCallsBeforeReset = state.listCalls;
    await page.click("#reset-filters");
    await page.waitForFunction(
      () =>
        !window.location.search.includes("ropEmployee=") &&
        !window.location.search.includes("clientRopEmployee="),
    );
    await waitForResetListState(state, listCallsBeforeReset);
    assert.equal(await page.locator("#rop-filter-input").inputValue(), "");
    assert.equal(await page.locator("#manager-filter-input").inputValue(), "");
    await page.waitForSelector("#clients-table-body tr");

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

  it("applies hardware filter with entity labels, card navigation and mobile reload", async () => {
    const { page, state } = await setupPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/clients?view=all`, { waitUntil: "networkidle" });
    await page.waitForSelector("#hardware-filter-wrap:not(.clients-hidden)");
    assert.match(await page.locator("#hardware-filter-label").textContent(), /клиента/);

    const hardwareFiltered = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients") &&
        (response.url().includes("clientHardwareManager=") || response.url().includes("hardwareManager=")),
    );
    await selectComboboxOption(page, "hardware-filter-input", "Hardware Lead");
    await hardwareFiltered;
    assert.match(
      page.url(),
      /(clientHardwareManager|hardwareManager)=77777777-7777-4777-8777-777777777777/,
    );

    await page.click('[data-entity="outlets"]');
    await page.waitForFunction(() => window.location.search.includes("entity=outlets"));
    assert.match(await page.locator("#hardware-filter-label").textContent(), /ТТ/);

    const firstClientLink = page.locator("#clients-table-body tr a").first();
    await firstClientLink.click();
    await page.waitForURL(/\/clients\//);
    await page.goBack({ waitUntil: "networkidle" });
    assert.match(page.url(), /(clientHardwareManager|outletHardwareManager|hardwareManager)=/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.click("#clients-filters-toggle");
    await page.waitForSelector("#clients-filters-panel.clients-filters-panel--expanded");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-sprint2-filters-mobile-390.png"),
      fullPage: true,
    });
    await page.click("#reset-filters");
    await page.waitForFunction(
      () =>
        !window.location.search.includes("hardwareManager=") &&
        !window.location.search.includes("clientHardwareManager=") &&
        !window.location.search.includes("outletHardwareManager="),
    );
    assert.equal(await page.locator("#hardware-filter-input").inputValue(), "");
    await page.close();
  });

  it("routes manager combobox options by entity and keeps outlet manager filter scoped", async () => {
    const { page } = await setupPage();
    await page.setViewportSize({ width: 1280, height: 720 });

    const optionsLoaded = page.waitForResponse(
      (response) => response.url().includes("/api/clients/options") && response.status() === 200,
    );
    await page.goto(`${baseUrl}/clients?view=all`, { waitUntil: "networkidle" });
    await optionsLoaded;
    await page.waitForSelector("#clients-table-body tr");
    await ensureFiltersPanelExpanded(page);
    await page.waitForSelector("#manager-filter-wrap:not(.clients-hidden)");
    await page.waitForSelector("#outlet-manager-filter-wrap:not(.clients-hidden)");

    function hasOption(labels: string[], text: string): boolean {
      return labels.some((label) => label.includes(text));
    }

    const clientManagerLabels = await comboboxOptionLabels(page, "manager-filter-input");
    assert.ok(hasOption(clientManagerLabels, "Менеджер Иванов"));
    assert.equal(hasOption(clientManagerLabels, "Менеджер ТТ Петров"), false);

    const outletManagerLabels = await comboboxOptionLabels(page, "outlet-manager-filter-input");
    assert.ok(hasOption(outletManagerLabels, "Менеджер ТТ Петров"));
    assert.equal(hasOption(outletManagerLabels, "Менеджер Иванов"), false);

    await page.click('[data-entity="outlets"]');
    await page.waitForFunction(() => window.location.search.includes("entity=outlets"));
    await page.waitForSelector("#clients-table-body tr");

    const outletsManagerLabels = await comboboxOptionLabels(page, "manager-filter-input");
    assert.ok(hasOption(outletsManagerLabels, "Менеджер ТТ Петров"));
    assert.equal(hasOption(outletsManagerLabels, "Менеджер Иванов"), false);

    await page.close();

    const emptyOutletPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const emptyState: ListRouteState = {
      listCalls: 0,
      catalogProductsCalls: 0,
      lastCompletenessQueueUrl: "",
      lastListUrl: "",
    };
    const emptyOptions: MockOptions = {
      role: "admin",
      clientsBusinessRole: "director",
      optionsPayload: syntheticOptionsPayload({ outletManagers: [] }),
    };

    await emptyOutletPage.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients") {
        emptyState.listCalls += 1;
        emptyState.lastListUrl = url.search;
      }
      const mock = resolveMockResponse(
        url,
        emptyOptions,
        emptyState,
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

    const emptyOptionsLoaded = emptyOutletPage.waitForResponse(
      (response) => response.url().includes("/api/clients/options") && response.status() === 200,
    );
    await emptyOutletPage.goto(`${baseUrl}/clients?view=all`, { waitUntil: "networkidle" });
    await emptyOptionsLoaded;
    await ensureFiltersPanelExpanded(emptyOutletPage);
    await emptyOutletPage.waitForSelector("#outlet-manager-filter-wrap:not(.clients-hidden)");

    const emptyOutletManagerLabels = await comboboxOptionLabels(
      emptyOutletPage,
      "outlet-manager-filter-input",
    );
    assert.equal(
      emptyOutletManagerLabels.some((label) => label.includes("Менеджер Иванов")),
      false,
    );

    await emptyOutletPage.close();
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
