import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
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
  let port = 0;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    browser = await chromium.launch({ headless: true });
    server = startServer();
    await new Promise<void>((resolve) => {
      server.on("listening", () => {
        const address = server.address();
        port = typeof address === "object" && address ? address.port : 0;
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

  async function mockRolePage(role: string, screenshotName: string) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
                starts_at: "2026-09-28T10:00:00.000Z",
                ends_at: "2026-09-29T10:00:00.000Z",
                delegator_name: "Менеджер Иванов",
                assistant_name: "Ассистент Петров",
                client_count: 2,
                pending_change: false,
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
      if (url.pathname === "/api/clients") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [{ guid: "33333333-3333-4333-8333-333333333333", name: "Альфа Клиент" }],
            total: 1,
            page: 1,
            pageSize: 100,
            totalPages: 1,
            isEmptyDatabase: false,
          }),
        });
        return;
      }
      if (url.pathname === "/api/access/team-members") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            members: [{ member_name: "Менеджер Иванов", member_email: "manager@example.com", member_role: "manager" }],
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
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: true });
    await context.close();
  }

  it("renders manager workspace", async () => {
    await mockRolePage("manager", "r13-access-workspace-manager.png");
  });

  it("renders ROP workspace", async () => {
    await mockRolePage("rop", "r13-access-workspace-rop.png");
  });

  it("renders coordinator workspace", async () => {
    await mockRolePage("coordinator", "r13-access-workspace-coordinator.png");
  });
});
