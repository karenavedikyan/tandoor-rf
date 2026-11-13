import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import type { Page } from "playwright";
import {
  seedTanTrackerBrowserUsers, startBrowserHttpFixture, stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("tan-tracker invitation preview and explicit copy", () => {
  let fixture: BrowserHttpFixture;
  let phone = 60;
  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-browser-single-invite",
      extraEnv: {
        TT_EXTERNAL_MESSENGER_ENABLED: "true", TANBOT_TELEGRAM_ENABLED: "true",
        TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-test-token-for-browser-only",
        TANBOT_TELEGRAM_BOT_USERNAME: "tandoor_test_bot",
        TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "test-link-pepper-min-16-chars", TANBOT_MAX_ENABLED: "false",
      },
    });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
  });
  after(async () => { if (fixture) await stopBrowserHttpFixture(fixture); });
  async function create(page: Page) {
    await page.goto(`${fixture.baseUrl}/login`);
    await page.fill("#email", "tt-browser-admin@test.local");
    await page.fill("#password", fixture.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/);
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]');
    await page.locator('[data-tt="create"]:visible, [data-tt="create-fab"]:visible').first().click();
    await page.fill('[data-tt-field="item"]', "Single invite action box");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.fill('[data-tt-field="newPhone"]', `+799911122${++phone}`);
    await page.fill('[data-tt-field="newName"]', "Invite recipient");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-wizard-submit"]');
    await page.waitForSelector('[data-tt="detail"]');
  }
  async function observe(page: Page, mode = "success") {
    await page.evaluate(`(() => {
      const mode = ${JSON.stringify(mode)};
      const w = window;
      w.__shares = []; w.__copies = [];
      Object.defineProperty(navigator, "share", { configurable: true, value: (p) => {
        w.__shares.push(p); throw new Error("system share must not run");
      } });
      Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: mode === "missing" ? undefined : { writeText: (text) => {
          w.__copies.push(text);
          if (mode === "sync-error") throw new Error("synchronous denial");
          if (mode === "denied") return Promise.reject(new Error("clipboard denied"));
          if (mode === "pending") return new Promise(resolve => { w.__resolveCopy = resolve; });
          return Promise.resolve();
        } },
      });
    })()`);
  }
  for (const width of [1366, 375]) for (const deliveryStatus of [null, "pending", "sent"] as const) {
    it(`${width}px/${deliveryStatus ?? "manual"}: visible primary invitation and explicit exact copy`, async () => {
      const context = await fixture.browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage(), errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        if (deliveryStatus) {
          await page.route("**/api/tan-tracker/bootstrap", async route => {
            const response = await route.fetch(), body = await response.json();
            // Render both server delivery statuses without starting a transport.
            body.orders = body.orders.map((order: object) => ({ ...order, automaticReceiptStatus: deliveryStatus }));
            await route.fulfill({ response, json: body });
          });
        }
        await create(page);
        if (deliveryStatus) {
          await page.reload();
          await page.waitForSelector('[data-tt="detail"]');
        }
        await observe(page);
        const primary = page.getByRole("button", { name: "Получить код от получателя", exact: true });
        assert.equal(await primary.isVisible(), true);
        assert.match(await primary.getAttribute("class") ?? "", /tt-primary/);
        if (deliveryStatus) {
          assert.equal(await page.locator('[data-tt="automatic-receipt-status"]').isVisible(), true);
          assert.equal(await page.locator('[data-tt="automatic-receipt-status"] details').count(), 0);
        }
        if (process.env.TT_QA_SCREENSHOT_DIR && deliveryStatus === "sent") {
          await primary.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${process.env.TT_QA_SCREENSHOT_DIR}/recipient-invitation-${width}.png`, fullPage: true });
        }
        let posts = 0;
        page.on("request", req => { if (req.method() === "POST" && req.url().includes("/messenger-invite")) posts++; });
        await page.click('[data-tt="messenger-invite-action"]');
        const field = page.locator('[data-tt="messenger-invite-message-text"]');
        await field.waitFor({ state: "visible" });
        const text = await field.inputValue();
        assert.match(text, /Single invite action box/);
        assert.match(text, /Посмотреть передачу и получить код:/);
        assert.equal((text.match(/https?:\/\/\S+/g) || []).length, 1);
        assert.doesNotMatch(text, /[?&](est|tt_hat)=|holderAccessToken/);
        assert.deepEqual(await page.evaluate(() => [(window as any).__shares.length, (window as any).__copies.length]), [0, 0]);
        assert.equal(await page.locator('[data-tt="messenger-invite-action"]').getAttribute("aria-expanded"), "true");
        await page.click('[data-tt="messenger-invite-copy"]');
        await page.locator('[data-tt="messenger-invite-copy-status"]').filter({ hasText: "Приглашение скопировано." }).waitFor();
        assert.deepEqual(await page.evaluate(() => (window as any).__copies), [text]);
        assert.equal(await field.isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.click('[data-tt="messenger-invite-action"]');
        assert.equal(await field.count(), 0);
        await page.click('[data-tt="messenger-invite-action"]');
        await field.waitFor({ state: "visible" });
        assert.equal(await field.inputValue(), text);
        assert.equal(posts, 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
  for (const mode of ["denied", "sync-error", "missing"]) {
    it(`${mode}: keeps text selectable and gives honest manual-copy feedback`, async () => {
      const context = await fixture.browser.newContext();
      try {
        const page = await context.newPage();
        await create(page); await observe(page, mode);
        await page.click('[data-tt="messenger-invite-action"]');
        const field = page.locator('[data-tt="messenger-invite-message-text"]');
        await field.waitFor({ state: "visible" });
        await page.click('[data-tt="messenger-invite-copy"]');
        await page.locator('[data-tt="messenger-invite-copy-status"]').filter({ hasText: "Не удалось скопировать автоматически" }).waitFor();
        assert.match(await field.inputValue(), /Посмотреть передачу и получить код:/);
        assert.equal(await field.isVisible(), true);
        assert.equal(await page.evaluate(() => (window as any).__shares.length), 0);
        assert.doesNotMatch(await page.locator('[data-tt="messenger-invite-copy-status"]').innerText(), /Приглашение скопировано/);
      } finally { await context.close(); }
    });
  }
  it("late preparation after leaving cannot reveal or copy the old invitation", async () => {
    const context = await fixture.browser.newContext();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const page = await context.newPage();
      await create(page); await observe(page);
      await page.route("**/messenger-invite", async route => { await gate; await route.continue(); });
      const requested = page.waitForRequest(r => r.method() === "POST" && r.url().includes("/messenger-invite"));
      await page.click('[data-tt="messenger-invite-action"]'); await requested;
      await page.click('[data-tt="back-list"]');
      const response = page.waitForResponse(r => r.url().includes("/messenger-invite"));
      release(); await response;
      assert.equal(await page.locator('[data-tt="detail"]').count(), 0);
      assert.equal(await page.locator('[data-tt="messenger-invite-message-text"]').count(), 0);
      assert.deepEqual(await page.evaluate(() => [(window as any).__shares.length, (window as any).__copies.length]), [0, 0]);
    } finally { release(); await context.close(); }
  });
  it("late clipboard completion after leaving cannot write feedback into another view", async () => {
    const context = await fixture.browser.newContext();
    try {
      const page = await context.newPage();
      await create(page); await observe(page, "pending");
      await page.click('[data-tt="messenger-invite-action"]');
      await page.waitForSelector('[data-tt="messenger-invite-message-text"]');
      await page.click('[data-tt="messenger-invite-copy"]');
      await page.waitForFunction(() => typeof (window as any).__resolveCopy === "function");
      await page.click('[data-tt="back-list"]');
      await page.evaluate(() => (window as any).__resolveCopy());
      assert.equal(await page.locator('[data-tt="messenger-invite-copy-status"]').count(), 0);
      assert.equal(await page.getByText("Приглашение скопировано", { exact: true }).count(), 0);
    } finally { await context.close(); }
  });
});
