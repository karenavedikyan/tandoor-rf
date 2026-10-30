import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { chromium, devices, webkit, type Browser, type BrowserType, type Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

const FIXTURE_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-admin-wizard.png");
const IPHONE_13 = devices["iPhone 13"];

async function launchRequired(engine: BrowserType<Browser>, t: { skip: (message?: string) => void }) {
  try {
    if (engine === chromium) {
      return await chromium.launch({ headless: true, channel: "chromium" });
    }
    return await webkit.launch({ headless: true });
  } catch (err) {
    t.skip(`${engine.name()} required for acceptance: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function newContextOptions(engine: BrowserType<Browser>, baseURL: string) {
  if (engine === webkit) {
    return { ...IPHONE_13, baseURL };
  }
  return { baseURL };
}

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

  async function waitForStagingUploadRequest(page: Page) {
    await page.waitForRequest(
      (req) => req.method() === "POST" && req.url().includes("/api/tan-tracker/staging-attachments"),
      { timeout: 15000 },
    );
  }

  it("baseline PNG upload succeeds (Chromium)", async (t) => {
    const browser = await launchRequired(chromium, t);
    const context = await browser!.newContext({ baseURL: fixture.baseUrl });
    try {
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await openCreateFilesStep(page);
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 20000 });
      assert.equal(await page.locator(".tt-att-block .tt-error").count(), 0);
    } finally {
      await context.close();
      await browser!.close();
    }
  });

  for (const engine of [chromium, webkit] as const) {
    it(`stalled upload clears attach-busy with Russian timeout after 120s clock (${engine.name()})`, async (t) => {
      const browser = await launchRequired(engine, t);
      const context = await browser!.newContext(newContextOptions(engine, fixture.baseUrl));
      await context.clock.install({ time: Date.now() });
      try {
        const page = await context.newPage();
        await login(page, "tt-browser-admin@test.local");
        await openCreateFilesStep(page);
        await page.route("**/api/tan-tracker/staging-attachments", () => {});
        const uploadReq = waitForStagingUploadRequest(page);
        await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
        await uploadReq;
        await page.clock.runFor(120001);
        await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 10000 });
        const errText = await page.locator(".tt-att-block .tt-error").textContent();
        assert.match(errText || "", /Превышено время ожидания загрузки файла/i);
        assert.doesNotMatch(errText || "", /Load failed/i);
      } finally {
        await context.close();
        await browser!.close();
      }
    });

    it(`invite still pending at 10001ms clock, not Fetch is aborted (${engine.name()})`, async (t) => {
      const browser = await launchRequired(engine, t);
      const context = await browser!.newContext(newContextOptions(engine, fixture.baseUrl));
      await context.clock.install({ time: Date.now() });
      try {
        const page = await context.newPage();
        await login(page, "tt-browser-admin@test.local");
        await createExternalTransfer(page);
        await page.route("**/messenger-invite", () => {});
        const inviteReq = page.waitForRequest(
          (req) => req.method() === "POST" && req.url().includes("/messenger-invite"),
          { timeout: 15000 },
        );
        await page.click('[data-tt="messenger-invite-create"]');
        await inviteReq;
        await page.clock.runFor(10001);
        const errText = (await page.locator('[data-tt="messenger-invite-error"]').textContent()) || "";
        assert.doesNotMatch(errText, /Fetch is aborted/i);
        assert.equal(errText.trim(), "");
      } finally {
        await context.close();
        await browser!.close();
      }
    });

    it(`stalled invite maps to Russian timeout at 45s clock (${engine.name()})`, async (t) => {
      const browser = await launchRequired(engine, t);
      const context = await browser!.newContext(newContextOptions(engine, fixture.baseUrl));
      await context.clock.install({ time: Date.now() });
      try {
        const page = await context.newPage();
        await login(page, "tt-browser-admin@test.local");
        await createExternalTransfer(page);
        await page.route("**/messenger-invite", () => {});
        const inviteReq = page.waitForRequest(
          (req) => req.method() === "POST" && req.url().includes("/messenger-invite"),
          { timeout: 15000 },
        );
        await page.click('[data-tt="messenger-invite-create"]');
        await inviteReq;
        await page.clock.runFor(45001);
        const errText =
          (await page.locator('[data-tt="messenger-invite-error"]').textContent({ timeout: 10000 })) || "";
        assert.match(errText, /Превышено время ожидания ответа/i);
        assert.doesNotMatch(errText, /Fetch is aborted/i);
      } finally {
        await context.close();
        await browser!.close();
      }
    });
  }

  it("late ingest A must not clear busy/abort for ingest B (Chromium)", async (t) => {
    const browser = await launchRequired(chromium, t);
    const context = await browser!.newContext({ baseURL: fixture.baseUrl });
    try {
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await openCreateFilesStep(page);

      let releaseFirstUpload: (() => void) | undefined;
      const firstUploadGate = new Promise<void>((resolve) => {
        releaseFirstUpload = resolve;
      });
      let uploadPostCount = 0;
      await page.route("**/api/tan-tracker/staging-attachments", async (route) => {
        uploadPostCount += 1;
        if (uploadPostCount === 1) {
          await firstUploadGate;
        }
        await route.continue();
      });

      const firstUploadReq = waitForStagingUploadRequest(page);
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await firstUploadReq;
      assert.equal(await page.locator('[data-tt="attach-busy"]').count(), 1);

      await page.click('[data-tt="create-wizard-back"]');
      await page.waitForSelector('[data-create-phase="item"]', { timeout: 10000 });

      await page.click('[data-tt="create-wizard-next"]');
      await page.waitForSelector('[data-create-phase="files"]', { timeout: 10000 });

      let releaseSecondUpload: (() => void) | undefined;
      const secondUploadGate = new Promise<void>((resolve) => {
        releaseSecondUpload = resolve;
      });
      await page.unroute("**/api/tan-tracker/staging-attachments");
      uploadPostCount = 0;
      await page.route("**/api/tan-tracker/staging-attachments", async (route) => {
        uploadPostCount += 1;
        if (uploadPostCount === 1) {
          await secondUploadGate;
        }
        await route.continue();
      });

      const secondUploadReq = waitForStagingUploadRequest(page);
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await secondUploadReq;
      assert.equal(await page.locator('[data-tt="attach-busy"]').count(), 1);

      releaseFirstUpload?.();
      await page.waitForFunction(() => document.querySelector('[data-tt="attach-busy"]'), { timeout: 5000 });
      assert.equal(await page.locator('[data-tt="attach-busy"]').count(), 1, "stale ingest A must not clear B busy");

      await page.click('[data-tt="create-wizard-back"]');
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 10000 });
      releaseSecondUpload?.();
    } finally {
      await context.close();
      await browser!.close();
    }
  });

  it("retry works after upload timeout (Chromium + clock)", async (t) => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    await context.clock.install({ time: Date.now() });
    try {
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await openCreateFilesStep(page);
      await page.route("**/api/tan-tracker/staging-attachments", () => {});
      const uploadReq = waitForStagingUploadRequest(page);
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await uploadReq;
      await page.clock.runFor(120001);
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 10000 });
      await page.unroute("**/api/tan-tracker/staging-attachments");
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), { timeout: 20000 });
      assert.equal(await page.locator(".tt-att-block .tt-error").count(), 0);
    } finally {
      await context.close();
    }
  });
});
