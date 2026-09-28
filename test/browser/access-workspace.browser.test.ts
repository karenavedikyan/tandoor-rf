import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

function startServer() {
  const app = createApp();
  return http.createServer(app).listen(0, "127.0.0.1");
}

describe("access workspace browser", { concurrency: false }, () => {
  let browser: Browser;
  let baseUrl = "";
  let server: http.Server;
  let approveCalls = 0;
  let revokeCalls = 0;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    browser = await chromium.launch({ headless: true });
    server = startServer();
    await new Promise<void>((resolve) => {
      server.on("listening", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function mockRolePage(
    role: string,
    screenshotName: string,
    viewport: { width: number; height: number },
  ) {
    approveCalls = 0;
    revokeCalls = 0;
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (url.pathname === "/api/auth/me") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: "11111111-1111-4111-8111-111111111111",
              email: `${role}@example.com`,
              fullName: `User ${role}`,
              role,
              status: "active",
            },
          }),
        });
        return;
      }

      if (url.pathname === "/api/access/overview") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            delegations: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                status: "pending_approval",
                effective_status: "pending_approval",
                effective_label: "На согласовании",
                starts_at: "2026-09-28T12:00:00.000Z",
                ends_at: "2026-09-29T12:00:00.000Z",
                delegator_name: "Менеджер Иванов",
                assistant_name: "Ассистент Петров",
                client_count: 2,
                pending_change: false,
                access_suspended: true,
              },
            ],
            teams:
              role === "coordinator"
                ? [{ rop_name: "РОП Сидоров", rop_email: "rop@example.com", basis: "назначение" }]
                : undefined,
          }),
        });
        return;
      }

      if (url.pathname.startsWith("/api/access/delegators/") && url.pathname.endsWith("/clients")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [{ guid: "33333333-3333-4333-8333-333333333333", name: "Альфа Клиент" }],
            total: 1,
            page: 1,
            pageSize: 50,
            totalPages: 1,
            isEmptyDatabase: false,
          }),
        });
        return;
      }

      if (url.pathname === "/api/access/coordinator-managers") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            managers: [
              {
                id: "44444444-4444-4444-8444-444444444444",
                full_name: "Менеджер Команды",
                email: "manager@example.com",
              },
            ],
          }),
        });
        return;
      }

      if (url.pathname === "/api/access/team-members") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            members: [
              {
                member_name: "Менеджер Иванов",
                member_email: "manager@example.com",
                member_role: "manager",
              },
            ],
          }),
        });
        return;
      }

      if (
        method === "POST" &&
        url.pathname === "/api/access/delegations/22222222-2222-4222-8222-222222222222/approve"
      ) {
        approveCalls += 1;
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
        return;
      }

      if (
        method === "POST" &&
        url.pathname === "/api/access/delegations/22222222-2222-4222-8222-222222222222/revoke"
      ) {
        revokeCalls += 1;
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
        return;
      }

      if (url.pathname.startsWith("/api/access/delegations/") && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            delegation: {
              id: "22222222-2222-4222-8222-222222222222",
              status: "pending_approval",
              effective_status: "pending_approval",
              effective_label: "На согласовании",
              delegator_name: "Менеджер Иванов",
              assistant_name: "Ассистент Петров",
              starts_at: "2026-09-28T12:00:00.000Z",
              ends_at: "2026-09-29T12:00:00.000Z",
              clients: [{ guid: "33333333-3333-4333-8333-333333333333", name: "Альфа" }],
              pending_change_request: null,
            },
          }),
        });
        return;
      }

      await route.fulfill({ status: 404, body: "{}" });
    });

    await page.goto(`${baseUrl}/access`, { waitUntil: "networkidle" });
    await page.waitForSelector("#access-workspace-app:not(.clients-hidden)");
    const title = await page.textContent(".clients-page-title");
    assert.match(title ?? "", /Замещения/);

    if (role === "rop" || role === "director") {
      const approveBtn = page.locator("button", { hasText: "Согласовать" }).first();
      await approveBtn.scrollIntoViewIfNeeded();
      assert.equal(await approveBtn.evaluate((el) => el.tagName), "BUTTON");
      const htmlVisible = await page.locator("text=<button").count();
      assert.equal(htmlVisible, 0);
      await approveBtn.click();
      await page.locator("button", { hasText: "Подтвердить согласование" }).click();
      await page.waitForTimeout(150);
      assert.equal(approveCalls, 1);

      const revokeBtn = page.locator("button", { hasText: "Отозвать" }).first();
      await revokeBtn.scrollIntoViewIfNeeded();
      await revokeBtn.click();
      await page.waitForTimeout(150);
      assert.equal(revokeCalls, 1);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: true });
    await context.close();
  }

  it("renders manager workspace desktop", async () => {
    await mockRolePage("manager", "r13-access-workspace-manager-desktop.png", {
      width: 1280,
      height: 900,
    });
  });

  it("renders manager workspace mobile", async () => {
    await mockRolePage("manager", "r13-access-workspace-manager-mobile.png", {
      width: 390,
      height: 844,
    });
  });

  it("renders ROP workspace with clickable buttons desktop", async () => {
    await mockRolePage("rop", "r13-access-workspace-rop-desktop.png", { width: 1280, height: 900 });
  });

  it("renders ROP workspace mobile", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/me") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: "11111111-1111-4111-8111-111111111111",
              email: "rop@example.com",
              fullName: "ROP",
              role: "rop",
              status: "active",
            },
          }),
        });
        return;
      }
      if (url.pathname === "/api/access/overview") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            delegations: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                status: "pending_approval",
                effective_status: "pending_approval",
                effective_label: "На согласовании",
                starts_at: "2026-09-28T12:00:00.000Z",
                ends_at: "2026-09-29T12:00:00.000Z",
                delegator_name: "Менеджер",
                assistant_name: "Ассистент",
                client_count: 1,
                pending_change: false,
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({ status: 404, body: "{}" });
    });
    await page.goto(`${baseUrl}/access`, { waitUntil: "networkidle" });
    await page.waitForSelector("#access-workspace-app:not(.clients-hidden)");
    const buttons = page.locator(".delegation-actions button");
    assert.ok((await buttons.count()) >= 1);
    assert.equal(await page.locator("text=<button").count(), 0);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "r13-access-workspace-rop-mobile.png"),
      fullPage: true,
    });
    await context.close();
  });

  it("renders coordinator workspace desktop", async () => {
    await mockRolePage("coordinator", "r13-access-workspace-coordinator-desktop.png", {
      width: 1280,
      height: 900,
    });
  });

  it("renders coordinator workspace mobile", async () => {
    await mockRolePage("coordinator", "r13-access-workspace-coordinator-mobile.png", {
      width: 390,
      height: 844,
    });
  });
});
