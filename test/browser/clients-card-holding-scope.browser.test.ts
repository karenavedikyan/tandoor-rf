/**
 * Composition lists are session-scoped (not whole holding); legal KPI stays 1.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { SYNTHETIC_MANAGER_A } from "./helpers/clients-api-mocks";

const LEGAL = "b2000000-0000-4000-8000-000000000001";
const HOLDING = "a1000000-0000-4000-8000-000000000001";
const OUTLET_A = "c3000000-0000-4000-8000-000000000001";
const OUTLET_B = "c3000000-0000-4000-8000-000000000002";

function jsonResponse(status: number, body: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

describe("v3 card holding outlets respect scoped composition", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
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

  async function openLegalCard(page: import("playwright").Page, outletGuids: string[]) {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients/v3/detail") {
        await route.fulfill(
          jsonResponse(200, {
            entity: {
              guid: LEGAL,
              name_client: "Южный дом",
              type_category: { name_type: "Дилер", name_category: "ТОП-150" },
              managers: { name_manager: "Manager A", guid_manager: SYNTHETIC_MANAGER_A },
              address: "Addr",
              other_fields: { Код: "001", Оптовик_РетроБонус: "5%" },
            },
            holdingLink: { guid: HOLDING, name: "Holding" },
          }),
        );
        return;
      }
      if (url.pathname === `/api/clients/v3/holdings/${HOLDING}/composition`) {
        await route.fulfill(
          jsonResponse(200, {
            access: "visible",
            holdingGuid: HOLDING,
            legalEntities: [{ guid: LEGAL, name: "Южный дом" }, { guid: "other-legal", name: "Other" }],
            retailOutlets: outletGuids.map(function (guid, i) {
              return { guid: guid, name: "Outlet " + (i + 1) };
            }),
          }),
        );
        return;
      }
      if (url.pathname === "/api/auth/me") {
        await route.fulfill(jsonResponse(200, { user: { role: "manager", fullName: "Manager A" } }));
        return;
      }
      await route.fulfill(jsonResponse(404, { error: "not mocked" }));
    });
    const returnQuery =
      "/clients?v3mode=1&v3entity=legal&view=all&v3manager=" + encodeURIComponent(SYNTHETIC_MANAGER_A);
    await page.goto(
      baseUrl + "/clients/" + LEGAL + "?v3Entity=legal&return=" + encodeURIComponent(returnQuery),
      { waitUntil: "networkidle" },
    );
    await page.waitForSelector('[data-testid="v3-overview-kpis"] b', { timeout: 30000 });
  }

  it("manager A sees one scoped outlet; legal entities KPI stays 1", async () => {
    const page = await browser.newPage();
    await openLegalCard(page, [OUTLET_A]);
    var kpis = await page.locator('[data-testid="v3-overview-kpis"] b').allTextContents();
    assert.deepEqual(kpis, ["1", "1", "Дилер / ТОП-150"]);
    assert.equal(await page.locator('[data-testid="v3-related-outlets"] a.x13-related-line').count(), 1);
    await page.close();
  });

  it("different composition payload yields different outlet count", async () => {
    const page = await browser.newPage();
    await openLegalCard(page, [OUTLET_A, OUTLET_B]);
    assert.equal(await page.locator('[data-testid="v3-related-outlets"] a.x13-related-line').count(), 2);
    var kpis = await page.locator('[data-testid="v3-overview-kpis"] b').allTextContents();
    assert.equal(kpis[0], "2");
    assert.equal(kpis[1], "1");
    await page.close();
  });

  it("related TT back chain preserves parent legal card and list v3manager", async () => {
    const page = await browser.newPage();
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients/v3/detail") {
        const guid = url.searchParams.get("guid") || "";
        if (guid === OUTLET_A) {
          await route.fulfill(
            jsonResponse(200, {
              entity: {
                guid: OUTLET_A,
                address: { store_address: "Outlet A addr" },
                type_category: { name_type: "Дилер", name_category: "ТОП-150" },
                managers: { name_manager: "Manager A", guid_manager: SYNTHETIC_MANAGER_A },
              },
              holdingLink: { guid: HOLDING, name: "Holding" },
            }),
          );
          return;
        }
        await route.fulfill(
          jsonResponse(200, {
            entity: {
              guid: LEGAL,
              name_client: "Южный дом",
              type_category: { name_type: "Дилер", name_category: "ТОП-150" },
              managers: { name_manager: "Manager A", guid_manager: SYNTHETIC_MANAGER_A },
              address: "Addr",
              other_fields: { Код: "001", Оптовик_РетроБонус: "5%" },
            },
            holdingLink: { guid: HOLDING, name: "Holding" },
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
            retailOutlets: [{ guid: OUTLET_A, name: "Outlet 1" }],
          }),
        );
        return;
      }
      if (url.pathname === "/api/auth/me") {
        await route.fulfill(jsonResponse(200, { user: { role: "manager", fullName: "Manager A" } }));
        return;
      }
      await route.fulfill(jsonResponse(404, { error: "not mocked" }));
    });

    const listReturn =
      "/clients?v3mode=1&v3entity=legal&view=all&v3manager=" + encodeURIComponent(SYNTHETIC_MANAGER_A);
    await page.goto(
      baseUrl + "/clients/" + LEGAL + "?v3Entity=legal&return=" + encodeURIComponent(listReturn),
      { waitUntil: "networkidle" },
    );
    await page.locator('[data-card-tab="data"]').click();
    await page.waitForSelector("#v3-data-holding-outlets a.x13-related-line", { timeout: 30000 });

    const relatedHref = await page.locator("#v3-data-holding-outlets a.x13-related-line").first().getAttribute("href");
    assert.ok(relatedHref);
    const relatedUrl = new URL(relatedHref!, baseUrl);
    const parentReturnRaw = relatedUrl.searchParams.get("return");
    assert.ok(parentReturnRaw);
    assert.ok(parentReturnRaw!.startsWith("/clients/"), "return must point to parent legal card, not double-encoded");
    assert.match(decodeURIComponent(parentReturnRaw!), new RegExp("/clients/" + LEGAL.replace(/-/g, "\\-")));

    await page.locator("#v3-data-holding-outlets a.x13-related-line").first().click();
    await page.waitForURL(new RegExp("/clients/" + OUTLET_A.replace(/-/g, "\\-")), { timeout: 30000 });
    assert.match(page.url(), /v3Entity=retail/);

    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL(new RegExp("/clients/" + LEGAL.replace(/-/g, "\\-")), { timeout: 30000 });
    await page.waitForSelector("#pc-panel-data:not([hidden])", { timeout: 30000 });
    assert.match(page.url(), /cardTab=data/);

    const listBackHref = await page.locator('[data-testid="v3-back-to-list"]').getAttribute("href");
    assert.ok(listBackHref);
    assert.match(listBackHref!, new RegExp("v3manager=" + SYNTHETIC_MANAGER_A.replace(/-/g, "\\-")));
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL(/\/clients(\?|$)/, { timeout: 30000 });
    const listUrl = new URL(page.url());
    const managerFromUrl =
      listUrl.searchParams.get("v3manager") || listUrl.searchParams.get("manager");
    assert.equal(managerFromUrl, SYNTHETIC_MANAGER_A);
    await page.close();
  });
});
