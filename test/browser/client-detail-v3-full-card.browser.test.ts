import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { resolveMockResponse } from "./helpers/clients-api-mocks";

const LEGAL = "b2000000-0000-4000-8000-000000000001";
const RETAIL = "c3000000-0000-4000-8000-000000000001";
const HOLDING = "a1000000-0000-4000-8000-000000000001";
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/clients-stage1-full-card");

function jsonResponse(status: number, body: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function legalDetailPayload() {
  return {
    entity: {
      guid: LEGAL,
      name: "Legal One",
      name_client: "Legal One",
      type_category: {
        guid_type: "t1",
        name_type: "Type A",
        guid_category: "c1",
        name_category: "Cat A",
      },
      managers: {
        name_manager: "Manager One",
        name_head_of_the_sales_department: "ROP One",
      },
      address: "SYNTH address",
      telephone: ["+70000000001"],
      discount: "10%",
      discount_amount: 5,
      markups: [],
      other_fields: {
        Код: "SYNTH-001",
        Оптовик_КонтактноеЛицо: "SYNTH Contact Person",
        Оптовик_СтатусКлиента: "Active",
        Оптовик_ИндивидуальнаяСкидка: "5",
      },
      last_imported_at: "2026-01-01T12:00:00.000Z",
      last_source_sha256: "hidden-sha-value",
    },
    holdingLink: { guid: HOLDING, name: "SYNTH Holding One" },
  };
}

function retailDetailPayload() {
  return {
    entity: {
      guid: RETAIL,
      warehouse: false,
      closed: false,
      type_category: { name_type: "Retail Type", name_category: "Retail Cat" },
      address: {
        store_address: "Store One Address",
        delivery_address: "Delivery One",
        direction_of_the_route: "Route North",
      },
      information_loading: { loading_time: "10:00", loading_on_monday: true },
      managers: { name_manager: "Manager One", name_head_of_the_sales_department: "ROP One" },
      contact_information: { store_phone: "+71111111111", accountant_email: "acc@example.com" },
      lpr_information: { name: "Ivan LPR", bonus: "5%" },
      additional_information: { status_tandoor_club: "Gold", bonus_tandoor_club: "10" },
    },
    holdingLink: { guid: HOLDING, name: "SYNTH Holding One" },
  };
}

describe("client-detail v3 full card browser (mocked v3 detail)", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function installMocks(page: import("playwright").Page, detailBody: Record<string, unknown>) {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients/v3/detail") {
        await route.fulfill(jsonResponse(200, detailBody));
        return;
      }
      const mock = resolveMockResponse(url, { role: "admin" }, { listCalls: 0, catalogProductsCalls: 0 });
      if (mock) {
        await route.fulfill(mock);
        return;
      }
      await route.fulfill(jsonResponse(404, { error: "not mocked" }));
    });
  }

  it("legal card: overview + data passport, no SHA in UX, back preserves return", async () => {
    const returnQuery = "/clients?v3mode=1&v3entity=legal&view=all&page=1&q=Legal";
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await installMocks(page, legalDetailPayload());
    await page.goto(
      baseUrl +
        "/clients/" +
        LEGAL +
        "?v3Entity=legal&return=" +
        encodeURIComponent(returnQuery),
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForSelector('[data-testid="v3-detail-card"]', { timeout: 30000 });
    await page.waitForSelector("#pc-panel-overview:not([hidden])");
    await page.waitForSelector('[data-testid="v3-territory-nav"]');
    assert.match(await page.locator("#pc-panel-overview").innerText(), /ТОП: Type A/);
    assert.match(await page.locator('[data-testid="v3-detail-card"] [role="tablist"]').innerText(), /Заказы/);
    assert.match(await page.locator("#pc-panel-overview").innerText(), /Точки и контакты/);
    assert.match(await page.locator("#pc-panel-overview").innerText(), /Торговые точки/);
    assert.match(await page.locator("#pc-panel-overview").innerText(), /Ответственные клиента/);
    assert.doesNotMatch(await page.content(), /hidden-sha-value/);
    assert.doesNotMatch(await page.content(), /SHA/i);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "impl-legal-overview-desktop-1440.png"),
      fullPage: true,
    });

    await page.locator("#pc-tab-data").click();
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    assert.equal(await page.locator('[data-testid="v3-territory-nav"]').count(), 1);
    assert.ok(await page.locator('[data-testid="v3-territory-nav"]').isVisible());
    assert.equal(
      await page.locator('[data-testid="v3-detail-title"]').innerText(),
      "Данные и условия клиента · Legal One",
    );
    assert.match(await page.locator("#pc-panel-data").innerText(), /ROP One/);
    assert.match(await page.locator("#pc-panel-data").innerText(), /Клиент и холдинг/);
    assert.match(await page.locator("#pc-panel-data").innerText(), /Коммерческие условия/);
    assert.match(await page.locator("#pc-panel-data").innerText(), /SYNTH Contact Person/);
    assert.match(await page.locator("#pc-panel-data").innerText(), /Доступные точки холдинга/);

    await page.locator("#pc-tab-orders").click();
    await page.waitForSelector("#pc-panel-orders:not([hidden])");
    assert.match(await page.locator("#pc-panel-orders").innerText(), /учётной системы заказов/);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "impl-legal-data-desktop-1440.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#pc-tab-overview").click();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "impl-legal-overview-mobile-390.png"),
      fullPage: true,
    });
    await page.locator("#pc-tab-data").click();
    assert.ok(await page.locator('[data-testid="v3-territory-nav"]').isVisible());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      "mobile card has no page-level horizontal overflow",
    );
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "impl-legal-data-mobile-390.png"),
      fullPage: true,
    });
    await page.click('[data-testid="v3-back-to-list"]');
    await page.waitForURL(/\/clients\?/);
    assert.match(page.url(), /q=Legal/);
    await page.close();
  });

  it("retail card data tab shows store and LPR groups", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await installMocks(page, retailDetailPayload());
    await page.goto(baseUrl + "/clients/" + RETAIL + "?v3Entity=retail", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="v3-detail-title"]', { timeout: 30000 });
    await page.locator("#pc-tab-data").click();
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Доставка и приёмка/);
    assert.match(text, /Route North/);
    assert.match(text, /Ivan LPR/);
    await page.close();
  });

  it("retail without holding stops related loading and does not copy outlet assignments to client", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMocks(page, { ...retailDetailPayload(), holdingLink: null });
    await page.goto(baseUrl + "/clients/" + RETAIL + "?v3Entity=retail&cardTab=data", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("#pc-panel-data:not([hidden])");
    assert.match(await page.locator('[data-testid="v3-data-holding-outlets"]').innerText(), /Связь с холдингом не передана/);
    assert.match(await page.locator("#pc-panel-data").innerText(), /Назначения клиента отдельно не переданы/);
    assert.doesNotMatch(await page.locator('[data-testid="v3-data-holding-outlets"]').innerText(), /Загрузка/);
    await page.close();
  });

  it("holding overview KPIs reflect authorized composition totals", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients/v3/detail") {
        await route.fulfill(
          jsonResponse(200, {
            entity: { guid: HOLDING, name: "SYNTH Holding One" },
            entityType: "holding",
          }),
        );
        return;
      }
      if (url.pathname === "/api/clients/v3/holdings/" + HOLDING + "/composition") {
        await route.fulfill(
          jsonResponse(200, {
            access: "visible",
            holdingGuid: HOLDING,
            legalEntities: [{ guid: LEGAL, name: "Legal One" }],
            retailOutlets: [
              { guid: RETAIL, name: "Store One" },
              { guid: "c3000000-0000-4000-8000-000000000002", name: "Store Two" },
            ],
          }),
        );
        return;
      }
      const mock = resolveMockResponse(url, { role: "admin" }, { listCalls: 0, catalogProductsCalls: 0 });
      if (mock) {
        await route.fulfill(mock);
        return;
      }
      await route.fulfill(jsonResponse(404, { error: "not mocked" }));
    });
    await page.goto(baseUrl + "/clients/" + HOLDING + "?v3Entity=holding", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="v3-overview-kpis"]', { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const kpis = document.querySelector('[data-testid="v3-overview-kpis"]');
        if (!kpis) return false;
        const text = kpis.textContent || "";
        return text.includes("2") && text.includes("1") && !text.includes("—");
      },
      undefined,
      { timeout: 30000 },
    );
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "impl-holding-overview-kpi-desktop-1440.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "impl-holding-overview-kpi-mobile-390.png"),
      fullPage: true,
    });
    await page.close();
  });

  it("unavailable module tab shows explicit message", async () => {
    const page = await browser.newPage();
    await installMocks(page, legalDetailPayload());
    await page.goto(baseUrl + "/clients/" + LEGAL + "?v3Entity=legal");
    await page.waitForSelector("#pc-tab-work");
    await page.locator("#pc-tab-work").click();
    await page.waitForSelector("#pc-panel-work:not([hidden])");
    assert.match(await page.locator("#pc-panel-work").innerText(), /Битрикс24/);
    await page.close();
  });
});
