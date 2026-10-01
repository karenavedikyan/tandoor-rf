import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createApp } from "../../src/server";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

function workListPayload() {
  return {
    state: "ready",
    message: null,
    items: [
      {
        taskId: "91001",
        clientGuid: "11111111-1111-4111-8111-111111111111",
        clientName: "Alpha Client",
        accessLevel: "full",
        title: "Подготовить отгрузку",
        statusLabel: "В работе",
        deadline: "01.10.2026, 15:00",
        isOverdue: true,
        responsible: { state: "confirmed", displayName: "Manager A" },
        checklist: { state: "ready", progress: { completed: 2, total: 5 }, syncedAtLabel: "01.10.2026, 12:00" },
        portalUrl: "https://example.bitrix24.ru/company/personal/user/42/tasks/task/view/91001/",
        contactAction: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    counts: { overdue: 1, today: 0, upcoming: 0, no_deadline: 0, completed: 0 },
    loadedAt: new Date().toISOString(),
    loadedAtLabel: "01.10.2026, 12:00",
    cacheLatestSyncedAt: new Date().toISOString(),
    cacheLatestSyncedAtLabel: "01.10.2026, 11:30",
    sync: null,
    options: {
      clients: [{ id: "11111111-1111-4111-8111-111111111111", name: "Alpha Client" }],
      responsibles: [{ id: "42", name: "Manager A" }],
      statusLabels: [{ id: "in_progress", name: "В работе" }],
    },
  };
}

async function installWorkMocks(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "u1", email: "mgr@example.com", fullName: "Manager User", role: "manager" },
        }),
      });
      return;
    }
    if (url.pathname === "/api/work/tasks") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(workListPayload()),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '{"error":"not mocked"}' });
  });
}

describe("my work browser", { concurrency: false }, () => {
  let server: http.Server;
  let baseUrl = "";
  let browser: Browser;
  let context: BrowserContext;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await context?.close();
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("renders queue on desktop and mobile widths", async () => {
    for (const width of [1440, 375]) {
      context = await browser.newContext({
        viewport: { width, height: 900 },
        baseURL: baseUrl,
      });
      const page = await context.newPage();
      await installWorkMocks(page);
      await page.goto("/work");
      await page.waitForSelector("#work-app:not(.clients-hidden)");
      await page.waitForSelector(".work-row");
      assert.ok(await page.locator(".work-chip").count() >= 5);
      assert.match(await page.locator(".work-row__title").innerText(), /Подготовить/);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `my-work-${width}.png`),
        fullPage: true,
      });
      await context.close();
    }
  });
});
