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
      const mock = resolveMockResponse(url, options, state, route.request().method());
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
            isOpen: true,
            isOverdue: false,
            deadlineAt: "2030-10-01T09:00:00Z",
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
    // Exercise the real UI controls against a stateful API, not only static rendering.
    const work = mocks.options.bitrix24Tasks as any;
    const task = work.tasks[0];
    const payloads: Array<{ marked: boolean; comment?: string }> = [];
    let rejectMutation = true;
    await page.route("**/bitrix24/tasks/9001/contact", async (route) => {
      assert.equal(route.request().method(), "PUT");
      const payload = route.request().postDataJSON();
      payloads.push(payload);
      if (rejectMutation) {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "Доступ отозван" }) });
        return;
      }
      task.contactAction = {
        marked: payload.marked,
        canMark: true,
        canRevoke: payload.marked,
        markedAtLabel: payload.marked ? "30.09.2026 22:45" : null,
        markedByDisplayName: payload.marked ? "Тестовый сотрудник" : null,
        comment: payload.marked ? (payload.comment ?? task.contactAction.comment ?? null) : null,
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(task.contactAction) });
    });
    const checkbox = page.getByRole("checkbox", { name: "Связаться с ответственным" });
    assert.equal(await page.locator(".pc-bitrix24-contact-comment-btn").count(), 0);
    // This request is intentionally denied and immediately rolls the control back.
    await checkbox.click();
    await page.waitForSelector(".pc-bitrix24-contact-status.workspace-status--error");
    assert.equal(await checkbox.isChecked(), false);
    assert.match(await page.locator("#pc-panel-work .pc-bitrix24-contact-status").textContent(), /Доступ отозван/);
    rejectMutation = false;
    await checkbox.check();
    await page.waitForSelector("#pc-panel-work .pc-bitrix24-contact-done");
    assert.match(await page.locator("#pc-panel-work .pc-bitrix24-contact-done").textContent(), /Тестовый сотрудник/);
    await page.locator(".pc-bitrix24-contact-comment-input").fill("Связался, ожидаем решение");
    await page.getByRole("button", { name: "Сохранить комментарий" }).click();
    await page.waitForSelector("#pc-panel-work .pc-bitrix24-contact-comment");
    assert.match(await page.locator("#pc-panel-work .pc-bitrix24-contact-comment").textContent(), /ожидаем решение/);
    await page.reload();
    await page.waitForSelector("#pc-panel-overview");
    await page.click('[data-card-tab="work"]');
    await page.waitForSelector("#pc-panel-work .pc-bitrix24-contact-done");
    assert.equal(await checkbox.isChecked(), true);
    await captureScreenshot(page, "clients-bitrix24-contact-390-light.png", { width: 390, height: 844 }, "light");
    await captureScreenshot(page, "clients-bitrix24-contact-1440-dark.png", { width: 1440, height: 900 }, "dark");
    await page.getByRole("button", { name: "Отменить отметку" }).click();
    await page.waitForFunction(() => !document.querySelector(".pc-bitrix24-contact-revoke-btn"));
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await page.locator(".pc-bitrix24-contact-comment-btn").count(), 0);
    assert.deepEqual(payloads, [
      { marked: true }, { marked: true },
      { marked: true, comment: "Связался, ожидаем решение" }, { marked: false },
    ]);
    // A restricted summary never acquires a task title or a full-task link.
    task.accessLevel = "summary";
    task.briefText = "Уточнить срок у ответственного";
    delete task.title;
    delete task.portalUrl;
    await page.reload();
    await page.waitForSelector("#pc-panel-overview");
    await page.click('[data-card-tab="work"]');
    await page.waitForSelector(".pc-bitrix24-task--summary");
    assert.equal(await page.locator(".pc-bitrix24-open-task").count(), 0);
    assert.match(await page.locator("#pc-panel-work").textContent(), /Иванов Иван/);
    assert.equal((await page.locator("#pc-panel-work").textContent())?.includes("Поставка оборудования"), false);
    await closePage(page, context);
  });

  it("shows claims tab with published summary at 375px", async () => {
    const { page, context, mocks } = await openPage();
    await page.setViewportSize({ width: 375, height: 844 });
    await mocks.set({
      bitrix24Label: { token: "#LK_H_000123" },
      bitrix24Tasks: { state: "ready", tasks: [] },
      bitrix24Claims: {
        state: "ready",
        count: 1,
        sync: { lastFinishedAtLabel: "30.09.2026, 12:00", lastStatus: "success", partial: false },
        claims: [
          {
            taskId: "9001",
            accessLevel: "summary",
            briefText: "Рекламация принята. Ожидаем поставку 15 октября.",
            publishedAtLabel: "30.09.2026, 11:00",
            cacheSyncedAtLabel: "30.09.2026, 12:00",
            responsible: { state: "confirmed", displayName: "Иванов Иван" },
            contactAction: { canMark: true, canRevoke: false, marked: false },
          },
        ],
      },
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#pc-panel-overview");
    await page.click('[data-card-tab="claims"]');
    await page.waitForSelector("#pc-panel-claims .pc-bitrix24-claim");
    assert.match(
      await page.locator("#pc-panel-claims .pc-bitrix24-claim__text").textContent(),
      /Рекламация принята/,
    );
    assert.equal(
      (await page.locator('[data-stat-claims]').textContent())?.trim(),
      "1",
    );
    assert.equal(
      (await page.locator("#pc-panel-claims").textContent())?.includes("Поставка оборудования"),
      false,
    );
    await captureScreenshot(page, "clients-claims-375-light.png", { width: 375, height: 844 }, "light");
    await closePage(page, context);
  });

  it("ignores stale claims response after access is revoked", async () => {
    const { page, context } = await openPage();
    let calls = 0;
    await page.route(`**/api/clients/${SYNTHETIC_CLIENT_GUID}/bitrix24/claims`, async (route) => {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "ready",
            count: 1,
            claims: [
              {
                taskId: "9001",
                accessLevel: "summary",
                briefText: "Старый текст не должен остаться",
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Forbidden" } }),
      });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector(".pc-workspace");
    await page.evaluate((guid) => {
      const wrapper = document.querySelector(".pc-workspace");
      if (window.ClientBitrix24 && wrapper) {
        window.ClientBitrix24.mountClaimsTab(wrapper, guid);
      }
    }, SYNTHETIC_CLIENT_GUID);
    await page.waitForTimeout(600);
    const panelText = (await page.locator("#pc-panel-claims").textContent()) ?? "";
    assert.equal(panelText.includes("Старый текст не должен остаться"), false);
    assert.match(panelText, /недоступен/i);
    assert.equal((await page.locator('[data-stat-claims]').textContent())?.trim(), "—");
    await closePage(page, context);
  });

  it("shows matching checklist progress in overview and collapsible work details", async () => {
    const checklist = {
      state: "ready",
      syncedAtLabel: "30.09.2026 12:00",
      progress: { completed: 2, total: 3 },
      items: [
        {
          id: "431",
          title: "Чек-лист 1",
          isGroup: true,
          isComplete: null,
          sortIndex: 0,
          coExecutorNames: [],
          children: [
            {
              id: "433",
              title: "Найти документы",
              isGroup: false,
              isComplete: true,
              sortIndex: 0,
              coExecutorNames: [],
              children: [],
            },
            {
              id: "447",
              title: "Согласовать детали",
              isGroup: true,
              isComplete: null,
              sortIndex: 1,
              coExecutorNames: [],
              children: [
                {
                  id: "471",
                  title: "Подготовить решение",
                  isGroup: false,
                  isComplete: false,
                  sortIndex: 1,
                  coExecutorNames: [],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const tasks = [
      {
        taskId: "9002",
        title: "Получить документы",
        accessLevel: "full",
        statusLabel: "В работе",
        isOpen: true,
        isOverdue: false,
        deadlineAt: "2030-10-01T10:00:00Z",
        deadline: "1 окт. 2030 г.",
        responsible: { state: "confirmed", displayName: "Иванов Иван", internalContactEmail: "ivanov@example.com" },
        checklist,
        contactAction: { marked: false, canMark: true, canRevoke: false },
      },
      {
        taskId: "9005",
        accessLevel: "summary",
        briefText: "Разрешённое поручение",
        statusLabel: "В работе",
        isOpen: true,
        isOverdue: null,
        responsible: { state: "confirmed", displayName: "Иванов Иван", internalContactEmail: "ivanov@example.com" },
        contactAction: { marked: false, canMark: true, canRevoke: false },
      },
    ];
    const { page, context } = await openPage({
      bitrix24Tasks: { state: "ready", tasks },
      bitrix24Label: { token: "#LK_H_000123" },
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    const overview = page.locator("#pc-bitrix24-overview");
    await page.waitForSelector(".pc-bitrix24-checklist-progress");
    const fullOverview = overview.locator('[data-overview-task-id="9002"]');
    assert.match(await fullOverview.textContent(), /Чек-лист: выполнено 2 из 3/);
    assert.equal(await overview.locator('[data-overview-task-id="9005"] .pc-bitrix24-checklist-progress').count(), 0);
    await overview.getByRole("button", { name: "Все доступные задачи (2) →" }).click();
    const workTask = page.locator("#pc-panel-work .pc-bitrix24-task").first();
    assert.match(await workTask.textContent(), /Чек-лист: выполнено 2 из 3/);
    assert.equal(await workTask.locator(".pc-bitrix24-contact-checkbox").count(), 1);
    await workTask.locator(".pc-bitrix24-checklist-summary").click();
    await page.waitForSelector(".pc-bitrix24-checklist-item");
    assert.match(await workTask.textContent(), /Подготовить решение/);
    assert.equal(await workTask.locator(".pc-bitrix24-checklist-state--done").count(), 1);
    await page.setViewportSize({ width: 375, height: 844 });
    await page.waitForTimeout(150);
    assert.match(await workTask.textContent(), /Найти документы/);
    await closePage(page, context);
  });

  it("shares authorized tasks and personal marks between overview and work", async () => {
    const task = (id: string, title: string, deadline: string | null, overrides = {}) => ({
      taskId: id, title, accessLevel: "full", statusLabel: "В работе",
      isOpen: true, isOverdue: false, deadlineAt: deadline, deadline: deadline ? "1 окт. 2030 г." : null,
      responsible: { state: "confirmed", displayName: "Иванов Иван", internalContactEmail: "ivanov@example.com" },
      contactAction: { marked: false, canMark: true, canRevoke: false },
      ...overrides,
    });
    const tasks = [
      task("9001", "Завершённая задача", null, { isOpen: false, statusLabel: "Завершена" }),
      task("9003", "Согласовать поставку", "2030-10-02T10:00:00Z"),
      task("9002", "Получить документы", "2030-10-01T10:00:00Z"),
      task("9004", "Уточнить просроченную поставку", "2020-01-01T10:00:00Z", { isOverdue: true, deadline: "1 янв. 2020 г." }),
      task("9005", undefined as any, null, { accessLevel: "summary", briefText: "Разрешённое поручение", isOverdue: null }),
    ];
    const { page, context, mocks } = await openPage({
      bitrix24Tasks: { state: "ready", tasks }, bitrix24Label: { token: "#LK_H_000123" },
    });
    let taskReads = 0;
    page.on("request", (req) => { if (req.url().endsWith("/bitrix24/tasks")) taskReads++; });
    await page.route("**/bitrix24/tasks/9004/contact", async (route) => {
      const body = route.request().postDataJSON();
      assert.equal(route.request().method(), "PUT");
      tasks[3].contactAction = { marked: body.marked, canMark: true, canRevoke: body.marked };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tasks[3].contactAction) });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    const overview = page.locator("#pc-bitrix24-overview");
    await page.waitForSelector(".pc-bitrix24-overview-task");
    assert.equal(taskReads, 1, "no second task fetch for the overview");
    assert.deepEqual(await overview.locator("[data-overview-task-id]").evaluateAll(nodes => nodes.map(n => n.getAttribute("data-overview-task-id"))), ["9004", "9002", "9003"]);
    assert.match(await overview.locator(".pc-bitrix24-summary-counts").textContent(), /Открыто: 4.*Просрочено: не менее 1/);
    assert.equal((await overview.textContent())?.includes("Завершённая задача"), false);
    const overviewMark = overview.locator('[data-task-id="9004"] input[type="checkbox"]');
    await overviewMark.check();
    await page.waitForFunction(() => (document.querySelector('#pc-panel-work [data-task-id="9004"] input') as HTMLInputElement)?.checked === true);
    assert.equal(await overviewMark.isChecked(), true);
    await overview.getByRole("button", { name: "Все доступные задачи (5) →" }).click();
    assert.ok(await page.locator("#pc-panel-work").isVisible());
    assert.equal(await page.locator("#pc-panel-work .pc-bitrix24-task").count(), 5);
    const workMark = page.locator('#pc-panel-work [data-task-id="9004"] input');
    assert.equal(await workMark.isChecked(), true);
    await workMark.uncheck();
    await page.waitForFunction(() => (document.querySelector('#pc-bitrix24-overview [data-task-id="9004"] input') as HTMLInputElement)?.checked === false);
    await page.getByRole("tab", { name: "Обзор", exact: true }).click();
    assert.equal(await overviewMark.isChecked(), false);
    await captureScreenshot(page, "clients-bitrix24-overview-1440-light.png", { width: 1440, height: 900 }, "light");
    await captureScreenshot(page, "clients-bitrix24-overview-375-light.png", { width: 375, height: 844 }, "light");
    await captureScreenshot(page, "clients-bitrix24-overview-1440-dark.png", { width: 1440, height: 900 }, "dark");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    mocks.set({ bitrix24Tasks: { state: "access_expired", tasks: [] } });
    await overview.getByRole("button", { name: "Обновить данные ЛК" }).click();
    await page.waitForFunction(() => document.querySelector("#pc-bitrix24-overview")?.textContent?.includes("истекло"));
    assert.equal(await overview.locator(".pc-bitrix24-overview-task").count(), 0);
    assert.equal(await overview.locator(".pc-bitrix24-summary-counts").count(), 0);
    assert.equal(await page.locator("#pc-panel-work .pc-bitrix24-task").count(), 0);
    // An error is not an empty queue or zero overdue tasks.
    await page.route("**/bitrix24/tasks", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await overview.getByRole("button", { name: "Обновить данные ЛК" }).click();
    await page.waitForFunction(() => document.querySelector("#pc-bitrix24-overview")?.textContent?.includes("Не удалось"));
    assert.equal(await overview.locator(".pc-bitrix24-summary-counts").count(), 0);
    await closePage(page, context);
  });

  it("keeps active tab when user leaves overview during sync wait", async () => {
    const tasks = [
      {
        taskId: "9001",
        title: "Получить документы",
        accessLevel: "full",
        statusLabel: "В работе",
        isOpen: true,
        isOverdue: false,
        checklist: { state: "ready", progress: { completed: 1, total: 2 }, items: [] },
        contactAction: { marked: false, canMark: true, canRevoke: false },
      },
    ];
    const { page, context } = await openPage({
      bitrix24Tasks: { state: "ready", tasks },
      bitrix24Label: { token: "#LK_H_000123" },
    });
    await page.route("**/bitrix24/sync", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          complete: true,
          message: "Данные задач и чек-листов обновлены.",
          syncedAtLabel: "30.09.2026, 12:05",
          tasksSynced: 1,
          checklistsSynced: 1,
        }),
      });
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector('[data-testid="bitrix24-sync-btn"]');
    await page.locator("#pc-bitrix24-overview [data-testid='bitrix24-sync-btn']").click();
    await page.click('[data-card-tab="work"]');
    await page.locator("#pc-panel-work .pc-bitrix24-sync-status.workspace-status--success").waitFor({
      state: "visible",
    });
    assert.equal(await page.locator('[data-card-tab="work"][aria-selected="true"]').count(), 1);
    assert.equal(await page.locator('[data-card-tab="overview"][aria-selected="true"]').count(), 0);
    await closePage(page, context);
  });

  it("preserves expanded checklist after manual sync reload", async () => {
    const tasks = [
      {
        taskId: "9001",
        title: "Получить документы",
        accessLevel: "full",
        statusLabel: "В работе",
        isOpen: true,
        isOverdue: false,
        checklist: {
          state: "ready",
          progress: { completed: 1, total: 2 },
          syncedAtLabel: "30.09.2026, 10:00",
          items: [{ itemId: "1", title: "Шаг 1", isGroup: false, isComplete: true, children: [] }],
        },
        contactAction: { marked: true, canMark: true, canRevoke: true, markedAtLabel: "30.09.2026, 09:00", markedByDisplayName: "Тест" },
      },
    ];
    const { page, context } = await openPage({
      bitrix24Tasks: { state: "ready", tasks },
      bitrix24Label: { token: "#LK_H_000123" },
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.click('[data-card-tab="work"]');
    await page.waitForSelector("#pc-panel-work .pc-bitrix24-checklist-summary");
    await page.locator("#pc-panel-work .pc-bitrix24-checklist-summary").click();
    await page.waitForSelector("#pc-panel-work .pc-bitrix24-checklist-item");
    await page.locator("#pc-panel-work [data-testid='bitrix24-sync-btn']").click();
    await page.locator("#pc-panel-work .pc-bitrix24-sync-status.workspace-status--success").waitFor({
      state: "visible",
    });
    await page.waitForSelector("#pc-panel-work .pc-bitrix24-checklist[open]");
    assert.equal(await page.locator("#pc-panel-work .pc-bitrix24-contact-checkbox:checked").count(), 1);
    await closePage(page, context);
  });

  it("shows cooldown status for repeated sync without calling webhook", async () => {
    const { page, context } = await openPage({
      bitrix24Sync: 429,
      bitrix24Tasks: { state: "ready", tasks: [] },
      bitrix24Label: { token: "#LK_H_000123" },
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.locator('[data-testid="bitrix24-sync-btn"]').first().click();
    await page.waitForSelector(".pc-bitrix24-sync-status.workspace-status--error");
    assert.match(await page.locator(".pc-bitrix24-sync-status").first().textContent(), /недоступен|выполняется/i);
    await closePage(page, context);
  });

  it("runs manual Bitrix24 sync from shared toolbar without calling webhook", async () => {
    const tasks = [
      {
        taskId: "9001",
        title: "Получить документы",
        accessLevel: "full",
        statusLabel: "В работе",
        isOpen: true,
        isOverdue: false,
        deadlineAt: "2030-10-01T10:00:00Z",
        deadline: "1 окт. 2030 г.",
        responsible: { state: "confirmed", displayName: "Иванов Иван", internalContactEmail: "ivanov@example.com" },
        checklist: { state: "ready", progress: { completed: 1, total: 2 }, syncedAtLabel: "30.09.2026, 10:00", items: [] },
        contactAction: { marked: false, canMark: true, canRevoke: false },
      },
    ];
    const { page, context } = await openPage({
      bitrix24Tasks: { state: "ready", tasks },
      bitrix24Label: { token: "#LK_H_000123" },
    });
    const externalCalls: string[] = [];
    page.on("request", (req) => {
      if (/bitrix24\.ru\/rest\//.test(req.url())) {
        externalCalls.push(req.url());
      }
    });
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector('[data-testid="bitrix24-sync-btn"]');
    const syncButtons = page.locator('[data-testid="bitrix24-sync-btn"]');
    assert.equal(await syncButtons.count(), 2);
    await syncButtons.first().click();
    await page.waitForSelector(".pc-bitrix24-sync-status.workspace-status--success");
    assert.match(await page.locator(".pc-bitrix24-sync-status").first().textContent(), /Обновлено/);
    assert.equal(externalCalls.length, 0);
    await page.setViewportSize({ width: 375, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await syncButtons.count(), 2);
    await closePage(page, context);
  });

  for (const syncStatus of ["partial", "failed", "forbidden", "reload-failed"]) {
    it(`clears stale checklist progress after ${syncStatus} sync/reload`, async () => {
      const task = {
        taskId: "9001", title: "Документы", accessLevel: "full",
        statusLabel: "В работе", isOpen: true,
        responsible: { state: "confirmed", displayName: "Иванов Иван" },
        checklist: { state: "ready", progress: { completed: 2, total: 3 }, items: [] },
        contactAction: { marked: false, canMark: true, canRevoke: false },
      };
      const { page, context } = await openPage({
        bitrix24Tasks: { state: "ready", tasks: [task] },
        bitrix24Label: { token: "#LK_H_000123" },
      });
      await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
      await page.waitForSelector(".pc-bitrix24-checklist-progress");
      let taskReloads = 0;
      await page.route("**/bitrix24/tasks", async route => {
        taskReloads++;
        await route.fulfill({
          status: syncStatus === "reload-failed" ? 500 : syncStatus === "forbidden" ? 403 : 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "ready", tasks: [{ ...task, checklist: { state: "error", items: [] } }],
          }),
        });
      });
      await page.route("**/bitrix24/sync", async route => {
        await route.fulfill({
          status: syncStatus === "forbidden" ? 403 : 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: syncStatus === "reload-failed" ? "success" : syncStatus,
            complete: syncStatus === "reload-failed",
            message: "Результат синхронизации",
          }),
        });
      });
      await page.locator("#pc-bitrix24-overview [data-testid='bitrix24-sync-btn']").click();
      await page.waitForFunction(() =>
        !document.querySelector(".pc-bitrix24-checklist-progress") &&
        !!document.querySelector(".pc-bitrix24-sync-status.workspace-status--error"),
      );
      assert.ok(taskReloads >= 1);
      assert.equal(await page.locator(".pc-bitrix24-sync-status.workspace-status--success").count(), 0);
      assert.equal(await page.locator(".pc-bitrix24-checklist-progress").count(), 0);
      await closePage(page, context);
    });
  }

  it("navigates prototype tabs without fabricating missing data", async () => {
    const { page, context } = await openPage();
    await page.goto(`${baseUrl}/clients/${SYNTHETIC_CLIENT_GUID}`);
    await page.waitForSelector("#pc-panel-overview");
    assert.equal(await page.locator('[role="tab"]').count(), 9);
    assert.equal(await page.locator(".pc-number").allTextContents().then(x => x.join("")), "———0");
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
