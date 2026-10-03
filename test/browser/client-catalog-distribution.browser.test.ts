import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import {
  SYNTHETIC_CLIENT_GUID,
  syntheticCatalogMetaPayload,
  syntheticCatalogProductsPayload,
  syntheticDetailPayload,
} from "./helpers/clients-api-mocks";

const STORE_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const STORE_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function metaForStore(storeGuid: string, enabled: boolean) {
  const base = syntheticCatalogMetaPayload();
  return {
    ...base,
    outlets: [
      {
        guidStore: STORE_A,
        guidClient: SYNTHETIC_CLIENT_GUID,
        displayName: "Store A",
        storeAddress: "Store A address",
        guidStoreShortLabel: "cccc…ccc1",
        closureStatus: "open",
        closureStatusLabel: "Открыта",
        presentInCurrentExport: true,
        distributionWritable: true,
        distributionBlockedReason: null,
      },
      {
        guidStore: STORE_B,
        guidClient: SYNTHETIC_CLIENT_GUID,
        displayName: "Store B",
        storeAddress: "Store B address",
        guidStoreShortLabel: "dddd…dddd",
        closureStatus: "open",
        closureStatusLabel: "Открыта",
        presentInCurrentExport: true,
        distributionWritable: true,
        distributionBlockedReason: null,
      },
    ],
    selectedStoreGuid: storeGuid,
    outletConfirmed: enabled,
    distributionEnabled: enabled,
    selectionPersisted: false,
    futureActionsBlockedReason: enabled
      ? null
      : "Выберите торговую точку, чтобы сохранять дистрибуцию по образцам.",
  };
}

describe("client catalog distribution writes (browser, mocked API)", { concurrency: false }, () => {
  let server: http.Server;
  let baseUrl = "";
  let browser: Browser;

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  async function openDistributionPage(
    routeHandler: (
      url: URL,
      method: string,
      markerState: { installed: boolean; planned: boolean; saveCount: number },
    ) => Promise<{ status: number; body: unknown } | null>,
  ) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const markerState = {
      installed: false,
      planned: false,
      saveCount: 0,
    };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/me") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ user: { role: "admin", email: "admin@test", fullName: "Admin" } }),
        });
        return;
      }
      if (url.pathname === `/api/clients/${SYNTHETIC_CLIENT_GUID}`) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(syntheticDetailPayload()),
        });
        return;
      }
      const mock = await routeHandler(url, route.request().method(), markerState);
      if (mock) {
        await route.fulfill({
          status: mock.status,
          contentType: "application/json",
          body: JSON.stringify(mock.body),
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not mocked"}' });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}/catalog`);
    await page.waitForSelector("#catalog-workspace-app:not(.clients-hidden)");
    await page.waitForSelector("[data-catalog-outlet-select]");
    await page.waitForSelector(".pc-catalog-workspace-layout");
    return { page, context, markerState };
  }

  it("persists outlet selection and marker state across reload", async () => {
    let selected = "";
    const { page, context, markerState } = await openDistributionPage(async (url, method, markerState) => {
      if (url.pathname.endsWith("/catalog/meta")) {
        const requested = url.searchParams.get("storeGuid") ?? selected;
        if (requested) selected = requested;
        return { status: 200, body: metaForStore(selected, Boolean(selected)) };
      }
      if (url.pathname.endsWith("/catalog/sections-tree")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, tree: [] } };
      }
      if (url.pathname.endsWith("/catalog/facets")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, total: 0, facets: [] } };
      }
      if (url.pathname.endsWith("/catalog/products")) {
        const products = syntheticCatalogProductsPayload();
        products.items[0].distribution = {
          installed: markerState.installed,
          planned: markerState.planned,
        };
        return { status: 200, body: products };
      }
      if (url.pathname.endsWith(`/catalog/outlets/${STORE_A}/distribution`)) {
        return {
          status: 200,
          body: {
            storeGuid: STORE_A,
            installed: markerState.installed ? [{ productCode: "p1", productName: "Product one", inCurrentCatalog: true }] : [],
            planned: [],
            selectionPersisted: markerState.installed,
          },
        };
      }
      if (url.pathname.endsWith("/distribution/markers") && method === "POST") {
        markerState.saveCount += 1;
        markerState.installed = true;
        return { status: 200, body: { ok: true, changed: true, action: "set", markerKind: "installed", productCode: "p1" } };
      }
      return null;
    });

    await page.selectOption("[data-catalog-outlet-select]", STORE_A);
    await page.waitForFunction((storeGuid) => {
      var select = document.querySelector("[data-catalog-outlet-select]");
      return select && select.value === storeGuid;
    }, STORE_A);
    await page.waitForSelector('[data-distribution-action="set"][data-marker-kind="installed"]');
    await page.locator('[data-distribution-action="set"][data-marker-kind="installed"]').first().click();
    await page.waitForSelector(".pc-catalog-marker--installed", { timeout: 15000 });
    assert.equal(markerState.saveCount, 1);

    await page.reload();
    await page.waitForSelector("[data-catalog-outlet-select]");
    assert.equal(await page.inputValue("[data-catalog-outlet-select]"), STORE_A);
    await page.waitForSelector(".pc-catalog-marker--installed");
    const stored = await page.evaluate(
      (guid) => sessionStorage.getItem("tandoor-catalog-outlet-" + guid),
      SYNTHETIC_CLIENT_GUID,
    );
    assert.equal(stored, STORE_A);

    await page.close();
    await context.close();
  });

  it("ignores stale outlet meta when switching stores with delayed responses", async () => {
    const delays = new Map<string, number>([
      [STORE_A, 1200],
      [STORE_B, 0],
    ]);
    let selected = "";
    const { page, context } = await openDistributionPage(async (url) => {
      if (url.pathname.endsWith("/catalog/meta")) {
        const requested = url.searchParams.get("storeGuid") ?? "";
        const delay = delays.get(requested) ?? 0;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (requested) selected = requested;
        return { status: 200, body: metaForStore(requested, Boolean(requested)) };
      }
      if (url.pathname.endsWith("/catalog/sections-tree")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, tree: [] } };
      }
      if (url.pathname.endsWith("/catalog/facets")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, total: 0, facets: [] } };
      }
      if (url.pathname.endsWith("/catalog/products")) {
        const products = syntheticCatalogProductsPayload();
        products.items[0].name = selected === STORE_B ? "Store B product" : "Store A product";
        return { status: 200, body: products };
      }
      if (url.pathname.match(/\/catalog\/outlets\/[^/]+\/distribution$/)) {
        return { status: 200, body: { storeGuid: selected, installed: [], planned: [], selectionPersisted: false } };
      }
      return null;
    });

    await page.selectOption("[data-catalog-outlet-select]", STORE_A);
    await page.selectOption("[data-catalog-outlet-select]", STORE_B);
    await page.waitForFunction(() => {
      var select = document.querySelector("[data-catalog-outlet-select]");
      return select && select.value === "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    });
    await page.waitForTimeout(1500);
    assert.equal(await page.inputValue("[data-catalog-outlet-select]"), STORE_B);
    assert.match(await page.locator(".pc-catalog-card").textContent(), /Store B product/);

    await page.close();
    await context.close();
  });

  it("clears outlet session storage when access is revoked during save", async () => {
    let accessRevoked = false;
    const { page, context } = await openDistributionPage(async (url, method) => {
      if (accessRevoked && url.pathname.includes("/catalog/")) {
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "Client not found." } } };
      }
      if (url.pathname.endsWith("/catalog/meta")) {
        const storeGuid = url.searchParams.get("storeGuid") ?? "";
        return { status: 200, body: metaForStore(storeGuid, Boolean(storeGuid)) };
      }
      if (url.pathname.endsWith("/catalog/sections-tree")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, tree: [] } };
      }
      if (url.pathname.endsWith("/catalog/facets")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, total: 0, facets: [] } };
      }
      if (url.pathname.endsWith("/catalog/products")) {
        return { status: 200, body: syntheticCatalogProductsPayload() };
      }
      if (url.pathname.endsWith("/distribution/markers") && method === "POST") {
        accessRevoked = true;
        return { status: 404, body: { code: "NOT_FOUND", message: "Client not found." } };
      }
      if (url.pathname.match(/\/catalog\/outlets\/[^/]+\/distribution$/)) {
        return { status: 200, body: { storeGuid: STORE_A, installed: [], planned: [], selectionPersisted: false } };
      }
      return null;
    });

    await page.selectOption("[data-catalog-outlet-select]", STORE_A);
    await page.waitForSelector('[data-distribution-action="set"]');
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-distribution-action="set"][data-marker-kind="installed"]').first().click();
    await page.waitForFunction((guid) => sessionStorage.getItem("tandoor-catalog-outlet-" + guid) === null, SYNTHETIC_CLIENT_GUID);
    const stored = await page.evaluate(
      (guid) => sessionStorage.getItem("tandoor-catalog-outlet-" + guid),
      SYNTHETIC_CLIENT_GUID,
    );
    assert.equal(stored, null);

    await page.close();
    await context.close();
  });

  it("shows catalog version conflict without repainting another outlet after save", async () => {
    let selected = "";
    const { page, context } = await openDistributionPage(async (url, method) => {
      if (url.pathname.endsWith("/catalog/meta")) {
        const storeGuid = url.searchParams.get("storeGuid") ?? "";
        if (storeGuid) selected = storeGuid;
        return { status: 200, body: metaForStore(storeGuid, Boolean(storeGuid)) };
      }
      if (url.pathname.endsWith("/catalog/sections-tree")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, tree: [] } };
      }
      if (url.pathname.endsWith("/catalog/facets")) {
        return { status: 200, body: { state: "ready", versionId: VERSION_ID, total: 0, facets: [] } };
      }
      if (url.pathname.endsWith("/catalog/products")) {
        const products = syntheticCatalogProductsPayload();
        products.items[0].name = selected === STORE_B ? "Store B product" : "Store A product";
        return { status: 200, body: products };
      }
      if (url.pathname.endsWith("/distribution/markers") && method === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 700));
        selected = STORE_B;
        return {
          status: 409,
          body: {
            code: "CATALOG_VERSION_CHANGED",
            message: "Каталог обновился после открытия списка. Обновите данные и повторите выбор.",
            currentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        };
      }
      if (url.pathname.match(/\/catalog\/outlets\/[^/]+\/distribution$/)) {
        return { status: 200, body: { storeGuid: selected, installed: [], planned: [], selectionPersisted: false } };
      }
      return null;
    });

    await page.selectOption("[data-catalog-outlet-select]", STORE_A);
    await page.waitForSelector('[data-distribution-action="set"][data-marker-kind="installed"]');
    await page.locator('[data-distribution-action="set"][data-marker-kind="installed"]').first().click();
    await page.selectOption("[data-catalog-outlet-select]", STORE_B);
    await page.waitForTimeout(900);
    assert.equal(await page.inputValue("[data-catalog-outlet-select]"), STORE_B);
    assert.match(await page.locator(".pc-catalog-card").textContent(), /Store B product/);

    await page.close();
    await context.close();
  });
});
