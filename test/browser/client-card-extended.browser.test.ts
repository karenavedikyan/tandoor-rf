import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  SYNTHETIC_CLIENT_GUID,
  resolveMockResponse,
  syntheticDetailPayload,
  syntheticExtendedDetailPayload,
  syntheticOutletMock,
} from "./helpers/clients-api-mocks";

describe("client card extended browser (mocked API)", { concurrency: false }, () => {
  let server: http.Server;
  let baseUrl = "";
  let browser: Browser;

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function installMocks(
    page: Page,
    detailBody: ReturnType<typeof syntheticExtendedDetailPayload>,
    role: "admin" | "manager" = "admin",
  ): Promise<void> {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const mock = resolveMockResponse(url, { role, detailBody }, { listCalls: 0 }, route.request().method());
      if (mock) {
        await route.fulfill(mock);
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"error":"not mocked"}',
      });
    });
  }

  async function openClientPage(
    outletAccess: "granted" | "denied",
    viewport = { width: 1440, height: 900 },
    role: "admin" | "manager" = "admin",
  ): Promise<{ page: Page; context: BrowserContext }> {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await installMocks(page, syntheticExtendedDetailPayload(outletAccess), role);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    return { page, context };
  }

  it("renders extended outlets and all-false loading schedule at desktop width", async () => {
    const { page, context } = await openClientPage("granted");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Дни не отмечены/);
    assert.match(text, /09:00/);
    assert.match(text, /Торговая точка 1/);
    assert.match(text, /Торговая точка 2/);
    assert.match(text, /2 точек в текущем снимке/);
    assert.doesNotMatch(text, /Дни приёмки не переданы/);
    await context.close();
  });

  it("shows denied outlet access message for manager mock", async () => {
    const { page, context } = await openClientPage("denied", { width: 390, height: 844 }, "manager");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Недоступны для вашей роли/);
    assert.doesNotMatch(text, /Store street/);
    await context.close();
  });

  it("does not show role denial when extended block is absent", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await installMocks(page, syntheticDetailPayload());
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.doesNotMatch(text, /Недоступны для вашей роли/);
    assert.match(text, /данные не переданы|Данные не переданы/i);
    await context.close();
  });

  it("shows preserved freshness label and honest truncated outlet count", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const detail = syntheticExtendedDetailPayload("granted");
    detail.client.extended.freshnessLabel =
      "Сохранено из предыдущей выгрузки (блок не передан в текущем снимке)";
    detail.client.extended.retailOutletsTotalCount = 25;
    detail.client.extended.retailOutletsTruncated = true;
    detail.client.extended.retailOutlets = [detail.client.extended.retailOutlets[0]!];
    await installMocks(page, detail);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Сохранено из предыдущей выгрузки/);
    assert.match(text, /1 из 25/);
    await context.close();
  });

  it("shows open, closed, unknown and preserved outlet statuses", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const detail = syntheticExtendedDetailPayload("granted");
    detail.client.extended.retailOutlets = [
      syntheticOutletMock({
        ordinal: 0,
        guidStore: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        guidStoreShortLabel: "cccc…ccc1",
        identityLabel: "Торговая точка 1С · cccc…ccc1",
        closureStatus: "open",
        closureStatusLabel: "Открыта",
        dataSourceLabel: "Подтверждено текущей выгрузкой",
      }),
      syntheticOutletMock({
        ordinal: 1,
        guidStore: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        guidStoreShortLabel: "dddd…dddd",
        identityLabel: "Торговая точка 1С · dddd…dddd",
        closureStatus: "closed",
        closureStatusLabel: "Закрыта",
        closureNote: "Точка остаётся доступной для просмотра и истории. Новые записи дистрибуции недоступны.",
        dataSourceLabel: "Подтверждено текущей выгрузкой",
        distributionNote: "Запись дистрибуции недоступна для закрытой торговой точки.",
      }),
      syntheticOutletMock({
        ordinal: 2,
        closureStatus: "not_provided",
        closureStatusLabel: "Статус не передан",
      }),
      syntheticOutletMock({
        ordinal: 3,
        guidStore: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        identityLabel: "Торговая точка 1С · eeee…eeee",
        closureStatus: "open",
        closureStatusLabel: "Открыта",
        presentInCurrentExport: false,
        dataSourceLabel: "Сохранено из предыдущей выгрузки; отсутствует в текущем файле",
        freshnessLabel: "Сохранено из предыдущей выгрузки; отсутствует в текущем файле (01.01.2026, 13:00)",
      }),
    ];
    detail.client.extended.retailOutletsTotalCount = 4;
    await installMocks(page, detail);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Открыта/);
    assert.match(text, /Закрыта/);
    assert.match(text, /Статус не передан/);
    assert.match(text, /отсутствует в текущем файле/);
    assert.match(text, /4 точек в текущем снимке/);
    await context.close();
  });

  it("shows preserved outlet source and unconfirmed closure in UI", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const detail = syntheticExtendedDetailPayload("granted");
    detail.client.extended.retailOutlets = [
      syntheticOutletMock({
        guidStore: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        identityLabel: "Торговая точка 1С · eeee…eeee",
        closureStatus: "open",
        closureStatusLabel: "Открыта (статус сохранён; не подтверждён текущей выгрузкой)",
        presentInCurrentExport: false,
        dataSourceLabel: "Сохранено из предыдущей выгрузки; отсутствует в текущем файле",
        freshnessLabel: "Сохранено из предыдущей выгрузки; отсутствует в текущем файле (01.01.2026, 13:00)",
      }),
    ];
    detail.client.extended.retailOutletsTotalCount = 1;
    await installMocks(page, detail);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /отсутствует в текущем файле/);
    assert.match(text, /не подтверждён текущей выгрузкой/);
    await context.close();
  });

  it("does not duplicate archived anonymous outlet in current count", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const detail = syntheticExtendedDetailPayload("granted");
    detail.client.extended.retailOutlets = [
      syntheticOutletMock({
        guidStore: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        identityLabel: "Торговая точка 1С · cccc…ccc1",
        closureStatus: "open",
        closureStatusLabel: "Открыта",
      }),
    ];
    detail.client.extended.retailOutletsTotalCount = 1;
    detail.client.extended.retailOutletHistoryCount = 1;
    await installMocks(page, detail);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /Торговая точка 1С · cccc…ccc1/);
    assert.equal(await page.locator('[data-testid^="pc-outlet-"]').count(), 1);
    assert.doesNotMatch(text, /Идентификатор ещё не передан.*Идентификатор ещё не передан/);
    await context.close();
  });

  it("shows preserved loading time ambiguity note in outlet block", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const detail = syntheticExtendedDetailPayload("granted");
    detail.client.extended.retailOutlets = [
      syntheticOutletMock({
        guidStore: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        identityLabel: "Торговая точка 1С · cccc…ccc1",
        closureStatus: "open",
        closureStatusLabel: "Открыта",
        dataSourceLabel:
          "Частично подтверждено текущей выгрузкой (отдельные поля сохранены из предыдущей)",
        loading: {
          days: [{ key: "mon", label: "Пн", value: true }],
          loadingTime: "09:00",
          loadingTimeNote:
            "Сохранено из предыдущей выгрузки. В текущем файле передано неоднозначное значение времени приёмки.",
          loadingEndTime: null,
          scheduleState: "has_selected",
        },
      }),
    ];
    detail.client.extended.retailOutletsTotalCount = 1;
    await installMocks(page, detail);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click("#pc-tab-data");
    const text = await page.locator("#pc-panel-data").innerText();
    assert.match(text, /09:00/);
    assert.match(text, /неоднозначное значение времени приёмки/);
    assert.match(text, /Частично подтверждено текущей выгрузкой/);
    await context.close();
  });

  it("renders extended data tab in dark theme on mobile", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await installMocks(page, syntheticExtendedDetailPayload("granted"));
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("tandoor-rf-theme", "dark");
    });
    await page.click("#pc-tab-data");
    await page.waitForSelector('[data-testid="pc-outlet-0"]');
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    assert.equal(theme, "dark");
    await context.close();
  });
});
