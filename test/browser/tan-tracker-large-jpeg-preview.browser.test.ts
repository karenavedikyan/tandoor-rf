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
import { assertImageVisuallyPainted, sampleLocatorImagePaint } from "./helpers/image-painted";

const IPHONE_13 = devices["iPhone 13"];

/** 24MP high-entropy JPEG stress fixture (synthetic noise, not a production photo). */
const STRESS_JPEG_WIDTH = 5712;
const STRESS_JPEG_HEIGHT = 4284;
const STRESS_JPEG_MIN_BYTES = 1_000_000;
const STRESS_JPEG_MAX_BYTES = 10 * 1024 * 1024;

function fillDeterministicNoiseRgb(buf: Buffer): void {
  let seed = 0x29fec262;
  for (let i = 0; i < buf.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    buf[i] = seed & 0xff;
  }
}

async function writeLargeStressJpeg(outPath: string): Promise<number> {
  const pixels = STRESS_JPEG_WIDTH * STRESS_JPEG_HEIGHT * 3;
  const raw = Buffer.allocUnsafe(pixels);
  fillDeterministicNoiseRgb(raw);
  await sharp(raw, { raw: { width: STRESS_JPEG_WIDTH, height: STRESS_JPEG_HEIGHT, channels: 3 } })
    .jpeg({ quality: 68, mozjpeg: true })
    .toFile(outPath);
  const stat = await fs.stat(outPath);
  assert.ok(
    stat.size > STRESS_JPEG_MIN_BYTES && stat.size < STRESS_JPEG_MAX_BYTES,
    `stress JPEG must be >1MB and <10MB (got ${stat.size} bytes)`,
  );
  return stat.size;
}

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

describe("tan-tracker large JPEG bounded preview after reload (browser + PG)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  let largeJpegPath = "";
  let originalByteSize = 0;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-large-jpeg-preview-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
    largeJpegPath = path.join(os.tmpdir(), `tt-large-preview-${process.pid}.jpg`);
    originalByteSize = await writeLargeStressJpeg(largeJpegPath);
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
    it(`thumbnail and lightbox use bounded server previews after reload (${engine.name()})`, async (t) => {
      const browser = await launchRequired(engine, t);
      const context = await browser!.newContext(
        engine === webkit ? { ...IPHONE_13, baseURL: fixture.baseUrl } : { baseURL: fixture.baseUrl },
      );
      try {
        const page = await context.newPage();
        await login(page);
        await uploadLargeJpegOnDetail(page);

        const thumbPreview = page.waitForResponse(
          (r) =>
            r.request().method() === "GET" &&
            r.url().includes("/attachments/") &&
            r.url().includes("preview=thumb") &&
            r.status() === 200,
          { timeout: 120000 },
        );
        await page.reload({ waitUntil: "networkidle" });
        const thumbResponse = await thumbPreview;
        const thumbBytes = (await thumbResponse.body()).length;
        assert.ok(thumbBytes < originalByteSize / 5, "thumb response must be much smaller than original file");
        assert.equal(thumbResponse.headers()["content-type"], "image/jpeg");

        const thumb = page.locator(".tt-att-thumb img").first();
        await thumb.waitFor({ state: "visible", timeout: 60000 });
        await page.waitForFunction(
          () => !document.querySelector(".tt-att-thumb--loading"),
          undefined,
          { timeout: 60000 },
        );
        const thumbNatural = await thumb.evaluate((img: HTMLImageElement) => ({
          w: img.naturalWidth,
          h: img.naturalHeight,
        }));
        assert.ok(thumbNatural.w > 0 && thumbNatural.h > 0, "thumbnail must decode after reload");
        assert.ok(
          Math.max(thumbNatural.w, thumbNatural.h) <= 320,
          "thumbnail natural size must match bounded server preview",
        );

        const lightboxPreview = page.waitForResponse(
          (r) =>
            r.request().method() === "GET" &&
            r.url().includes("/attachments/") &&
            r.url().includes("preview=lightbox") &&
            r.status() === 200,
          { timeout: 120000 },
        );
        await page.locator('[data-tt="attach-preview"]').first().click();
        await page.waitForSelector('[data-tt="attach-lightbox"]:not([hidden])', { timeout: 15000 });
        const lightboxResponse = await lightboxPreview;
        const lbBytes = (await lightboxResponse.body()).length;
        assert.ok(lbBytes < originalByteSize, "lightbox response must be smaller than original file");
        assert.ok(lbBytes > thumbBytes, "lightbox payload should exceed thumb preview");

        await page.waitForFunction(
          () => {
            const loading = document.querySelector('[data-tt="attach-lightbox-loading"]');
            const img = document.querySelector('[data-tt="attach-lightbox-img"]') as HTMLImageElement | null;
            return loading?.hasAttribute("hidden") && img && !img.hidden;
          },
          undefined,
          { timeout: 60000 },
        );
        const lbImg = page.locator('[data-tt="attach-lightbox-img"]');
        const lbPaint = await sampleLocatorImagePaint(lbImg);
        assertImageVisuallyPainted(lbPaint, engine.name());
        assert.ok(
          Math.max(lbPaint.w, lbPaint.h) <= 1600,
          "lightbox natural size must match bounded server preview",
        );
        assert.equal(await page.locator('[data-tt="attach-lightbox-fallback"]:not([hidden])').count(), 0);

        const downloadHref = await page.locator('[data-tt="attach-download"]').first().getAttribute("href");
        assert.ok(downloadHref && downloadHref.includes("download=1"));
        const downloadResponse = await page.request.get(`${fixture.baseUrl}${downloadHref}`);
        assert.equal(downloadResponse.status(), 200);
        assert.equal(Buffer.from(await downloadResponse.body()).length, originalByteSize);
      } finally {
        await context.close();
        await browser!.close();
      }
    });
  }
});
