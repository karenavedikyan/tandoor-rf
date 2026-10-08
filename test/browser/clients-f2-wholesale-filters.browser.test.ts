import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import { resolveMockResponse, type MockOptions } from "./helpers/clients-api-mocks";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

describe("clients F2 wholesale filters browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
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

  async function setupPage() {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0, lastListUrl: "" };
    const options: MockOptions = { role: "admin", clientsBusinessRole: "director" };

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

    return { page, state };
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

  function isOnecCategoryClientsListRequest(url: URL): boolean {
    if (url.pathname !== "/api/clients") {
      return false;
    }
    if (url.searchParams.get("onecCategory") !== "SYNTH-UNKNOWN") {
      return false;
    }
    const entity = url.searchParams.get("entity");
    return entity === null || entity === "clients";
  }

  it("persists onecCategory filter in URL and reload (desktop)", async () => {
    const { page } = await setupPage();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await ensureFiltersPanelExpanded(page);
    await page.locator("#field-filters-wrap").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.waitForSelector("#onec-category-filter:not(.clients-hidden)");

    const listResponse = page.waitForResponse((response) => {
      if (response.request().method() !== "GET") {
        return false;
      }
      return isOnecCategoryClientsListRequest(new URL(response.url()));
    });
    await page.selectOption("#onec-category-filter", "SYNTH-UNKNOWN");
    const response = await listResponse;
    assert.equal(response.status(), 200);

    await page.waitForFunction(() => window.location.search.includes("onecCategory=SYNTH-UNKNOWN"));
    assert.match(page.url(), /onecCategory=SYNTH-UNKNOWN/);

    await page.reload({ waitUntil: "networkidle" });
    assert.match(page.url(), /onecCategory=SYNTH-UNKNOWN/);
    await page.close();
  });

  it("clears onec wholesale filters when switching entity to outlets (mobile)", async () => {
    const { page, state } = await setupPage();
    await page.setViewportSize(MOBILE);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await ensureFiltersPanelExpanded(page);
    await page.locator("#field-filters-wrap").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.waitForSelector("#onec-top150-filter:not(.clients-hidden)");
    await page.selectOption("#onec-top150-filter", "Нет");
    await page.waitForFunction(() => window.location.search.includes("onecTop150="));

    await page.click('#entity-switcher [data-entity="outlets"]');
    await page.waitForFunction(() => window.location.search.includes("entity=outlets"));
    await page.waitForFunction(() => !window.location.search.includes("onecTop150="));

    assert.doesNotMatch(page.url(), /onecTop150=/);
    assert.doesNotMatch(state.lastListUrl, /onecTop150=/);
    await page.close();
  });
});
