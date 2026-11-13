import assert from "node:assert/strict";
import http from "node:http";
import { mkdir } from "node:fs/promises";
import { before, after, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { resolveMockResponse } from "./helpers/clients-api-mocks";
const GUID = "b2000000-0000-4000-8000-000000000001";
const dir = process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ?? "/home/user/workspace/onec-manual-qa";
describe("manual 1C review UI (mocked API; PostgreSQL tested separately)", () => {
  let browser: Browser, server: http.Server, base: string;
  before(async () => {
    await mkdir(dir, { recursive: true }); server = http.createServer(createApp());
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as import("net").AddressInfo).port}`;
    browser = await chromium.launch({ headless: true, channel: "chromium" });
  });
  after(async () => { await browser?.close(); await new Promise<void>(r => server.close(() => r())); });
  it("shows safe red reasons on desktop and 375px; corrected source clears badge", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    let corrected = false;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/clients/v3/detail") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity: {
          guid: GUID, name: "Клиент с замечаниями", telephone: [], managers: {}, type_category: {}, other_fields: {},
          _onecQuality: corrected ? null : { issues: [{ code: "DUPLICATE_GUID", field: "inn",
            message: "Повтор GUID: исходные значения различаются. <img src=x onerror=alert(1)>" }] },
        } }) }); return;
      }
      const mock = resolveMockResponse(url, { role: "admin" }, { listCalls: 0, catalogProductsCalls: 0 });
      await route.fulfill(mock ?? { status: 404, contentType: "application/json", body: "{}" });
    });
    await page.goto(base + "/clients/" + GUID + "?v3Entity=legal");
    await page.locator(".onec-quality summary").waitFor();
    await page.locator(".onec-quality summary").click();
    assert.ok(await page.locator(".onec-quality").innerText().then(x => x.includes("<img src=x")));
    assert.equal(await page.locator(".onec-quality img").count(), 0);
    await page.screenshot({ path: dir + "/manual-review-desktop.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForFunction(() => document.querySelector("#legacy-sidebar")!.getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: dir + "/manual-review-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 900 });
    corrected = true; await page.reload(); await page.locator('[data-testid="v3-detail-card"]').waitFor();
    assert.equal(await page.locator(".onec-quality").count(), 0);
    assert.deepEqual(errors, []); await context.close();
  });
});
