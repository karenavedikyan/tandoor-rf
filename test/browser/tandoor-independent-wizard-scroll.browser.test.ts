import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { webkit, type Page } from "playwright";
import {
  seedTanTrackerBrowserUsers, startBrowserHttpFixture, stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("independent: internal wizard reveals next action and returns to edited review block", { concurrency: false }, () => {
  let f: BrowserHttpFixture;
  const qa = process.env.TT_SCROLL_QA_DIR || join(tmpdir(), "tandoor-wizard-scroll-qa");
  before(async () => {
    await mkdir(qa, { recursive: true });
    f = await startBrowserHttpFixture({ attachmentsDir: "var/independent-wizard-scroll" });
    await seedTanTrackerBrowserUsers(f.databaseUrl, f.password);
  });
  after(async () => { await stopBrowserHttpFixture(f); });

  async function reachable(page: Page, selector: string) {
    return page.locator(selector).first().evaluate(el => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return { top: r.top, bottom: r.bottom, height: r.height, viewport: innerHeight,
        reachable: !!hit && (hit === el || el.contains(hit)) && r.top >= 0 && r.bottom <= innerHeight };
    });
  }
  async function expectReachable(page: Page, selector: string, message: string) {
    await page.locator(".tt-wizard-shell-card").evaluate(el => Promise.all(
      el.getAnimations({ subtree: true })
        .filter(a => a.effect?.getTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})),
    ));
    await page.waitForFunction(s => {
      const el = document.querySelector(s); if (!el) return false;
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return !!hit && (el === hit || el.contains(hit)) && r.top >= 0 && r.bottom <= innerHeight;
    }, selector, { timeout: 3500 }).catch(() => {});
    const actual = await reachable(page, selector);
    assert.ok(actual.reachable, `${message}: ${JSON.stringify(actual)}`);
  }
  async function prepareReview(page: Page) {
    await page.goto(`${f.baseUrl}/login`);
    await page.fill("#email", "tt-browser-admin@test.local");
    await page.fill("#password", f.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/);
    await page.goto(`${f.baseUrl}/tan-tracker`);
    await page.locator('[data-tt="create"]:visible, [data-tt="create-fab"]:visible').first().click();
    await page.locator('[data-tt-field="item"]').fill("Договор и приложения");
    await page.locator('[data-tt="create-wizard-next"]').click();
    await page.locator('[data-tt="create-skip-files"]').click();
    await page.locator('[data-tt="create-recipient-browse"]').click();
    await page.locator("[data-tt-pick]").filter({ hasText: "Browser Fresh Recipient" }).first().click();
    await page.locator('[data-tt="create-wizard-next"]').click();
    await page.locator('[data-create-phase="review"]').waitFor();
  }

  for (const setup of [
    { engine: "chromium", width: 1280, height: 650 },
    { engine: "chromium", width: 1280, height: 500 },
    { engine: "webkit", width: 390, height: 700 },
  ]) it(`${setup.engine} ${setup.width}×${setup.height}: comment/due/Back stay reachable without manual scrolling`, async () => {
    const browser = setup.engine === "webkit" ? await webkit.launch({ headless: true }) : f.browser;
    const context = await browser.newContext({
      viewport: { width: setup.width, height: setup.height },
      reducedMotion: setup.height === 500 ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    try {
      await prepareReview(page);
      // Start observing the changed flow after unrelated login → Clients navigation has settled.
      page.on("pageerror", e => errors.push(e.message));
      const comment = '[data-tt="create-edit-comment"]';
      await page.locator(comment).click();
      await page.locator('[data-create-phase="edit-comment"]').waitFor();
      await expectReachable(page, '[data-tt-field="comment"]', "next editable field must be visible");
      await page.locator('[data-tt-field="comment"]').fill("Проверьте комплект документов. ".repeat(12));
      await page.keyboard.type("Дополнение");
      assert.ok(await page.locator('[data-tt-field="comment"]').evaluate(e => document.activeElement === e));
      await page.locator('[data-tt="create-wizard-next"]').click();
      await page.locator('[data-create-phase="review"]').waitFor();
      await expectReachable(page, comment, "return from comment must reveal its review section, not top");
      await page.screenshot({ path: join(qa, `${setup.engine}-${setup.width}-${setup.height}-after-comment.png`), animations: "disabled" });
      assert.match(await page.locator(".tt-wizard-review-details").innerText(), /Дополнение/);

      const due = '[data-tt="create-edit-due"]';
      await page.locator(due).click();
      await page.locator('[data-create-phase="edit-due"]').waitFor();
      await expectReachable(page, '[data-tt-field="due"]', "date input must be reachable");
      await page.locator('[data-tt-field="due"]').fill("2026-11-02T18:30");
      await page.locator('[data-tt="create-wizard-next"]').click();
      await page.locator('[data-create-phase="review"]').waitFor();
      await expectReachable(page, due, "return from date must reveal date review block");

      const files = '[data-tt="create-edit-files"]';
      await page.locator(files).click();
      await page.locator('[data-create-phase="files"]').waitFor();
      await page.locator('[data-tt="attach-input"]').first().setInputFiles(
        fileURLToPath(new URL("../fixtures/tan-tracker-admin-wizard.png", import.meta.url)),
      );
      await page.waitForFunction(() => {
        const next = document.querySelector<HTMLButtonElement>('[data-tt="create-wizard-next"]');
        return !!next && !next.disabled && !document.querySelector('[data-tt="attach-busy"]');
      });
      await page.locator('[data-tt="create-wizard-next"]').click();
      await page.locator('[data-create-phase="review"]').waitFor();
      await expectReachable(page, files, "return from photo must show updated files section");

      await page.locator(comment).click();
      await page.locator('[data-tt="create-wizard-back"]').click();
      await page.locator('[data-create-phase="review"]').waitFor();
      await expectReachable(page, comment, "Back must restore the edited section too");
      const item = '[data-tt="create-edit-item"]';
      await page.locator(item).click();
      await page.locator('[data-tt-field="item"]').fill("Договор: исправленный комплект");
      await page.locator('[data-tt="create-wizard-next"]').click();
      await page.locator('[data-create-phase="review"]').waitFor();
      await expectReachable(page, item, "return from item must show its changed title");
      assert.match(await page.locator(".tt-wizard-review-item-title").innerText(), /исправленный комплект/);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      if (setup.engine === "webkit") await browser.close();
    }
  });
});
