import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { QA_PASSWORD, seedAssignmentQa } from "../helpers/assistant-assignment-fixtures";
import { getIntegrationDatabaseUrl, setIntegrationEnv } from "../helpers/test-db";
import { loginCabinet, waitClientsShellReady } from "./helpers/cabinet-login";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ?? path.join("/cursor/stores/self/media");

describe("admin preview work mode browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "http://127.0.0.1:3000";
  let databaseUrl: string;
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
    users = await seedAssignmentQa(databaseUrl, baseUrl);
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function startServer(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl);
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async function waitStableClientsShell(page: Page): Promise<void> {
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/clients(\?|$)/, { timeout: 30000 });
    await waitClientsShellReady(page);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  }

  async function openPreviewAsManager(page: Page): Promise<void> {
    await waitStableClientsShell(page);
    const pickerReady = page.waitForSelector("#shell-preview-picker", { state: "visible", timeout: 30000 });
    await page.click("#shell-preview-open");
    await pickerReady;
    const candidates = page.waitForResponse(
      (r) => r.url().includes("/api/admin/access/preview/candidates") && r.ok(),
      { timeout: 30000 },
    );
    await page.fill("#shell-preview-query", "Морозов");
    await candidates;
    const start = page.waitForResponse(
      (r) => r.url().includes("/api/admin/access/preview/start") && r.status() === 200,
      { timeout: 30000 },
    );
    await page.click('[data-preview-id="' + users.manager!.id + '"]');
    await start;
    await page.waitForSelector(".clients-preview-banner", { timeout: 20000 });
  }

  it("preserves assignment form across readonly to work enable reload", async () => {
    await resetPoolForTests();
    await startServer();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: baseUrl });
    try {
      const page = await context.newPage();
      await loginCabinet(page, users.admin!.email, QA_PASSWORD);
      await openPreviewAsManager(page);
      await page.goto("/access", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#access-workspace-app:not(.clients-hidden)", { timeout: 30000 });
      await page.click('[data-aa="new"]');
      await page.waitForSelector("#aa-assignment-form");
      await page.waitForSelector("#aa-picker-data input[data-pick]", { timeout: 30000 });
      await page.click('[data-aa="select-found"]');
      await page.waitForFunction(() => {
        const el = document.getElementById("aa-selected");
        const m = el?.textContent?.match(/Выбрано юрлиц: (\d+)/);
        return Boolean(m && Number(m[1]) >= 11);
      });
      const selectedBefore = await page.locator("#aa-selected").innerText();
      await page.fill("#aa-basis", "Браузерный тест сохранения формы при включении рабочего режима.");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "pr116-preview-form-before-work-enable-desktop.png"),
        fullPage: true,
      });
      page.once("dialog", (d) => d.accept());
      const enable = page.waitForResponse(
        (r) => r.url().includes("/api/admin/access/preview/work/enable") && r.status() === 200,
      );
      await page.click("#clients-preview-work-btn");
      await enable;
      await page.waitForSelector(".clients-preview-banner--work");
      await page.waitForSelector("#aa-assignment-form");
      const selectedAfter = await page.locator("#aa-selected").innerText();
      assert.equal(selectedAfter, selectedBefore);
      assert.match(selectedAfter, /Выбрано юрлиц: (\d+)/);
      const count = Number(selectedAfter.match(/Выбрано юрлиц: (\d+)/)?.[1] ?? "0");
      assert.ok(count >= 11);
      assert.match(await page.locator("#aa-basis").inputValue(), /Браузерный тест/);
      assert.equal(await page.locator("#aa-assignment-form button.aa-primary").isDisabled(), false);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "pr116-preview-form-after-work-enable-desktop.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
      await stopServer();
    }
  });

  it("picker pager reaches page 4 without overflow on mobile", async () => {
    await resetPoolForTests();
    await startServer();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, baseURL: baseUrl });
    try {
      const page = await context.newPage();
      await loginCabinet(page, users.manager!.email, QA_PASSWORD);
      await page.goto("/access", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#access-workspace-app:not(.clients-hidden)");
      await page.click('[data-aa="new"]');
      await page.waitForSelector("#aa-picker-data");
      const first = await page.waitForResponse(
        (r) => r.url().includes("/delegators/") && r.url().includes("/clients?") && r.ok(),
      );
      const body = (await first.json()) as { totalPages?: number; page?: number; total?: number };
      assert.ok((body.total ?? 0) >= 50, "expected seeded client volume");
      const targetPage = Math.min(4, body.totalPages ?? 1);
      for (let p = 1; p < targetPage; p++) {
        await page.click('[data-aa="pick-next"]');
        await page.waitForResponse(
          (r) => r.url().includes("/delegators/") && r.url().includes("page=") && r.ok(),
        );
      }
      const pagerText = await page.locator("#aa-picker-data .aa-pager span").first().innerText();
      assert.match(pagerText, /Страница (\d+) из (\d+)/);
      const current = Number(pagerText.match(/Страница (\d+) из (\d+)/)?.[1]);
      const totalPages = Number(pagerText.match(/Страница (\d+) из (\d+)/)?.[2]);
      assert.ok(current >= 1 && current <= totalPages);
      if (targetPage >= 4) {
        assert.equal(current, 4);
      }
      assert.ok(await page.locator("#aa-picker-data input[data-pick]").count() > 0);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "pr116-assignment-picker-page4-mobile375-dark.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
      await stopServer();
    }
  });
});
