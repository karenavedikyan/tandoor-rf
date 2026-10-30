import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { chromium, webkit, type Browser, type BrowserType, type Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

const FIXTURE_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-admin-wizard.png");

describe("tan-tracker upload + invite regression (browser + PG)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-upload-invite-resilience-browser",
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

  async function openCreateFilesStep(page: Page) {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "Deadline regression box");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="files"]', { timeout: 10000 });
  }

  async function createExternalTransfer(page: Page) {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "Invite regression box");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.click('[data-tt="create-new-recipient"]');
    await page.waitForSelector('[data-create-phase="recipient-new-name"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newName"]', "Ext Regression Recipient");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="recipient-new-phone"]', { timeout: 15000 });
    await page.fill('[data-tt-field="newPhone"]', "+79991112233");
    await page.click('[data-tt="create-wizard-next"]');
    const createResp = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/tan-tracker/transfers") && r.status() === 201,
      { timeout: 30000 },
    );
    await page.click('[data-tt="create-wizard-submit"]');
    await createResp;
    await page.waitForSelector('[data-tt="detail"]', { timeout: 30000 });
  }

  async function runWithEngine(engine: BrowserType<Browser>, title: string, fn: (page: Page) => Promise<void>) {
    const browser = await (
      engine === chromium
        ? engine.launch({ headless: true, channel: "chromium" })
        : engine.launch({ headless: true })
    ).catch(() => null);
    if (!browser) {
      console.log(`skip ${title}: ${engine.name()} not installed`);
      return;
    }
    const context = await browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await fn(page);
    } finally {
      await context.close();
      await browser.close();
    }
  }

  it("baseline PNG upload succeeds (Chromium)", async () => {
    await runWithEngine(chromium, "baseline chromium", async (page) => {
      await openCreateFilesStep(page);
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 20000 });
      assert.equal(await page.locator(".tt-att-block .tt-error").count(), 0);
    });
  });

  for (const engine of [chromium, webkit] as const) {
    it(`stalled upload clears attach-busy with Russian timeout after 120s clock (${engine.name()})`, async () => {
      const browser = await (
      engine === chromium
        ? engine.launch({ headless: true, channel: "chromium" })
        : engine.launch({ headless: true })
    ).catch(() => null);
      if (!browser) {
        console.log(`skip stalled upload: ${engine.name()} not installed`);
        return;
      }
      const context = await browser.newContext({ baseURL: fixture.baseUrl });
      await context.clock.install({ time: Date.now() });
      try {
        const page = await context.newPage();
        await login(page, "tt-browser-admin@test.local");
        await openCreateFilesStep(page);
        await page.route("**/api/tan-tracker/staging-attachments", () => {});
        await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
        await page.waitForSelector('[data-tt="attach-busy"]', { timeout: 5000 });
        await page.clock.runFor(120001);
        await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 5000 });
        const errText = await page.locator(".tt-att-block .tt-error").textContent();
        assert.match(errText || "", /Превышено время ожидания загрузки файла/i);
        assert.doesNotMatch(errText || "", /Load failed/i);
      } finally {
        await context.close();
        await browser.close();
      }
    });

    it(`invite still pending at 10001ms clock, not Fetch is aborted (${engine.name()})`, async () => {
      const browser = await (
      engine === chromium
        ? engine.launch({ headless: true, channel: "chromium" })
        : engine.launch({ headless: true })
    ).catch(() => null);
      if (!browser) {
        console.log(`skip invite 10001: ${engine.name()} not installed`);
        return;
      }
      const context = await browser.newContext({ baseURL: fixture.baseUrl });
      await context.clock.install({ time: Date.now() });
      try {
        const page = await context.newPage();
        await login(page, "tt-browser-admin@test.local");
        await createExternalTransfer(page);
        await page.route("**/messenger-invite", () => {});
        await page.click('[data-tt="messenger-invite-create"]');
        await page.waitForSelector('[data-tt="messenger-invite-create"][disabled]', { timeout: 5000 });
        await page.clock.runFor(10001);
        const errText = (await page.locator('[data-tt="messenger-invite-error"]').textContent()) || "";
        assert.doesNotMatch(errText, /Fetch is aborted/i);
        assert.equal(errText.trim(), "");
      } finally {
        await context.close();
        await browser.close();
      }
    });

    it(`stalled invite maps to Russian timeout at 45s clock (${engine.name()})`, async () => {
      const browser = await (
      engine === chromium
        ? engine.launch({ headless: true, channel: "chromium" })
        : engine.launch({ headless: true })
    ).catch(() => null);
      if (!browser) {
        console.log(`skip invite 45s: ${engine.name()} not installed`);
        return;
      }
      const context = await browser.newContext({ baseURL: fixture.baseUrl });
      await context.clock.install({ time: Date.now() });
      try {
        const page = await context.newPage();
        await login(page, "tt-browser-admin@test.local");
        await createExternalTransfer(page);
        await page.route("**/messenger-invite", () => {});
        await page.click('[data-tt="messenger-invite-create"]');
        await page.clock.runFor(45001);
        const errText = (await page.locator('[data-tt="messenger-invite-error"]').textContent({ timeout: 5000 })) || "";
        assert.match(errText, /Превышено время ожидания ответа/i);
        assert.doesNotMatch(errText, /Fetch is aborted/i);
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }

  it("retry works after upload timeout (Chromium + clock)", async () => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    await context.clock.install({ time: Date.now() });
    try {
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await openCreateFilesStep(page);
      await page.route("**/api/tan-tracker/staging-attachments", () => {});
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await page.clock.runFor(120001);
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 5000 });
      await page.unroute("**/api/tan-tracker/staging-attachments");
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 20000 });
      assert.equal(await page.locator(".tt-att-block .tt-error").count(), 0);
    } finally {
      await context.close();
    }
  });
});
