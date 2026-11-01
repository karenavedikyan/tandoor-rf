import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("external recipient messenger holder UI + portal (browser)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-ext-messenger-browser",
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

  async function createExternalTransferViaUi(page: Page, phone = "+79992223344"): Promise<void> {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "Messenger holder UI box");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.click('[data-tt="create-new-recipient"]');
    await page.waitForSelector('[data-create-phase="recipient-new-phone"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newPhone"]', phone);
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="recipient-new-name"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newName"]', "Ext Browser Recipient");
    await page.click('[data-tt="create-wizard-next"]');
    const createResp = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/tan-tracker/transfers") && r.status() === 201,
      { timeout: 30000 },
    );
    await page.click('[data-tt="create-wizard-submit"]');
    await createResp;
    await page.waitForSelector('[data-tt="detail"]', { timeout: 30000 });
  }

  async function closeMobileSidebarIfOpen(page: Page) {
    const toggle = page.locator('[data-sidebar-toggle], .sidebar-toggle, button[aria-label*="меню" i]').first();
    if (await toggle.isVisible().catch(() => false)) {
      const sidebarOpen = await page.locator(".sidebar.open, .sidebar--open, body.sidebar-open").count();
      if (sidebarOpen > 0) await toggle.click();
    }
  }

  function trackMutatingApi(page: Page) {
    const posts: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST" && req.method() !== "PUT" && req.method() !== "PATCH") return;
      const url = req.url();
      if (url.includes("/api/tan-tracker/")) posts.push(url);
    });
    return posts;
  }

  it("holder QR and copy use mst portal; guest welcome then channels without mutating API", async () => {
    const holderContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const holderPage = await holderContext.newPage();
      await login(holderPage, "tt-browser-admin@test.local");
      await createExternalTransferViaUi(holderPage);

      await holderPage.click('[data-tt="tab-qr"]');
      await holderPage.waitForSelector('[data-tt="qr-host"][data-payload*="mst=er"]', { timeout: 30000 });

      const qrPayload = await holderPage.getAttribute('[data-tt="handoff-qr"] [data-tt="qr-host"]', "data-payload");
      assert.ok(qrPayload);
      assert.match(qrPayload, /\/tan-tracker\/recipient\?mst=er/);
      assert.equal(await holderPage.locator('[data-tt="handoff-qr"] [data-tt="scan-qr-demo"]').count(), 0);

      await holderPage.evaluate(`Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: (text) => {
          window.__ttInvitationCopied = text; return Promise.resolve();
        } }
      })`);
      let invitePosts = 0;
      holderPage.on("request", (req) => {
        if (req.method() === "POST" && req.url().includes("/messenger-invite")) invitePosts += 1;
      });
      await holderPage.click('[data-tt="messenger-invite-action"]');
      await holderPage.waitForSelector('[data-tt="toast"]', { timeout: 15000 });
      const copiedMessage = await holderPage.evaluate("window.__ttInvitationCopied");
      assert.match(String(copiedMessage), /Messenger holder UI box/);
      assert.match(String(copiedMessage), /Получить код приёма: https?:\/\//);
      const urlMatches = String(copiedMessage).match(/https?:\/\/[^\s]+/g) || [];
      assert.equal(urlMatches.length, 1);
      assert.match(urlMatches[0]!, /\/tan-tracker\/recipient\?mst=er/);
      assert.equal(await holderPage.locator('[data-tt="messenger-invite-message-text"]').count(), 0);
      assert.ok(qrPayload!.includes("mst=er"), "QR must use current messenger invitation token");
      const portalUrl = urlMatches[0]!;

      const guestContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
      try {
        const guestPage = await guestContext.newPage();
        const mutating = trackMutatingApi(guestPage);
        await guestPage.setViewportSize({ width: 375, height: 812 });
        await guestPage.goto(portalUrl);
        await guestPage.waitForSelector('[data-tt="recipient-welcome"]', { timeout: 20000 });
        assert.equal(await guestPage.locator('[data-tt="messenger-portal"]').count(), 0);
        const welcomeText = await guestPage.locator('[data-tt="recipient-welcome"]').innerText();
        assert.match(welcomeText, /Messenger holder UI box/);
        assert.match(welcomeText, /Отправитель/);
        assert.deepEqual(mutating, []);

        await guestPage.click('[data-tt="recipient-welcome-continue"]');
        await guestPage.waitForSelector('[data-tt="messenger-portal"]', { timeout: 15000 });
        await guestPage.waitForSelector('[data-tt="recipient-messenger-preamble"]', { timeout: 10000 });
        assert.deepEqual(mutating, []);

        await guestPage.waitForSelector(".tt-recipient-card", { timeout: 10000 });
        assert.equal(await guestPage.locator('[data-tt="messenger-sms-hint"]').count(), 0);
        await guestPage.waitForSelector('[data-tt="messenger-channel-unavailable"][data-channel="max"]', {
          timeout: 10000,
        });
        const maxReason = await guestPage.locator(
          '[data-tt="messenger-channel-unavailable"][data-channel="max"] [data-tt="messenger-unavailable-reason"]',
        );
        assert.ok((await maxReason.textContent())?.trim());
        const overflow = await guestPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
        assert.ok(overflow, "375px viewport should not horizontal overflow");

        await guestPage.setViewportSize({ width: 1440, height: 900 });
        await closeMobileSidebarIfOpen(guestPage);
        await guestPage.waitForSelector('[data-tt="messenger-channel-open"][data-channel="telegram"]', {
          timeout: 15000,
        });
        const popupPromise = guestPage.waitForEvent("popup", { timeout: 10000 });
        await guestPage.click('[data-tt="messenger-channel-open"][data-channel="telegram"]');
        const popup = await popupPromise;
        assert.match(popup.url(), /t\.me\//);
        await popup.close();
        assert.deepEqual(mutating, []);
      } finally {
        await guestContext.close();
      }
    } finally {
      await holderContext.close();
    }
  });

  it("invalid mst shows branded denial without transfer details", async () => {
    const guestContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const guestPage = await guestContext.newPage();
      const staleMst = `er${"a".repeat(43)}`;
      await guestPage.goto(`${fixture.baseUrl}/tan-tracker/recipient?mst=${encodeURIComponent(staleMst)}`);
      await guestPage.waitForSelector('[data-tt="recipient-welcome-invalid"]', { timeout: 20000 });
      assert.equal(await guestPage.locator('[data-tt="messenger-portal"]').count(), 0);
      assert.equal(await guestPage.locator('[data-tt="recipient-welcome-continue"]').count(), 0);
      const body = await guestPage.locator('[data-tt="recipient-welcome-invalid"]').innerText();
      assert.match(body, /Ссылка на передачу больше не действует/);
      assert.match(body, /создайте новую передачу/);
      assert.doesNotMatch(body, /Messenger holder UI box/);
    } finally {
      await guestContext.close();
    }
  });

  async function expectFullFieldSelection(page: Page, selector: string) {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        if (!el || !("value" in el)) return false;
        const len = String(el.value).length;
        return document.activeElement === el && len > 0 && el.selectionStart === 0 && el.selectionEnd === len;
      },
      selector,
      { timeout: 10000 },
    );
  }

  it("holder clipboard fallback selects full invitation text without reissuing invite", async () => {
    const holderContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const holderPage = await holderContext.newPage();
      await login(holderPage, "tt-browser-admin@test.local");
      await createExternalTransferViaUi(holderPage, "+79992223345");

      const inviteResp = holderPage.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes("/messenger-invite") &&
          r.status() === 201,
        { timeout: 30000 },
      );
      await holderPage.click('[data-tt="messenger-invite-action"]');
      const invite = await inviteResp;
      const inviteBody = (await invite.json()) as { startToken?: string; portalUrl?: string };
      assert.ok(inviteBody.startToken);

      let invitePostCount = 0;
      holderPage.on("request", (req) => {
        if (req.method() === "POST" && req.url().includes("/messenger-invite")) invitePostCount += 1;
      });

      await holderPage.evaluate(`Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) }
      })`);
      await holderPage.click('[data-tt="messenger-invite-action"]');
      await holderPage.waitForSelector('[data-tt="toast"]', { timeout: 10000 });
      await expectFullFieldSelection(holderPage, '[data-tt="messenger-invite-message-text"]');
      const messageValue = await holderPage.inputValue('[data-tt="messenger-invite-message-text"]');
      assert.match(messageValue, /Messenger holder UI box/);
      assert.match(messageValue, /Получить код приёма:/);
      const urlMatches = messageValue.match(/https?:\/\/[^\s]+/g) || [];
      assert.equal(urlMatches.length, 1);
      assert.equal(new URL(urlMatches[0]!).searchParams.get("mst"), inviteBody.startToken);

      await holderPage.evaluate(`Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: (text) => {
          window.__ttInvitationCopied = text; return Promise.resolve();
        } }
      })`);
      await holderPage.click('[data-tt="messenger-invite-action"]');
      const copiedMessage = await holderPage.evaluate("window.__ttInvitationCopied");
      assert.equal(copiedMessage, messageValue);
      assert.equal(invitePostCount, 0);
      assert.equal(await holderPage.locator('[data-tt="messenger-invite-message-text"].tt-invite-message-fallback--visible').count(), 0);
    } finally {
      await holderContext.close();
    }
  });
});
