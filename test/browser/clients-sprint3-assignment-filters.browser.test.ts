import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  SYNTHETIC_MANAGER_A,
  resolveMockResponse,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SYNTHETIC_MANAGER_B = "55555555-5555-4555-8555-555555555555";
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

type ListRouteState = {
  listCalls: number;
  catalogProductsCalls: number;
  lastListUrl: string;
};

describe("sprint3 assignment filters browser", { concurrency: false }, () => {
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

  async function setupPage() {
    const page = await browser.newPage();
    const state: ListRouteState = {
      listCalls: 0,
      catalogProductsCalls: 0,
      lastListUrl: "",
    };
    const options: MockOptions = {
      role: "admin",
      clientsBusinessRole: "director",
      optionsPayload: {
        managers: [
          {
            id: SYNTHETIC_MANAGER_A,
            name: "Менеджер Иванов",
            shortId: "22222222",
          },
          {
            id: SYNTHETIC_MANAGER_B,
            name: "Менеджер Петров",
            shortId: "55555555",
          },
        ],
      },
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

  async function toggleManagerOption(page: Page, label: string): Promise<void> {
    await ensureFiltersPanelExpanded(page);
    await page.click("#manager-filter-input");
    await page
      .locator("#manager-filter-list .clients-combobox__option")
      .filter({ hasText: label })
      .first()
      .click();
  }

  it("persists multi GUID OR filter, mode mutual exclusion, and URL state", async () => {
    const { page, state } = await setupPage();

    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all`, { waitUntil: "networkidle" });
    await page.waitForSelector("#manager-filter-wrap:not(.clients-hidden)");

    await toggleManagerOption(page, "Менеджер Иванов");
    await page.waitForFunction(() => window.location.search.includes("clientManager="));
    assert.match(page.url(), new RegExp(`clientManager=${SYNTHETIC_MANAGER_A}`));
    assert.doesNotMatch(page.url(), /clientManagerMode=/);

    await toggleManagerOption(page, "Менеджер Петров");
    await page.waitForFunction(
      ([managerA, managerB]) => {
        const params = new URLSearchParams(window.location.search);
        const value = params.get("clientManager") || "";
        return value.includes(managerA) && value.includes(managerB);
      },
      [SYNTHETIC_MANAGER_A, SYNTHETIC_MANAGER_B],
    );
    assert.match(state.lastListUrl, new RegExp(`clientManager=[^&]*${SYNTHETIC_MANAGER_A}`));
    assert.match(state.lastListUrl, new RegExp(`clientManager=[^&]*${SYNTHETIC_MANAGER_B}`));
    assert.equal(await page.locator("#manager-filter-tags .clients-assignment-filter__tag").count(), 2);

    await page.selectOption("#manager-filter-mode", "unassigned");
    await page.waitForFunction(() => window.location.search.includes("clientManagerMode=unassigned"));
    assert.match(page.url(), /clientManagerMode=unassigned/);
    assert.doesNotMatch(page.url(), /clientManager=/);
    assert.doesNotMatch(page.url(), /missingClientManager=1/);
    assert.equal(await page.locator("#manager-filter-tags .clients-assignment-filter__tag").count(), 0);
    assert.equal(await page.locator("#manager-filter-input").isDisabled(), true);

    await page.selectOption("#manager-filter-mode", "");
    await page.waitForFunction(() => !window.location.search.includes("clientManagerMode="));
    await toggleManagerOption(page, "Менеджер Иванов");
    await page.waitForFunction(
      (managerA) => window.location.search.includes(`clientManager=${managerA}`),
      SYNTHETIC_MANAGER_A,
    );
    assert.doesNotMatch(page.url(), /clientManagerMode=/);

    await page.reload({ waitUntil: "networkidle" });
    assert.match(page.url(), new RegExp(`clientManager=${SYNTHETIC_MANAGER_A}`));
    assert.doesNotMatch(page.url(), /clientManagerMode=/);
    assert.equal(await page.locator("#manager-filter-tags .clients-assignment-filter__tag").count(), 1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "sprint3-assignment-filters-desktop-1280.png"),
      fullPage: true,
    });

    await page.setViewportSize(MOBILE);
    await ensureFiltersPanelExpanded(page);
    await page.waitForSelector("#manager-filter-mode:not(.clients-hidden)");
    assert.match(page.url(), new RegExp(`clientManager=${SYNTHETIC_MANAGER_A}`));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "sprint3-assignment-filters-mobile-390.png"),
      fullPage: true,
    });

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    });
    assert.equal(overflow, false);

    await page.close();
  });

  it("persists discountProgram value filter in URL and reload", async () => {
    const { page, state } = await setupPage();

    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await ensureFiltersPanelExpanded(page);
    await page.locator("#field-filters-wrap").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.waitForSelector("#discount-program-filter:not(.clients-hidden)");
    await page.fill("#discount-program-filter", "PROMO");
    await page.waitForFunction(() => window.location.search.includes("discountProgram=PROMO"));
    assert.match(page.url(), /discountProgram=PROMO/);
    assert.match(state.lastListUrl, /discountProgram=PROMO/);

    await page.reload({ waitUntil: "networkidle" });
    assert.match(page.url(), /discountProgram=PROMO/);
    assert.equal(await page.inputValue("#discount-program-filter"), "PROMO");

    await page.click("#reset-filters");
    await page.waitForFunction(() => !window.location.search.includes("discountProgram="));
    assert.doesNotMatch(page.url(), /discountProgram=/);

    await page.close();
  });

  it("clears client commercial filters when switching entity to outlets", async () => {
    const { page, state } = await setupPage();

    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/clients?view=all&entity=clients`, { waitUntil: "networkidle" });
    await ensureFiltersPanelExpanded(page);
    await page.locator("#field-filters-wrap").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.waitForSelector("#discount-program-filter:not(.clients-hidden)");
    await page.fill("#discount-program-filter", "PROMO");
    await page.fill("#bonus-tandoor-filter", "0");
    await page.waitForFunction(() => window.location.search.includes("discountProgram=PROMO"));

    await page.click('#entity-switcher [data-entity="outlets"]');
    await page.waitForFunction(() => window.location.search.includes("entity=outlets"));
    await page.waitForFunction(
      () =>
        !window.location.search.includes("discountProgram=") &&
        window.location.search.includes("bonusTandoorClub=0"),
    );

    assert.doesNotMatch(page.url(), /discountProgram=/);
    assert.match(page.url(), /bonusTandoorClub=0/);
    assert.doesNotMatch(state.lastListUrl, /discountProgram=/);
    assert.match(state.lastListUrl, /bonusTandoorClub=0/);
    assert.equal(await page.inputValue("#discount-program-filter"), "");
    assert.equal(await page.inputValue("#bonus-tandoor-filter"), "0");

    await page.reload({ waitUntil: "networkidle" });
    assert.doesNotMatch(page.url(), /discountProgram=/);
    assert.match(page.url(), /bonusTandoorClub=0/);

    await page.click('#entity-switcher [data-entity="clients"]');
    await page.waitForFunction(() => !window.location.search.includes("entity=outlets"));
    assert.doesNotMatch(page.url(), /discountProgram=/);
    assert.equal(await page.inputValue("#discount-program-filter"), "");

    await page.close();
  });
});
