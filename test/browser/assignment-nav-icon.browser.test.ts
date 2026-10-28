import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";

const SCREENSHOT_DIR = "/cursor/stores/self/media";
const PROTOTYPE_SUBSTITUTION_PATHS = [
  "m2 9 3-3 3 3",
  "M13 18H7a2 2 0 0 1-2-2V6",
  "m22 15-3 3-3-3",
  "M11 6h6a2 2 0 0 1 2 2v10",
];

function startServer(): http.Server {
  const app = createApp();
  return http.createServer(app).listen(0, "127.0.0.1");
}

async function mockManagerSession(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "manager@example.com",
            fullName: "Synthetic Manager",
            role: "manager",
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
        body: JSON.stringify({ delegations: [], teams: [] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function readSubstitutionPaths(page: Page): Promise<string[]> {
  return page.locator('a[href="/access"] .legacy-nav-link__icon path').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("d")).filter((value): value is string => Boolean(value)),
  );
}

async function readIconBox(page: Page, href: string) {
  return page.locator(`a[href="${href}"] .legacy-icon`).first().boundingBox();
}

describe("assignment nav icon browser smoke", { concurrency: false }, () => {
  let browser: Browser;
  let baseUrl = "";
  let server: http.Server;

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
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("keeps /access link label and repeat-2 geometry in sidebar chrome", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await mockManagerSession(page);
    await page.goto(`${baseUrl}/access`, { waitUntil: "networkidle" });

    const accessLink = page.locator('a[href="/access"]');
    await accessLink.waitFor({ state: "visible" });
    assert.equal(await accessLink.getAttribute("aria-label"), "Назначения ассистентам");
    assert.match(await accessLink.innerText(), /Назначения ассистентам/);
    assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);

    const accessBox = await readIconBox(page, "/access");
    const clientsBox = await readIconBox(page, "/clients");
    assert.ok(accessBox && clientsBox);
    assert.ok(Math.abs(accessBox.width - clientsBox.width) < 1);
    assert.ok(Math.abs(accessBox.height - clientsBox.height) < 1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "assignment-nav-icon-desktop-light-expanded.png"),
    });

    await page.locator(".legacy-sidebar__collapse").click();
    await page.waitForFunction(() =>
      document.querySelector(".legacy-app")?.classList.contains("sidebar-collapsed"),
    );
    assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "assignment-nav-icon-desktop-light-collapsed.png"),
    });

    await page.locator("html").evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "assignment-nav-icon-desktop-dark-collapsed.png"),
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#legacy-menu-toggle").click();
    await page.waitForFunction(() =>
      document.getElementById("legacy-sidebar")?.classList.contains("is-open"),
    );
    assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "assignment-nav-icon-mobile-dark-menu.png"),
    });

    await context.close();
  });
});
