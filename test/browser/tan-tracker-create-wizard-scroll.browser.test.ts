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
const STAFF_EMAIL = "tt-browser-admin@test.local";

async function launchRequired(engine: BrowserType<Browser>, t: { skip: (message?: string) => void }) {
  try {
    if (engine === chromium) {
      return await chromium.launch({ headless: true, channel: "chromium" });
    }
    return await webkit.launch({ headless: true });
  } catch (err) {
    t.skip(`${engine.name()} required: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function clickCreateEntry(page: Page) {
  const fab = page.locator('[data-tt="create-fab"]');
  if ((await fab.count()) && (await fab.first().isVisible())) {
    await fab.first().click();
    return;
  }
  await page.locator('[data-tt="create"]').first().click();
}

async function loginStaff(page: Page, fixture: BrowserHttpFixture) {
  await page.goto(`${fixture.baseUrl}/login`);
  await page.fill("#email", STAFF_EMAIL);
  await page.fill("#password", fixture.password);
  await page.click("#login-button");
  await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
}

async function openInternalCreateReview(page: Page) {
  await page.goto("/tan-tracker");
  await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
  await clickCreateEntry(page);
  await page.waitForSelector('[data-tt="create-wizard"]', { timeout: 15000 });
  await page.fill('[data-tt-field="item"]', "Scroll regression parcel");
  await page.click('[data-tt="create-wizard-next"]');
  await page.waitForSelector('[data-create-phase="files"]', { timeout: 10000 });
  await page.click('[data-tt="create-skip-files"]');
  await page.waitForSelector('[data-create-phase="recipient"]', { timeout: 10000 });
  await page.click('[data-tt="create-recipient-browse"]');
  await page.waitForSelector('[data-tt-field="pickQ"]', { timeout: 10000 });
  await page.locator('[data-tt-pick]').filter({ hasText: "Browser Fresh Recipient" }).first().click();
  await page.click('[data-tt="create-wizard-next"]');
  await page.waitForSelector('[data-create-phase="review"]', { timeout: 15000 });
}

async function waitCreateWizardScrollFrame(page: Page) {
  await page.waitForFunction(() => {
    return new Promise<boolean>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    });
  });
}

async function anchorInViewport(page: Page, selector: string, label: string) {
  await waitCreateWizardScrollFrame(page);
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 32 && r.bottom <= window.innerHeight - 48;
  }, selector);
  assert.ok(ok, `${label}: ${selector} should stay in viewport`);
}

describe("internal create wizard scroll follow (browser)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-create-wizard-scroll-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  async function withPage(
    browser: Browser,
    viewport: { width: number; height: number },
    fn: (page: Page) => Promise<void>,
  ) {
    const context = await browser.newContext({ baseURL: fixture.baseUrl, viewport });
    const page = await context.newPage();
    try {
      await loginStaff(page, fixture);
      await fn(page);
    } finally {
      await context.close();
    }
  }

  for (const engine of [chromium, webkit] as const) {
    for (const vp of [
      { label: "desktop", width: 1280, height: 650 },
      { label: "mobile", width: 390, height: 700 },
    ] as const) {
      it(`review comment edit returns near next action (${engine.name()} ${vp.label})`, async (t) => {
        const browser = engine === chromium ? fixture.browser : await launchRequired(webkit, t);
        if (!browser) return;
        const ownBrowser = engine !== chromium;
        try {
          await withPage(browser, vp, async (page) => {
            await openInternalCreateReview(page);
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await waitCreateWizardScrollFrame(page);
            const yBefore = await page.evaluate(() => window.scrollY);
            assert.ok(yBefore > 40, "review should allow scrolling down on long screen");
            await page.click('[data-tt="create-edit-comment"]');
            await page.waitForSelector('[data-create-phase="edit-comment"]', { timeout: 10000 });
            await page.fill('[data-tt-field="comment"]', "Handle with care — scroll test");
            await page.click('[data-tt="create-wizard-next"]');
            await page.waitForSelector('[data-create-phase="review"]', { timeout: 10000 });
            const yAfter = await page.evaluate(() => window.scrollY);
            assert.ok(yAfter > 24, "must not jump to document top after Done");
            await anchorInViewport(page, '[data-tt="create-wizard-submit"]', "submit after comment edit");
          });
        } finally {
          if (ownBrowser) await browser.close();
        }
      });
    }
  }

  it("files upload soft rerender preserves scroll (Chromium desktop)", async () => {
    await withPage(fixture.browser, { width: 1280, height: 650 }, async (page) => {
      await page.goto("/tan-tracker");
      await clickCreateEntry(page);
      await page.fill('[data-tt-field="item"]', "Upload scroll");
      await page.click('[data-tt="create-wizard-next"]');
      await page.waitForSelector('[data-create-phase="files"]');
      await page.evaluate(() => window.scrollTo(0, 220));
      await page.evaluate(() => {
        (window as unknown as { __ttScrollWatch?: { max: number; last: number } }).__ttScrollWatch = {
          max: 0,
          last: window.scrollY,
        };
        window.addEventListener(
          "scroll",
          () => {
            const w = (window as unknown as { __ttScrollWatch?: { max: number; last: number } }).__ttScrollWatch;
            if (!w) return;
            const jump = Math.abs(window.scrollY - w.last);
            if (jump > w.max) w.max = jump;
            w.last = window.scrollY;
          },
          { passive: true },
        );
      });
      const yBefore = await page.evaluate(() => window.scrollY);
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(FIXTURE_PNG);
      await page.waitForFunction(
        () => {
          const busy = document.querySelector('[data-tt="attach-busy"]');
          const btn = document.querySelector('[data-tt="create-wizard-next"]');
          return !busy && btn && !btn.hasAttribute("disabled");
        },
        { timeout: 25000 },
      );
      await waitCreateWizardScrollFrame(page);
      const metrics = await page.evaluate(() => ({
        y: window.scrollY,
        maxJump: (window as unknown as { __ttScrollWatch?: { max: number } }).__ttScrollWatch?.max ?? 0,
      }));
      assert.ok(metrics.y >= yBefore - 80, `scroll position preserved (y=${metrics.y}, before=${yBefore})`);
      assert.ok(metrics.maxJump < 120, `no large scroll jumps during upload (maxJump=${metrics.maxJump})`);
    });
  });

  it("recipient browse reveals search field (Chromium mobile)", async () => {
    await withPage(fixture.browser, { width: 390, height: 700 }, async (page) => {
      await page.goto("/tan-tracker");
      await clickCreateEntry(page);
      await page.fill('[data-tt-field="item"]', "Recipient scroll");
      await page.click('[data-tt="create-wizard-next"]');
      await page.click('[data-tt="create-skip-files"]');
      await page.waitForSelector('[data-create-phase="recipient"]');
      await page.click('[data-tt="create-recipient-browse"]');
      await page.waitForSelector('[data-tt-field="pickQ"]', { timeout: 10000 });
      await anchorInViewport(page, '[data-tt-field="pickQ"]', "recipient search");
    });
  });

  it("recipient validation reveals error without jumping to top (Chromium 1280x650)", async () => {
    await withPage(fixture.browser, { width: 1280, height: 650 }, async (page) => {
      await page.goto("/tan-tracker");
      await clickCreateEntry(page);
      await page.fill('[data-tt-field="item"]', "Validation scroll");
      await page.click('[data-tt="create-wizard-next"]');
      await page.click('[data-tt="create-skip-files"]');
      await page.evaluate(() => window.scrollTo(0, 180));
      await page.click('[data-tt="create-wizard-next"]');
      await page.waitForSelector('[data-tt="form-error"]', { timeout: 10000 });
      const y = await page.evaluate(() => window.scrollY);
      assert.ok(y > 20, "validation should not reset scroll to top");
      await anchorInViewport(page, '[data-tt="form-error"]', "validation error");
    });
  });
});
