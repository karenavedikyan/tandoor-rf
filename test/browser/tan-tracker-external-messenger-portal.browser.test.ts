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

  async function createExternalTransferViaUi(page: Page): Promise<void> {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "Messenger holder UI box");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.click('[data-tt="create-new-recipient"]');
    await page.waitForSelector('[data-create-phase="recipient-new-name"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newName"]', "Ext Browser Recipient");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="recipient-new-phone"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newPhone"]', "+79992223344");
    await page.click('[data-tt="create-wizard-next"]');
    const createResp = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/tan-tracker/transfers") && r.status() === 201,
      { timeout: 30000 },
    );
    await page.click('[data-tt="create-wizard-submit"]');
    await createResp;
    await page.waitForSelector('[data-tt="detail"]', { timeout: 30000 });
  }

  it("holder creates invite in UI, copies URL, logged-out portal opens Telegram", async () => {
    const holderContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const holderPage = await holderContext.newPage();
      await login(holderPage, "tt-browser-admin@test.local");
      await createExternalTransferViaUi(holderPage);

      const inviteResp = holderPage.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes("/messenger-invite") &&
          r.status() === 201,
        { timeout: 30000 },
      );
      await holderPage.click('[data-tt="messenger-invite-create"]');
      await inviteResp;

      await holderPage.waitForSelector('[data-tt="messenger-invite-url"]', { timeout: 15000 });
      const portalUrl = await holderPage.inputValue('[data-tt="messenger-invite-url"]');
      assert.match(portalUrl, /\/tan-tracker\/recipient\?mst=er/);

      await holderPage.click('[data-tt="messenger-invite-copy"]');

      const guestContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
      try {
        const guestPage = await guestContext.newPage();
        await guestPage.goto(portalUrl);
        await guestPage.waitForSelector('[data-tt="messenger-portal"]', { timeout: 20000 });
        await guestPage.waitForSelector('[data-tt="messenger-channel-open"][data-channel="telegram"]', {
          timeout: 15000,
        });
        const popupPromise = guestPage.waitForEvent("popup", { timeout: 10000 });
        await guestPage.click('[data-tt="messenger-channel-open"][data-channel="telegram"]');
        const popup = await popupPromise;
        assert.match(popup.url(), /t\.me\//);
        await popup.close();
      } finally {
        await guestContext.close();
      }
    } finally {
      await holderContext.close();
    }
  });
});
