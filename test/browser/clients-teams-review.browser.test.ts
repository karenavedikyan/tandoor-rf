import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server";
import { resolveMockResponse, type MockOptions } from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

const CLIENT_GUID = "11111111-1111-4111-8111-111111111111";
const ADMIN_REVIEWER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNAVAILABLE_REVIEWER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("clients teams and review browser", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind browser test server.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function setupReviewPage(options: MockOptions = { role: "admin" }) {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0 };
    let lastReviewPutBody: unknown = null;

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const postData = route.request().postData() ?? undefined;
      if (url.pathname.endsWith("/review") && method === "PUT") {
        lastReviewPutBody = postData ? JSON.parse(postData) : null;
      }
      const mock = resolveMockResponse(url, options, state, method, postData);
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients/${encodeURIComponent(CLIENT_GUID)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#client-review-form");

    return { page, state, getLastReviewPutBody: () => lastReviewPutBody };
  }

  it("navigates teams, unassigned drill-down, and admin review form", async () => {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0 };
    const options: MockOptions = { role: "admin" };
    let reviewPutCount = 0;
    let reviewPutBody: unknown = null;

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const postData = route.request().postData() ?? undefined;
      if (url.pathname.endsWith("/review") && method === "PUT") {
        reviewPutCount += 1;
        reviewPutBody = postData ? JSON.parse(postData) : null;
      }
      const mock = resolveMockResponse(url, options, state, method, postData);
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients?view=teams`, { waitUntil: "networkidle" });
    await page.waitForSelector("#view-switcher");
    assert.ok(await page.locator('[data-view="review"]').isVisible());

    await page.click('[data-view="review"]');
    await page.waitForSelector("#unassigned-panel");
    await page.click('[data-category="opt_without_rop_team"]');
    await page.waitForSelector('[data-employee]');
    await page.click('[data-employee="55555555-5555-4555-8555-555555555555"]');
    await page.waitForSelector("#clients-table-body tr");
    assert.ok(state.listCalls >= 1);

    await page.goto(`${baseUrl}/clients/${encodeURIComponent(CLIENT_GUID)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#client-review-form");
    await page.selectOption("#client-review-state", "completed");
    await page.selectOption("#client-review-decision", "confirm_current_manager");
    await page.selectOption("#client-review-reviewer", ADMIN_REVIEWER_ID);
    await page.fill("#client-review-comment", "Browser acceptance review");
    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden") && el.textContent?.includes("сохранена");
    });
    assert.equal(reviewPutCount, 1);
    assert.equal(typeof reviewPutBody, "object");
    assert.notEqual(reviewPutBody, null);
    assert.equal((reviewPutBody as { reviewState?: string }).reviewState, "completed");
    assert.equal(
      (reviewPutBody as { assignedReviewerUserId?: string }).assignedReviewerUserId,
      ADMIN_REVIEWER_ID,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-review-mobile-detail.png"),
      fullPage: true,
    });

    await page.close();
  });

  it("sends review PUT body as JSON object, not double-serialized string", async () => {
    const { page, getLastReviewPutBody } = await setupReviewPage();
    await page.selectOption("#client-review-state", "in_progress");
    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden");
    });

    const body = getLastReviewPutBody();
    assert.equal(typeof body, "object");
    assert.notEqual(body, null);
    assert.notEqual(typeof body, "string");
    assert.equal((body as { reviewState?: string }).reviewState, "in_progress");

    await page.close();
  });

  it("round-trips due date in Europe/Moscow without three-hour shift", async () => {
    const page = await browser.newPage({ timezoneId: "Europe/Moscow" });
    const state = { listCalls: 0, catalogProductsCalls: 0 };
    const dueIso = "2026-10-05T09:00:00.000Z";
    let reviewPutBody: unknown = null;

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const postData = route.request().postData() ?? undefined;
      if (url.pathname.endsWith("/review") && method === "GET" && !url.pathname.endsWith("/history")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            review: {
              reviewState: "in_progress",
              reviewDecision: null,
              comment: null,
              proposedManagerGuid: null,
              assignedReviewerUserId: null,
              dueAt: dueIso,
              version: 1,
              isStale: false,
              transferStatus: "none",
            },
          }),
        });
        return;
      }
      if (url.pathname.endsWith("/review") && method === "PUT") {
        reviewPutBody = postData ? JSON.parse(postData) : null;
      }
      const mock = resolveMockResponse(url, { role: "admin" }, state, method, postData);
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients/${encodeURIComponent(CLIENT_GUID)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#client-review-due");
    const displayed = await page.inputValue("#client-review-due");
    assert.equal(displayed, "2026-10-05T12:00");

    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden");
    });
    assert.equal((reviewPutBody as { dueAt?: string }).dueAt, dueIso);

    await page.close();
  });

  it("shows network error on review save failure without false success", async () => {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0 };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname.endsWith("/review") && method === "PUT") {
        await route.abort("failed");
        return;
      }
      const postData = route.request().postData() ?? undefined;
      const mock = resolveMockResponse(url, { role: "admin" }, state, method, postData);
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients/${encodeURIComponent(CLIENT_GUID)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#client-review-form");

    await page.selectOption("#client-review-state", "completed");
    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return (
        el &&
        !el.hasAttribute("hidden") &&
        (el.textContent?.includes("сеть") || el.textContent?.includes("сети"))
      );
    });
    const message = await page.locator("#client-review-message").textContent();
    assert.match(message ?? "", /сет/i);
    assert.doesNotMatch(message ?? "", /сохранена/i);

    await page.close();
  });

  it("recheck button sends stored state and leaves needs_recheck queue", async () => {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0 };
    let reviewPutBody: unknown = null;
    const options: MockOptions = {
      role: "admin",
      reviewGetBody: {
        reviewState: "needs_recheck",
        storedReviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "Stale completed",
        version: 3,
        isStale: true,
        staleReason: "Импорт изменил данные клиента",
        transferStatus: "none",
        assignedReviewerUserId: ADMIN_REVIEWER_ID,
      },
    };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const postData = route.request().postData() ?? undefined;
      if (url.pathname.endsWith("/review") && method === "PUT") {
        reviewPutBody = postData ? JSON.parse(postData) : null;
      }
      const mock = resolveMockResponse(url, options, state, method, postData);
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients/${encodeURIComponent(CLIENT_GUID)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#client-review-recheck");
    assert.equal(await page.inputValue("#client-review-state"), "completed");
    await page.click("#client-review-recheck");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden") && el.textContent?.includes("сохранена");
    });

    assert.equal((reviewPutBody as { reviewState?: string }).reviewState, "completed");
    assert.equal((reviewPutBody as { recheckConfirmed?: boolean }).recheckConfirmed, true);
    assert.notEqual((reviewPutBody as { reviewState?: string }).reviewState, "needs_recheck");

    await page.close();
  });

  it("blocks save on reviewers load failure and preserves reviewer after retry", async () => {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0 };
    let reviewPutBody: unknown = null;
    let reviewersCalls = 0;
    const options: MockOptions = {
      role: "admin",
      reviewGetBody: {
        reviewState: "in_progress",
        storedReviewState: "in_progress",
        reviewDecision: null,
        comment: "Keep reviewer",
        version: 3,
        isStale: false,
        transferStatus: "none",
        assignedReviewerUserId: ADMIN_REVIEWER_ID,
      },
    };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const postData = route.request().postData() ?? undefined;
      if (url.pathname === "/api/clients/review/eligible-reviewers") {
        reviewersCalls += 1;
        options.reviewersStatus = reviewersCalls === 1 ? 503 : 200;
      }
      if (url.pathname.endsWith("/review") && method === "PUT") {
        reviewPutBody = postData ? JSON.parse(postData) : null;
      }
      const mock = resolveMockResponse(url, options, state, method, postData);
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients/${encodeURIComponent(CLIENT_GUID)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#client-review-reviewers-load-error");
    assert.equal(await page.isDisabled("#client-review-save"), true);
    await page.fill("#client-review-comment", "Comment only attempt");
    assert.equal(reviewPutBody, null);

    await page.click("#client-review-reload-reviewers");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-reviewers-load-error");
      return el && el.hasAttribute("hidden");
    });

    await page.fill("#client-review-comment", "Comment after retry");
    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden") && el.textContent?.includes("сохранена");
    });
    assert.equal(
      (reviewPutBody as { assignedReviewerUserId?: string | null }).assignedReviewerUserId,
      ADMIN_REVIEWER_ID,
    );

    await page.close();
  });

  it("blocks unavailable reviewer save until explicit choice and allows clear or replacement", async () => {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0 };
    let reviewPutBody: unknown = null;
    const options: MockOptions = {
      role: "admin",
      reviewGetBody: {
        reviewState: "in_progress",
        storedReviewState: "in_progress",
        reviewDecision: null,
        comment: "Needs reviewer decision",
        version: 4,
        isStale: false,
        transferStatus: "none",
        assignedReviewerUserId: UNAVAILABLE_REVIEWER_ID,
      },
      eligibleReviewersItems: [
        {
          userId: ADMIN_REVIEWER_ID,
          name: "Synthetic Admin",
          shortId: "aaaaaaaa",
        },
      ],
    };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const postData = route.request().postData() ?? undefined;
      if (url.pathname.endsWith("/review") && method === "PUT") {
        reviewPutBody = postData ? JSON.parse(postData) : null;
      }
      const mock = resolveMockResponse(url, options, state, method, postData);
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    await page.goto(`${baseUrl}/clients/${encodeURIComponent(CLIENT_GUID)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#client-review-reviewer");
    assert.equal(await page.inputValue("#client-review-reviewer"), "__unset__");

    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden") && el.textContent?.includes("проверяющего");
    });
    assert.equal(reviewPutBody, null);

    await page.selectOption("#client-review-reviewer", ADMIN_REVIEWER_ID);
    await page.selectOption("#client-review-reviewer", "");
    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden") && el.textContent?.includes("сохранена");
    });
    assert.equal(
      (reviewPutBody as { assignedReviewerUserId?: string | null }).assignedReviewerUserId,
      null,
    );

    reviewPutBody = null;
    await page.selectOption("#client-review-reviewer", ADMIN_REVIEWER_ID);
    await page.click("#client-review-save");
    await page.waitForFunction(() => {
      const el = document.querySelector("#client-review-message");
      return el && !el.hasAttribute("hidden") && el.textContent?.includes("сохранена");
    });
    assert.equal(
      (reviewPutBody as { assignedReviewerUserId?: string | null }).assignedReviewerUserId,
      ADMIN_REVIEWER_ID,
    );

    await page.close();
  });
});
