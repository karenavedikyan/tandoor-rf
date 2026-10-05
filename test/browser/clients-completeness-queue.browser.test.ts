import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import {
  COMPLETENESS_CLIENT_FILLED,
  COMPLETENESS_STORE_MISSING,
  resolveMockResponse,
  syntheticDetailPayload,
  type MockOptions,
} from "./helpers/clients-api-mocks";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

describe("clients completeness queue browser", { concurrency: false }, () => {
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

  async function setupPage(detailBody = syntheticDetailPayload()) {
    const page = await browser.newPage();
    const state = { listCalls: 0, catalogProductsCalls: 0, lastCompletenessQueueUrl: "" };
    const options: MockOptions = { role: "admin", clientsBusinessRole: "director" };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const mock = resolveMockResponse(
        url,
        { ...options, detailBody },
        state,
        route.request().method(),
        route.request().postData() ?? undefined,
      );
      await route.fulfill(
        mock ?? {
          status: 404,
          contentType: "application/json",
          body: '{"error":"not mocked"}',
        },
      );
    });

    return { page, state };
  }

  async function openCompletenessClients(page: Page) {
    await page.goto(`${baseUrl}/clients?view=completeness`, { waitUntil: "networkidle" });
    await page.waitForSelector("#clients-table-body tr");
  }

  it("navigates completeness queue: outlets, reason filter, card link, back and reload", async () => {
    const { page, state } = await setupPage();

    await openCompletenessClients(page);
    await page.waitForFunction(() => {
      const body = document.querySelector("#clients-table-body");
      return body && body.textContent?.includes("Client Both Missing");
    });
    assert.ok(!state.lastCompletenessQueueUrl.includes("entity=outlets"));

    await page.click('[data-entity="outlets"]');
    await page.waitForSelector("#clients-table-body tr");
    assert.match(state.lastCompletenessQueueUrl, /entity=outlets/);
    await page.waitForFunction(() => {
      const body = document.querySelector("#clients-table-body");
      return body && body.textContent?.includes("Store Missing Assignments");
    });
    const clientsBody = await page.locator("#clients-table-body").innerText();
    assert.ok(!clientsBody.includes("Client Both Missing"));

    const filteredQueueResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clients/completeness-queue") &&
        response.url().includes("completenessReason=missing_rop"),
    );
    await page.selectOption("#completeness-reason-filter", ["missing_rop"]);
    await page.dispatchEvent("#completeness-reason-filter", "change");
    await filteredQueueResponse;
    await page.waitForSelector("#clients-table-body tr");
    assert.match(state.lastCompletenessQueueUrl, /completenessReason=missing_rop/);
    assert.match(state.lastCompletenessQueueUrl, /entity=outlets/);
    const filteredBody = await page.locator("#clients-table-body").innerText();
    assert.ok(filteredBody.includes("Не указан РОП"));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "clients-completeness-queue-multi-reasons.png"),
      fullPage: true,
    });

    const cardHref = `/clients/${COMPLETENESS_CLIENT_FILLED}?store=${COMPLETENESS_STORE_MISSING}`;
    await page.click(`a.clients-link[href="${cardHref}"]`);
    await page.waitForURL(`**${cardHref}`);
    assert.match(page.url(), new RegExp(COMPLETENESS_STORE_MISSING));

    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForSelector("#clients-table-body tr");
    assert.match(page.url(), /view=completeness/);
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), /completenessReason=missing_rop/);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#clients-table-body tr");
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), /completenessReason=missing_rop/);
    assert.match(state.lastCompletenessQueueUrl, /completenessReason=missing_rop/);
    await page.waitForFunction(() => {
      const body = document.querySelector("#clients-table-body");
      return body && body.textContent?.includes("Store Missing Assignments");
    });

    await page.close();
  });
});
