import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import { chromium, devices, webkit, type BrowserType, type Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

const IPHONE_13 = devices["iPhone 13"];

async function launchRequired(engine: BrowserType, t: { skip: (message?: string) => void }) {
  try {
    if (engine === chromium) {
      return await chromium.launch({ headless: true, channel: "chromium" });
    }
    return await webkit.launch({ headless: true });
  } catch (err) {
    t.skip(`${engine.name()} required: ${err instanceof Error ? err.message : String(err)}`);
  }
}

describe("tan-tracker large JPEG preview after reload (browser + PG)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  let largeJpegPath = "";

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-large-jpeg-preview-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
    largeJpegPath = path.join(os.tmpdir(), `tt-large-preview-${process.pid}.jpg`);
    await sharp({
      create: { width: 5712, height: 4284, channels: 3, background: { r: 120, g: 90, b: 60 } },
    })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(largeJpegPath);
    const stat = await fs.stat(largeJpegPath);
    assert.ok(stat.size > 1_000_000, "generated JPEG should be large enough for preview stress");
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
    await fs.unlink(largeJpegPath).catch(() => {});
  });

  async function login(page: Page) {
    await page.goto(`${fixture.baseUrl}/login`);
    await page.fill("#email", "tt-browser-admin@test.local");
    await page.fill("#password", fixture.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
  }

  async function uploadLargeJpegOnDetail(page: Page) {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.locator('[data-tt="create"]:visible, [data-tt="create-fab"]:visible').first().click();
    await page.fill('[data-tt-field="item"]', "Large JPEG preview box");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="files"]', { timeout: 10000 });
    await page.locator('[data-tt="attach-input"]').first().setInputFiles(largeJpegPath);
    await page.waitForFunction(() => !document.querySelector('[data-tt="attach-busy"]'), undefined, {
      timeout: 180000,
    });
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="recipient"]', { timeout: 10000 });
    await page.click('[data-tt="create-recipient-browse"]');
    await page.locator('[data-tt-pick]').first().click();
    await page.click('[data-tt="create-wizard-next"]');
    const createResp = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/tan-tracker/transfers") && r.status() === 201,
      { timeout: 120000 },
    );
    await page.click('[data-tt="create-wizard-submit"]');
    await createResp;
    await page.waitForSelector('[data-tt="detail"]', { timeout: 60000 });
  }

  for (const engine of [chromium, webkit] as const) {
    it(`thumbnail and lightbox decode persisted JPEG after reload (${engine.name()})`, async (t) => {
      const browser = await launchRequired(engine, t);
      const context = await browser!.newContext(
        engine === webkit ? { ...IPHONE_13, baseURL: fixture.baseUrl } : { baseURL: fixture.baseUrl },
      );
      try {
        const page = await context.newPage();
        await login(page);
        await uploadLargeJpegOnDetail(page);

        const inlinePreview = page.waitForResponse(
          (r) =>
            r.request().method() === "GET" &&
            r.url().includes("/attachments/") &&
            r.url().includes("preview=1") &&
            r.status() === 200,
          { timeout: 120000 },
        );
        await page.reload({ waitUntil: "networkidle" });
        const previewResponse = await inlinePreview;
        assert.match(String(previewResponse.headers()["content-disposition"] || ""), /^inline;/i);

        const thumb = page.locator(".tt-att-thumb img").first();
        await thumb.waitFor({ state: "visible", timeout: 60000 });
        const thumbNatural = await thumb.evaluate((img: HTMLImageElement) => ({
          w: img.naturalWidth,
          h: img.naturalHeight,
        }));
        assert.ok(thumbNatural.w > 0 && thumbNatural.h > 0, "thumbnail must decode after reload");

        await page.locator('[data-tt="attach-preview"]').first().click();
        await page.waitForSelector('[data-tt="attach-lightbox"]:not([hidden])', { timeout: 15000 });
        const lbImg = page.locator('[data-tt="attach-lightbox-img"]');
        await lbImg.waitFor({ state: "visible", timeout: 60000 });
        const lbNatural = await lbImg.evaluate((img: HTMLImageElement) => ({
          w: img.naturalWidth,
          h: img.naturalHeight,
          hidden: img.hidden,
        }));
        assert.equal(lbNatural.hidden, false);
        assert.ok(lbNatural.w > 0 && lbNatural.h > 0, "lightbox image must decode on mobile WebKit");
        assert.equal(await page.locator('[data-tt="attach-lightbox-fallback"]:not([hidden])').count(), 0);
      } finally {
        await context.close();
        await browser!.close();
      }
    });
  }
});
