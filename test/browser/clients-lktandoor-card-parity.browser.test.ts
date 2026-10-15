/**
 * Card-only visual captures vs lktandoor prototype structure (mocked v3 detail).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { resolveMockResponse } from "./helpers/clients-api-mocks";

const LEGAL = "b2000000-0000-4000-8000-000000000001";
const HOLDING = "a1000000-0000-4000-8000-000000000001";
const SCREENSHOT_DIR =
  process.env.CLIENTS_LKTANDOOR_CARD_DIR ??
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media/clients-lktandoor-card";

function jsonResponse(status: number, body: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

describe("lktandoor card parity captures (mocked)", { concurrency: false }, () => {
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

  async function installMocks(page: import("playwright").Page) {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients/v3/detail") {
        await route.fulfill(
          jsonResponse(200, {
            entity: {
              guid: LEGAL,
              name_client: "Южный дом",
              type_category: { name_type: "Дилер", name_category: "ТОП-150" },
              managers: {
                name_manager: "Алексей Морозов",
                guid_manager: "22222222-2222-4222-8222-222222222222",
                name_head_of_the_sales_department: "Елена Волкова",
                guid_head_of_the_sales_department: "55555555-5555-4555-8555-555555555555",
              },
              address: "Краснодар, Учебная улица, 1",
              telephone: ["+78650000000"],
              discount: "Базовая",
              discount_amount: 5,
              markups: [{ name: "Заказная комплектация", percentage: 3 }],
              other_fields: { Код: "001" },
            },
            holdingLink: { guid: HOLDING, name: "Группа «Юг»" },
          }),
        );
        return;
      }
      if (url.pathname === `/api/clients/v3/holdings/${HOLDING}/composition`) {
        await route.fulfill(
          jsonResponse(200, {
            access: "visible",
            holdingGuid: HOLDING,
            legalEntities: [{ guid: LEGAL, name: "Южный дом" }],
            retailOutlets: [
              { guid: "c3000000-0000-4000-8000-000000000001", name: "Краснодар, Демонстрационная, 10" },
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
  }

  for (const spec of [
    { name: "1440", width: 1440, height: 900 },
    { name: "1024", width: 1024, height: 900 },
    { name: "390", width: 390, height: 844 },
  ]) {
    it(`captures overview + tabs at ${spec.name}`, async () => {
      const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height } });
      await installMocks(page);
      const returnQuery = "/clients?v3mode=1&v3entity=legal&view=all&v3manager=22222222-2222-4222-8222-222222222222";
      await page.goto(
        baseUrl +
          "/clients/" +
          LEGAL +
          "?v3Entity=legal&return=" +
          encodeURIComponent(returnQuery),
        { waitUntil: "networkidle" },
      );
      await page.waitForSelector('[data-testid="v3-detail-title"]', { timeout: 30000 });
      assert.match(await page.locator('[data-testid="v3-detail-title"]').innerText(), /Южный дом/);
      await page.waitForSelector('[data-testid="v3-related-outlets"] a', { timeout: 15000 });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `card-overview-${spec.name}.png`),
        fullPage: true,
      });
      await page.locator("#pc-tab-plan").click();
      await page.waitForSelector("#pc-panel-plan:not([hidden])");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `card-plan-empty-${spec.name}.png`),
        fullPage: true,
      });
      await page.click('[data-testid="v3-back-to-list"]');
      await page.waitForURL(/\/clients\?/);
      assert.match(page.url(), /v3manager=/);
      await page.close();
    });
  }
});
