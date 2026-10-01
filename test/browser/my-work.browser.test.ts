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

const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "22222222-2222-4222-8222-222222222222";

type MockState = {
  deadlineGroup: string;
  page: number;
  contactMarked: boolean;
  contactComment: string;
  checklistExpanded: boolean;
  delayedMs: number;
  failRefresh: boolean;
};

function buildWorkPayload(state: MockState) {
  const openCounts = { overdue: 1, today: 0, upcoming: 0, no_deadline: 0, completed: 1 };
  const items =
    state.deadlineGroup === "completed"
      ? [
          {
            taskId: "91002",
            clientGuid: CLIENT_TWO,
            clientName: "Beta Client",
            clients: [{ clientGuid: CLIENT_TWO, clientName: "Beta Client" }],
            accessLevel: "full",
            title: "Завершённая задача",
            statusLabel: "Завершена",
            deadline: "01.09.2026, 12:00",
            isOverdue: false,
            responsible: { state: "confirmed", displayName: "Manager A" },
            checklist: { state: "ready", progress: { completed: 3, total: 3 }, syncedAtLabel: "01.10.2026, 12:00" },
            portalUrl: "https://example.bitrix24.ru/tasks/91002/",
            contactAction: null,
          },
        ]
      : [
          {
            taskId: "91001",
            clientGuid: CLIENT_ONE,
            clientName: "Alpha Client",
            clients: [
              { clientGuid: CLIENT_ONE, clientName: "Alpha Client" },
              { clientGuid: CLIENT_TWO, clientName: "Beta Client" },
            ],
            accessLevel: "full",
            title: "Подготовить отгрузку",
            statusLabel: "В работе",
            deadline: "01.10.2026, 15:00",
            isOverdue: true,
            responsible: { state: "confirmed", displayName: "Manager A" },
            checklist: { state: "ready", progress: { completed: 2, total: 5 }, syncedAtLabel: "01.10.2026, 12:00" },
            portalUrl: "https://example.bitrix24.ru/tasks/91001/",
            contactAction: {
              marked: state.contactMarked,
              comment: state.contactComment,
              canMark: true,
              canRevoke: state.contactMarked,
              markedAtLabel: state.contactMarked ? "01.10.2026, 11:00" : null,
              markedByDisplayName: state.contactMarked ? "Manager User" : null,
            },
          },
        ];

  return {
    state: "ready",
    message: null,
    items,
    total: items.length,
    page: state.page,
    pageSize: 1,
    totalPages: state.deadlineGroup === "completed" ? 1 : 2,
    counts: openCounts,
    loadedAt: new Date().toISOString(),
    loadedAtLabel: "01.10.2026, 12:00",
    cacheLatestSyncedAt: new Date().toISOString(),
    cacheLatestSyncedAtLabel: "01.10.2026, 11:30",
    sync: null,
    options: {
      clients: [
        { id: CLIENT_ONE, name: "Alpha Client" },
        { id: CLIENT_TWO, name: "Beta Client" },
      ],
      responsibles: [{ id: "42", name: "Manager A" }],
      statusLabels: [
        { id: "in_progress", name: "В работе" },
        { id: "completed", name: "Завершена" },
      ],
    },
  };
}

async function installWorkMocks(page: Page, state: MockState): Promise<void> {
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
      if (state.failRefresh) {
        state.failRefresh = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' });
        return;
      }
      state.deadlineGroup = url.searchParams.get("deadlineGroup") ?? "";
      state.page = Number(url.searchParams.get("page") ?? "1");
      if (state.delayedMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayedMs));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildWorkPayload(state)),
      });
      return;
    }
    if (url.pathname === `/api/clients/${CLIENT_ONE}/bitrix24/tasks`) {
      const checklist =
        state.checklistExpanded
          ? {
              state: "ready",
              progress: { completed: 2, total: 5 },
              syncedAtLabel: "01.10.2026, 12:00",
              items: [
                {
                  id: "1",
                  title: "Проверить документы",
                  isGroup: false,
                  isComplete: true,
                  sortIndex: 0,
                  coExecutorNames: [],
                  children: [],
                },
              ],
            }
          : { state: "stale", syncedAtLabel: "01.10.2026, 10:00" };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "ready",
          tasks: [
            {
              taskId: "91001",
              accessLevel: "full",
              title: "Подготовить отгрузку",
              statusLabel: "В работе",
              deadline: "01.10.2026, 15:00",
              checklist,
              contactAction: null,
            },
          ],
        }),
      });
      return;
    }
    if (
      url.pathname === `/api/clients/${CLIENT_ONE}/bitrix24/tasks/91001/contact` &&
      route.request().method() === "PUT"
    ) {
      const body = route.request().postDataJSON() as { marked?: boolean; comment?: string };
      state.contactMarked = Boolean(body.marked);
      if (body.comment !== undefined) {
        state.contactComment = body.comment ?? "";
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          marked: state.contactMarked,
          comment: state.contactComment,
        }),
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
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("handles filters, pagination, contact, checklist and refresh errors", async () => {
    for (const width of [1440, 375]) {
      const state: MockState = {
        deadlineGroup: "",
        page: 1,
        contactMarked: false,
        contactComment: "",
        checklistExpanded: false,
        delayedMs: 0,
        failRefresh: false,
      };
      const context: BrowserContext = await browser.newContext({
        viewport: { width, height: 900 },
        baseURL: baseUrl,
      });
      const page = await context.newPage();
      await installWorkMocks(page, state);
      await page.goto("/work");
      await page.waitForSelector("#work-app:not(.clients-hidden)");
      await page.waitForSelector(".work-row");

      assert.match(await page.locator(".work-row__title").innerText(), /Подготовить/);
      assert.ok((await page.locator(".work-chip").count()) >= 5);

      const overdueChip = page.locator('[data-deadline-group="overdue"]');
      const completedChip = page.locator('[data-deadline-group="completed"]');
      assert.match(await overdueChip.locator(".work-chip__count").innerText(), /1/);
      assert.match(await completedChip.locator(".work-chip__count").innerText(), /1/);

      state.delayedMs = 400;
      await completedChip.click();
      await overdueChip.click();
      await page.waitForSelector(".work-row__title", { timeout: 5000 });
      assert.match(await page.locator(".work-row__title").innerText(), /Подготовить/);

      await page.locator("#work-client-filter").selectOption(CLIENT_TWO);
      await page.waitForTimeout(400);

      state.checklistExpanded = true;
      const details = page.locator(".pc-bitrix24-checklist--lazy");
      await details.locator("summary").click();
      await page.waitForSelector(".pc-bitrix24-checklist-item", { timeout: 5000 });
      assert.match(await page.locator(".pc-bitrix24-checklist-title").innerText(), /Проверить/);

      const checkbox = page.locator(".pc-bitrix24-contact-checkbox");
      await checkbox.check();
      await page.waitForTimeout(300);
      assert.equal(await checkbox.isChecked(), true);

      const commentInput = page.locator(".pc-bitrix24-contact-comment-input");
      await commentInput.fill("Написал из очереди");
      await page.locator(".pc-bitrix24-contact-comment-btn").click();
      await page.waitForTimeout(300);
      assert.match(await commentInput.inputValue(), /Написал из очереди/);

      state.failRefresh = true;
      await page.locator("#work-refresh-cache").click();
      await page.waitForFunction(() => {
        const el = document.getElementById("work-refresh-status");
        return el && /Не удалось/i.test(el.textContent || "");
      });

      const clientLink = page.locator(".work-row__client").first();
      assert.match(await clientLink.getAttribute("href"), /tab=work&task=91001/);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `my-work-interactive-${width}.png`),
        fullPage: true,
      });
      await context.close();
    }
  });
});
