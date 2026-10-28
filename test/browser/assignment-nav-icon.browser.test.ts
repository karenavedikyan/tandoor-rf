import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";

const SCREENSHOT_DIR = "/cursor/stores/self/media";
const MANAGER_ID = "11111111-1111-4111-8111-111111111111";
const PROTOTYPE_SUBSTITUTION_PATHS = [
  "m2 9 3-3 3 3",
  "M13 18H7a2 2 0 0 1-2-2V6",
  "m22 15-3 3-3-3",
  "M11 6h6a2 2 0 0 1 2 2v10",
];

const SYNTHETIC_ASSISTANT = {
  id: "22222222-2222-4222-8222-222222222222",
  full_name: "Synthetic Assistant",
  email: "assistant@example.com",
};

function startServer(): http.Server {
  const app = createApp();
  return http.createServer(app).listen(0, "127.0.0.1");
}

function emptyAssignmentsList(pageNum = 1) {
  return {
    items: [],
    total: 0,
    page: pageNum,
    pageSize: 30,
    coordinatorCount: 1,
  };
}

function emptyNotifications(pageNum = 1) {
  return {
    items: [],
    total: 0,
    unread: 0,
    page: pageNum,
    pageSize: 30,
    serverNow: new Date().toISOString(),
    reviewPendingCount: 0,
    reviewPendingAssignmentId: null,
    nextReviewDueAt: null,
    nextScopeChangeAt: null,
    scopeRevision: null,
  };
}

async function mockManagerSession(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: MANAGER_ID,
            email: "manager@example.com",
            fullName: "Synthetic Manager",
            role: "manager",
            status: "active",
          },
          preview: { active: false },
        }),
      });
      return;
    }

    if (url.pathname === "/api/clients/presentation") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          presentation: { clientsHref: "/clients?v3mode=1&v3entity=legal_grouped" },
        }),
      });
      return;
    }

    if (url.pathname === "/api/access/assignments/assistants") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [SYNTHETIC_ASSISTANT] }),
      });
      return;
    }

    if (url.pathname === "/api/access/assignments" && method === "GET") {
      const pageNum = Number(url.searchParams.get("page") || "1");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyAssignmentsList(pageNum)),
      });
      return;
    }

    if (url.pathname === "/api/access/notifications" && method === "GET") {
      const pageNum = Number(url.searchParams.get("page") || "1");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyNotifications(pageNum)),
      });
      return;
    }

    if (url.pathname.startsWith("/api/access/notifications/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: `Unexpected API in icon test: ${method} ${url.pathname}` } }),
    });
  });
}

function attachErrorGuards(page: Page, bucket: string[]): void {
  page.on("pageerror", (err) => bucket.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      bucket.push(`console.error: ${msg.text()}`);
    }
  });
}

async function disableMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }",
  });
}

async function waitForSidebarDrawerOpen(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const sidebar = document.getElementById("legacy-sidebar");
    if (!sidebar || !sidebar.classList.contains("is-open")) {
      return false;
    }
    const rect = sidebar.getBoundingClientRect();
    return rect.x >= -0.5 && rect.width >= 200;
  });
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== theme) {
    await page.locator(".legacy-topbar [data-theme-toggle]").click();
  }
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
  await page.evaluate(() => document.fonts.ready);
}

async function readSubstitutionPaths(page: Page): Promise<string[]> {
  return page.locator('a[href="/access"] .legacy-nav-link__icon path').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("d")).filter((value): value is string => Boolean(value)),
  );
}

async function assertSubstitutionIconVisible(page: Page, viewportWidth: number): Promise<void> {
  const metrics = await page.locator('a[href="/access"] .legacy-icon').first().evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    const style = getComputedStyle(svg);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: Number(style.opacity),
      display: style.display,
      visibility: style.visibility,
    };
  });
  assert.ok(metrics.width > 0 && metrics.height > 0, "substitution icon must have size");
  assert.ok(metrics.opacity > 0.01 && metrics.display !== "none" && metrics.visibility !== "hidden");
  assert.ok(metrics.x >= -0.5, `icon clipped left: x=${metrics.x}`);
  assert.ok(
    metrics.x + metrics.width <= viewportWidth + 0.5,
    `icon clipped right: x=${metrics.x} w=${metrics.width} viewport=${viewportWidth}`,
  );
  assert.ok(metrics.y >= -0.5 && metrics.y + metrics.height <= (await page.viewportSize())!.height + 0.5);
}

async function assertIconSizesMatch(page: Page): Promise<void> {
  const accessBox = await page.locator('a[href="/access"] .legacy-icon').first().boundingBox();
  const clientsBox = await page.locator('a[href^="/clients"] .legacy-icon').first().boundingBox();
  assert.ok(accessBox && clientsBox, "access and clients nav icons must be measurable");
  assert.ok(Math.abs(accessBox.width - clientsBox.width) < 1);
  assert.ok(Math.abs(accessBox.height - clientsBox.height) < 1);
}

async function assertCleanAccessSurface(page: Page): Promise<void> {
  await page.waitForSelector("#access-workspace-app:not(.clients-hidden)");
  await page.waitForSelector("#aa-list-data");
  const surface = await page.evaluate(() => {
    const status = document.getElementById("aa-status");
    const alert = document.querySelector('[role="alert"]');
    const bodyText = document.body.innerText;
    return {
      statusError: status?.classList.contains("aa-error") ?? false,
      statusText: status?.textContent?.trim() ?? "",
      alertText: alert?.textContent?.trim() ?? "",
      hasJsError: /Cannot read properties of undefined/i.test(bodyText),
    };
  });
  assert.equal(surface.statusError, false, `status error: ${surface.statusText}`);
  assert.equal(surface.hasJsError, false);
  assert.doesNotMatch(surface.alertText, /Cannot read properties/i);
  assert.doesNotMatch(surface.statusText, /Cannot read properties/i);
}

async function screenshotSidebar(page: Page, filename: string): Promise<void> {
  const sidebar = page.locator("#legacy-sidebar");
  await sidebar.waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await sidebar.screenshot({ path: path.join(SCREENSHOT_DIR, filename) });
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
    const errors: string[] = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachErrorGuards(page, errors);
    await mockManagerSession(page);
    await disableMotion(page);
    await page.goto(`${baseUrl}/access`, { waitUntil: "networkidle" });
    await assertCleanAccessSurface(page);

    const accessLink = page.locator('a[href="/access"]');
    await accessLink.waitFor({ state: "visible" });
    assert.equal(await accessLink.getAttribute("aria-label"), "Назначения ассистентам");
    assert.match(await accessLink.innerText(), /Назначения ассистентам/);
    assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);
    await assertSubstitutionIconVisible(page, 1440);
    await assertIconSizesMatch(page);
    await screenshotSidebar(page, "assignment-nav-icon-desktop-light-expanded.png");

    await page.locator(".legacy-sidebar__collapse").click();
    await page.waitForFunction(() =>
      document.querySelector(".legacy-app")?.classList.contains("sidebar-collapsed"),
    );
    await assertSubstitutionIconVisible(page, 1440);
    assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);
    await screenshotSidebar(page, "assignment-nav-icon-desktop-light-collapsed.png");

    await setTheme(page, "dark");
    await assertSubstitutionIconVisible(page, 1440);
    assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);
    await screenshotSidebar(page, "assignment-nav-icon-desktop-dark-collapsed.png");

    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator("#legacy-menu-toggle").click();
      await waitForSidebarDrawerOpen(page);
      await assertSubstitutionIconVisible(page, width);
      await assertIconSizesMatch(page);
      assert.deepEqual(await readSubstitutionPaths(page), PROTOTYPE_SUBSTITUTION_PATHS);
      await screenshotSidebar(
        page,
        width === 375
          ? "assignment-nav-icon-mobile-light-menu-375.png"
          : "assignment-nav-icon-mobile-light-menu-390.png",
      );
      await page.locator("#legacy-menu-toggle").click();
      await page.waitForFunction(
        () => !document.getElementById("legacy-sidebar")?.classList.contains("is-open"),
      );
    }

    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    await context.close();
  });
});
