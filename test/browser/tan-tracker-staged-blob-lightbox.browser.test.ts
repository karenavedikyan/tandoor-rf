import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { chromium, type Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { assertImageVisuallyPainted, sampleLocatorImagePaint } from "./helpers/image-painted";

const FIXTURE_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-admin-wizard.png");

describe("tan-tracker staged blob attachment preview (browser)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-staged-blob-lightbox-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  async function login(page: Page) {
    await page.goto(`${fixture.baseUrl}/login`);
    await page.fill("#email", "tt-browser-admin@test.local");
    await page.fill("#password", fixture.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
  }

  it("opens staged blob image in lightbox before transfer save", async (t) => {
    let browser;
    try {
      browser = await chromium.launch({ headless: true, channel: "chromium" });
    } catch (err) {
      t.skip(`chromium required: ${err instanceof Error ? err.message : String(err)}`);
    }
    const context = await browser!.newContext({ baseURL: fixture.baseUrl });
    try {
      const page = await context.newPage();
      await login(page);
      await page.goto(`${fixture.baseUrl}/tan-tracker`);
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
      await page.locator('[data-tt="create"]:visible, [data-tt="create-fab"]:visible').first().click();
      await page.fill('[data-tt-field="item"]', "Staged blob lightbox");
      await page.click('[data-tt="create-wizard-next"]');
      await page.waitForSelector('[data-create-phase="files"]', { timeout: 10000 });
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), undefined, {
        timeout: 60000,
      });

      const thumbSrc = await page.locator(".tt-att-thumb img").first().getAttribute("src");
      assert.ok(thumbSrc && thumbSrc.startsWith("blob:"), "staged thumb must use blob URL");
      assert.doesNotMatch(thumbSrc, /[?&]preview=/);

      await page.locator('[data-tt="attach-preview"]').first().click();
      await page.waitForSelector('[data-tt="attach-lightbox"]:not([hidden])', { timeout: 15000 });
      await page.waitForFunction(
        () => {
          const loading = document.querySelector('[data-tt="attach-lightbox-loading"]');
          const img = document.querySelector('[data-tt="attach-lightbox-img"]') as HTMLImageElement | null;
          return loading?.hasAttribute("hidden") && img && !img.hidden;
        },
        undefined,
        { timeout: 30000 },
      );
      const lbImg = page.locator('[data-tt="attach-lightbox-img"]');
      const lbSrc = await lbImg.getAttribute("src");
      assert.equal(lbSrc, thumbSrc, "lightbox must reuse blob URL without preview query corruption");
      const lbPaint = await sampleLocatorImagePaint(lbImg);
      assertImageVisuallyPainted(lbPaint, "staged blob lightbox");

      const dlHref = await page.locator('[data-tt="attach-lightbox-download"]').getAttribute("href");
      assert.ok(dlHref && dlHref.startsWith("blob:"));
      assert.doesNotMatch(dlHref, /[?&]download=/);
    } finally {
      await context.close();
      await browser!.close();
    }
  });
});
