import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("messenger invitation single-action UI (browser mocks)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-messenger-invite-ui-browser",
      extraEnv: {
        TT_EXTERNAL_MESSENGER_ENABLED: "true",
        TANBOT_TELEGRAM_ENABLED: "true",
        TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-test-token-for-browser-only",
        TANBOT_TELEGRAM_BOT_USERNAME: "tandoor_test_bot",
        TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "test-link-pepper-min-16-chars",
        TANBOT_MAX_ENABLED: "false",
      },
    });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  async function login(page: Page, email: string) {
    await page.goto(`${fixture.baseUrl}/login`);
    await page.fill("#email", email);
    await page.fill("#password", fixture.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
  }

  async function createExternalTransfer(page: Page, phone = "+79991112255") {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "Single invite action box");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.click('[data-tt="create-new-recipient"]');
    await page.waitForSelector('[data-create-phase="recipient-new-phone"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newPhone"]', phone);
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="recipient-new-name"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newName"]', "Invite UI Recipient");
    await page.click('[data-tt="create-wizard-next"]');
    const createResp = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/tan-tracker/transfers") && r.status() === 201,
      { timeout: 30000 },
    );
    await page.click('[data-tt="create-wizard-submit"]');
    await createResp;
    await page.waitForSelector('[data-tt="detail"]', { timeout: 30000 });
  }

  it("Web Share uses full text with a single URL; AbortError does not copy", async () => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await createExternalTransfer(page);

      await page.evaluate(`Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (payload) => {
          window.__ttSharePayload = payload;
          return Promise.resolve();
        }
      })`);
      await page.evaluate(`Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("clipboard should not run")) }
      })`);

      const inviteResp = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/messenger-invite") && r.status() === 201,
        { timeout: 30000 },
      );
      await page.click('[data-tt="messenger-invite-action"]');
      await inviteResp;

      const payload = (await page.evaluate("window.__ttSharePayload")) as { text?: string; url?: string };
      assert.ok(payload?.text);
      assert.equal(payload.url, undefined);
      assert.match(payload.text!, /Single invite action box/);
      const urls = payload.text!.match(/https?:\/\/[^\s]+/g) || [];
      assert.equal(urls.length, 1);

      await page.evaluate(`Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.reject(Object.assign(new Error("cancel"), { name: "AbortError" }))
      })`);
      await page.click('[data-tt="messenger-invite-action"]');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-tt="messenger-invite-message-text"].tt-invite-message-fallback--visible').count(), 0);
      const toast = (await page.locator('[data-tt="toast"]').textContent()) || "";
      assert.doesNotMatch(toast, /Приглашение скопировано/);
    } finally {
      await context.close();
    }
  });

  it("technical share failure falls back to clipboard copy", async () => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await createExternalTransfer(page, "+79991112256");

      await page.click('[data-tt="messenger-invite-action"]');
      await page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/messenger-invite") && r.status() === 201,
        { timeout: 30000 },
      );

      await page.evaluate(`Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.reject(new Error("share failed"))
      })`);
      await page.evaluate(`Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: (text) => {
          window.__ttInvitationCopied = text; return Promise.resolve();
        } }
      })`);
      await page.click('[data-tt="messenger-invite-action"]');
      await page.waitForSelector('[data-tt="toast"]', { timeout: 10000 });
      const toast = (await page.locator('[data-tt="toast"]').textContent()) || "";
      assert.match(toast, /Приглашение скопировано/);
      const copied = String(await page.evaluate("window.__ttInvitationCopied"));
      assert.match(copied, /Single invite action box/);
      assert.equal((copied.match(/https?:\/\/[^\s]+/g) || []).length, 1);
    } finally {
      await context.close();
    }
  });
});
