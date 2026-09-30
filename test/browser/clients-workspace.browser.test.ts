import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  SYNTHETIC_CLIENT_GUID,
  resolveMockResponse,
  syntheticDetailPayload,
  syntheticListPayload,
  syntheticLongDetailPayload,
  syntheticPagedListPayload,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

const CLIPBOARD_SPY_INIT = () => {
  const win = window as typeof window & { __clipboardWriteCalls?: string[] };
  win.__clipboardWriteCalls = [];
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) {
    return;
  }
  const original = clipboard.writeText.bind(clipboard);
  clipboard.writeText = async (text: string) => {
    win.__clipboardWriteCalls!.push(text);
    return original(text);
  };
};

const CLIPBOARD_REJECT_INIT = () => {
  navigator.clipboard.writeText = () => Promise.reject(new Error("clipboard denied"));
};

type MockState = { listCalls: number };

function createMockState(): MockState {
  return { listCalls: 0 };
}

function createMockController(page: Page, initial: MockOptions = {}) {
  const state = createMockState();
  const options: MockOptions = { role: "admin", ...initial };
  let installed = false;

  async function install(): Promise<void> {
    if (installed) {
      return;
    }
    installed = true;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const mock = resolveMockResponse(url, options, state);
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

  return {
    state,
    options,
    install,
    set(next: MockOptions) {
      Object.assign(options, next);
    },
  };
}

async function readTheme(page: Page): Promise<"light" | "dark"> {
  return page.evaluate(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
}

async function readStoredTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("tandoor-rf-theme"));
}

async function readLogoSrc(page: Page): Promise<string> {
  const src = await page.locator("[data-legacy-logo-full]").first().getAttribute("src");
  assert.ok(src);
  return src;
}

async function ensureTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  if ((await readTheme(page)) === theme) {
    return;
  }
  await page.click("[data-theme-toggle]");
  await page.waitForFunction(
    (expected) => {
      const actual =
        document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      return actual === expected;
    },
    theme,
  );
}

async function captureScreenshot(
  page: Page,
  filename: string,
  viewport: { width: number; height: number },
  theme: "light" | "dark",
): Promise<void> {
  await page.setViewportSize(viewport);
  await ensureTheme(page, theme);
  await page.waitForTimeout(200);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    fullPage: true,
  });
}

describe("clients workspace browser (R1.4-prep, mocked API)", { concurrency: false }, () => {
  let server: http.Server;
  let baseUrl = "";
  let browser: Browser;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
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

  async function openPage(
    options: MockOptions = {},
    initScripts: Array<() => void> = [],
  ): Promise<{ page: Page; context: BrowserContext; mocks: ReturnType<typeof createMockController> }> {
    const context = await browser.newContext();
    for (const script of initScripts) {
      await context.addInitScript(script);
    }
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
    const page = await context.newPage();
    const mocks = createMockController(page, options);
    await mocks.install();
    return { page, context, mocks };
  }

  async function closePage(page: Page, context: BrowserContext): Promise<void> {
    await page.close();
    await context.close();
  }

  it("loads list with search, filters, sync status and real shell", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients?q=Synthetic`);
    await page.waitForSelector("#clients-app:not(.clients-hidden)");
    await page.waitForSelector(".clients-table tbody tr");
    assert.match(await page.locator("#search-input").inputValue(), /Synthetic/);
    assert.match(await page.locator("#result-count").textContent(), /2/);
    assert.match(await page.locator("#sync-status").textContent(), /Данные загружены в ЛК/);
    assert.ok(await page.locator(".legacy-sidebar").isVisible());
    await closePage(page, context);
  });

  it("resets filters and supports pagination", async () => {
    const { page, context, mocks } = await openPage({
      listBody: syntheticPagedListPayload(1),
    });
    await page.goto(`${baseUrl}/clients?q=alpha&phone=yes&page=1`);
    await page.waitForSelector("#clients-app:not(.clients-hidden)");
    await page.click("#reset-filters");
    await page.waitForFunction(() => {
      const input = document.querySelector("#search-input") as HTMLInputElement | null;
      return input?.value === "";
    });
    assert.equal(await page.locator("#phone-filter").inputValue(), "all");

    mocks.set({ listBody: syntheticPagedListPayload(2) });
    await page.click("#page-next");
    await page.waitForFunction(() => window.location.search.includes("page=2"));
    assert.match(await page.textContent("#pagination"), /Страница 2/);
    await closePage(page, context);
  });

  it("opens card and returns to list preserving query", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients?q=Synthetic&page=1`);
    await page.waitForSelector(".clients-table tbody tr a.clients-link");
    await page.click(".clients-table tbody tr a.clients-link");
    await page.waitForURL(`**/clients/${SYNTHETIC_CLIENT_GUID}**`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    assert.match(await page.locator("#client-name").textContent(), /Synthetic Client Alpha/);
    await page.click('[data-card-tab="data"]');
    assert.match(await page.locator("#client-loaded-at").textContent(), /28.09.2026, 12:30/);
    assert.match(await page.locator("#client-source-updated").textContent(), /не передано/);
    await page.click('a.workspace-button--ghost:has-text("К списку")');
    await page.waitForURL(`**/clients?q=Synthetic**`);
    assert.doesNotMatch(await page.textContent("#access-panel"), /Нет доступа/);
    await closePage(page, context);
  });

  it("copies address with exact clipboard content and success message", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await page.click('[data-card-tab="data"]');
    await page.waitForSelector("#copy-address:not([hidden])");
    await page.click("#copy-address");
    await page.waitForSelector("#copy-address-status.workspace-status--success");
    assert.equal(await page.textContent("#copy-address-status"), "Адрес скопирован");
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboardText, "Москва, ул. Пример 1");
    await closePage(page, context);
  });

  it("copies phone with exact clipboard content and success message", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await page.click('[data-card-tab="data"]');
    const phoneRow = page.locator(".client-detail-phone-row").first();
    await phoneRow.waitFor({ state: "visible" });
    const phoneStatus = phoneRow.locator('[role="status"]');
    await phoneRow.locator('button:has-text("Копировать")').click();
    await phoneStatus.waitFor({ state: "visible" });
    await phoneRow.locator(".workspace-status--success").waitFor();
    assert.equal(await phoneStatus.textContent(), "Скопировано");
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboardText, "+7 (999) 000-11-22");
    await closePage(page, context);
  });

  it("does not call clipboard for empty or whitespace-only address", async () => {
    const { page, context, mocks } = await openPage(
      { detailBody: syntheticDetailPayload({ address: "   " }) },
      [CLIPBOARD_SPY_INIT],
    );
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    assert.match(await page.locator("#client-address").textContent(), /Адрес не указан/);
    assert.equal(
      await page.locator("#copy-address").evaluate((el) => (el as HTMLButtonElement).hidden),
      true,
    );
    let clipboardCalls = await page.evaluate(() => {
      const win = window as typeof window & { __clipboardWriteCalls?: string[] };
      return win.__clipboardWriteCalls?.length ?? 0;
    });
    assert.equal(clipboardCalls, 0, "whitespace-only address must not invoke clipboard");

    mocks.set({ detailBody: syntheticDetailPayload({ address: "" }) });
    await page.reload();
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    assert.match(await page.locator("#client-address").textContent(), /Адрес не указан/);
    assert.equal(
      await page.locator("#copy-address").evaluate((el) => (el as HTMLButtonElement).hidden),
      true,
    );
    clipboardCalls = await page.evaluate(() => {
      const win = window as typeof window & { __clipboardWriteCalls?: string[] };
      return win.__clipboardWriteCalls?.length ?? 0;
    });
    assert.equal(clipboardCalls, 0, "empty address must not invoke clipboard");
    await closePage(page, context);
  });

  it("shows address copy error without false success when clipboard fails", async () => {
    const { page, context } = await openPage({}, [CLIPBOARD_REJECT_INIT]);
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await page.click('[data-card-tab="data"]');
    await page.waitForSelector("#copy-address:not([hidden])");
    await page.click("#copy-address");
    await page.waitForSelector("#copy-address-status.workspace-status--error");
    assert.equal(await page.textContent("#copy-address-status"), "Не удалось скопировать адрес");
    assert.notEqual(await page.locator("#copy-address-status").getAttribute("class"), "workspace-status workspace-status--success");
    await closePage(page, context);
  });

  it("expands technical block and handles retry plus missing client", async () => {
    const { page, context, mocks } = await openPage({ failListOnce: true });
    const state = mocks.state;
    await page.goto(`${baseUrl}/clients`);
    await page.waitForSelector('#results-state[data-state="error"]');
    await page.click("#retry-load");
    await page.waitForSelector(".clients-table tbody tr");
    assert.ok(state.listCalls >= 2);

    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await page.click('[data-card-tab="data"]');
    await page.waitForSelector('[data-testid="section-tech"] summary');
    await page.click('[data-testid="section-tech"] summary');
    await page.waitForSelector("#client-uuid");
    assert.match(await page.locator("#client-uuid").textContent(), /11111111/);

    mocks.set({ detailStatus: 404, detailBody: { error: { message: "Not found" } } });
    await page.goto(`${baseUrl}/clients/00000000-0000-4000-8000-000000000001`);
    await page.waitForSelector('#state-panel[data-state="info"]');
    assert.match(await page.textContent("#state-panel"), /не найден/i);
    await closePage(page, context);
  });

  it("shows forbidden access for role without client-read policy and keeps keyboard focus on search", async () => {
    const { page, context } = await openPage({ role: "marketer" });
    await page.goto(`${baseUrl}/clients`);
    await page.waitForSelector('#access-panel[data-state="forbidden"]');
    assert.match(await page.textContent("#access-panel"), /Нет доступа/);
    await closePage(page, context);

    const adminPage = await openPage({ role: "admin" });
    await adminPage.page.goto(`${baseUrl}/clients`);
    await adminPage.page.waitForSelector("#search-input");
    await adminPage.page.focus("#search-input");
    const focused = await adminPage.page.evaluate(() => document.activeElement?.id);
    assert.equal(focused, "search-input");
    await closePage(adminPage.page, adminPage.context);
  });

  it("switches theme via app toggle, updates logo, and persists after reload", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients`);
    await page.waitForSelector("[data-theme-toggle]");

    await ensureTheme(page, "light");
    assert.match(await readLogoSrc(page), /tandoor-logo-official\.svg/);

    await page.click("[data-theme-toggle]");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    assert.equal(await readTheme(page), "dark");
    assert.match(await readLogoSrc(page), /tandoor-logo-light\.svg/);
    assert.equal(await readStoredTheme(page), "dark");

    await page.reload();
    await page.waitForSelector("[data-theme-toggle]");
    assert.equal(await readTheme(page), "dark");
    assert.match(await readLogoSrc(page), /tandoor-logo-light\.svg/);

    await page.click("[data-theme-toggle]");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    assert.equal(await readTheme(page), "light");
    assert.match(await readLogoSrc(page), /tandoor-logo-official\.svg/);
    assert.equal(await readStoredTheme(page), "light");
    await closePage(page, context);
  });

  it("captures eight real UI screenshots on synthetic mocked data", async () => {
    const { page, context, mocks } = await openPage();
    await page.goto(`${baseUrl}/clients?q=Synthetic`);
    await page.waitForSelector("#clients-app:not(.clients-hidden)");
    await page.waitForSelector(".legacy-sidebar");
    await captureScreenshot(page, "clients-list-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-list-1440-dark.png", { width: 1440, height: 900 }, "dark");
    await captureScreenshot(page, "clients-list-390-light.png", { width: 390, height: 844 }, "light");
    await captureScreenshot(page, "clients-list-390-dark.png", { width: 390, height: 844 }, "dark");

    mocks.set({ detailBody: syntheticLongDetailPayload() });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}?return=${encodeURIComponent("?q=Synthetic")}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)");
    await captureScreenshot(page, "clients-detail-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-detail-1440-dark.png", { width: 1440, height: 900 }, "dark");
    await captureScreenshot(page, "clients-detail-390-light.png", { width: 390, height: 844 }, "light");
    await captureScreenshot(page, "clients-detail-390-dark.png", { width: 390, height: 844 }, "dark");
    await page.click('[data-card-tab="data"]');
    for (const width of [1440, 390]) {
      for (const theme of ["light", "dark"] as const) {
        await captureScreenshot(page, `clients-data-${width}-${theme}.png`, {width,height:900}, theme);
      }
    }

    for (const name of [
      "clients-list-1440-light.png",
      "clients-list-1440-dark.png",
      "clients-list-390-light.png",
      "clients-list-390-dark.png",
      "clients-detail-1440-light.png",
      "clients-detail-1440-dark.png",
      "clients-detail-390-light.png",
      "clients-detail-390-dark.png",
    ]) {
      assert.ok(fs.existsSync(path.join(SCREENSHOT_DIR, name)), `missing screenshot ${name}`);
    }
    await closePage(page, context);
  });

  it("shows Bitrix24 work tab with label and tasks when mocked", async () => {
    const { page, context, mocks } = await openPage();
    await mocks.set({
      bitrix24Label: {
        token: "#LK_H_000123",
        labelCode: "LK_H_000123",
        objectType: "holding",
      },
      bitrix24Tasks: {
        state: "ready",
        scopeNote: "Показаны задачи одного подтверждённого объекта.",
        portalConfigured: true,
        sync: { lastFinishedAt: "2026-09-30T09:00:00.000Z", lastStatus: "success", lastRunMode: "apply" },
        tasks: [
          {
            taskId: "9001",
            accessLevel: "full",
            title: "Поставка оборудования",
            statusLabel: "in_progress",
            deadline: "2026-10-01T12:00:00+03:00",
            changedAt: "2026-09-29T10:00:00+03:00",
            portalUrl: "https://example.bitrix24.ru/company/personal/user/42/tasks/task/view/9001/",
            responsible: {
              state: "confirmed",
              displayName: "Иванов Иван",
              internalContactEmail: "ivanov@example.com",
            },
            contactAction: {
              marked: false,
              canMark: true,
              canRevoke: false,
            },
          },
        ],
      },
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#pc-panel-overview");
    await page.click('[data-card-tab="work"]');
    await page.waitForSelector(".pc-bitrix24-token");
    assert.match(await page.locator(".pc-bitrix24-token").textContent(), /#LK_H_000123/);
    assert.match(await page.locator("#pc-panel-work").textContent(), /Поставка оборудования/);
    await captureScreenshot(page, "clients-bitrix24-work-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-bitrix24-work-390-light.png", { width: 390, height: 844 }, "light");
    await closePage(page, context);
  });

  it("navigates prototype tabs without fabricating missing data", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#pc-panel-overview");
    assert.equal(await page.locator('[role="tab"]').count(), 9);
    assert.equal(await page.locator(".pc-number").allTextContents().then(x => x.join("")), "————");
    await page.click('[data-card-open="data"]');
    assert.ok(await page.locator("#pc-panel-data").isVisible());
    await page.keyboard.press("ArrowRight");
    assert.ok(await page.locator("#pc-panel-work").isVisible());
    assert.match(
      await page.locator("#pc-panel-work").textContent(),
      /Метка ещё не выдана|Bitrix24 не настроен/,
    );
    await page.keyboard.press("Home");
    assert.ok(await page.locator("#pc-panel-overview").isVisible());
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(() => !document.querySelector(".legacy-app")?.classList.contains("sidebar-collapsed"));
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await closePage(page, context);
  });
});
