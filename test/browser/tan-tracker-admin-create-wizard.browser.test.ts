import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import sharp from "sharp";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("tan-tracker admin full create wizard (browser + real PG)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  let pngPath = "";
  let pngBytes: Buffer;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-admin-wizard-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
    pngBytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
    pngPath = path.join(os.tmpdir(), `tt-admin-wizard-${Date.now()}.png`);
    await fs.writeFile(pngPath, pngBytes);
  });

  after(async () => {
    await fs.unlink(pngPath).catch(() => undefined);
    await stopBrowserHttpFixture(fixture);
  });

  async function login(page: Page, email: string) {
    await page.goto(`${fixture.baseUrl}/login`);
    await page.fill("#email", email);
    await page.fill("#password", fixture.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
  }

  async function runAdminCreateWizard(page: Page) {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.waitForSelector('[data-tt="create-wizard"]', { timeout: 15000 });

    await page.fill('[data-tt-field="item"]', "Browser admin коробка");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="files"]', { timeout: 10000 });

    const fileInput = page.locator('[data-tt="attach-input"]').first();
    await fileInput.setInputFiles(pngPath);
    await page.waitForFunction(
      () => {
        const busy = document.querySelector('[data-tt="attach-busy"]');
        const btn = document.querySelector('[data-tt="create-wizard-next"]');
        return !busy && btn && !btn.hasAttribute("disabled");
      },
      { timeout: 20000 },
    );
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="recipient"]', { timeout: 10000 });

    await page.click('[data-tt="create-recipient-browse"]');
    await page.waitForSelector('[data-tt="contact-pick"]', { timeout: 10000 });
    await page.locator('[data-tt-pick]').filter({ hasText: "Browser Fresh Recipient" }).first().click();
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="review"]', { timeout: 10000 });

    const submit = page.locator('[data-tt="create-wizard-submit"]');
    const createResponsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/api/tan-tracker/transfers") &&
        r.status() === 201,
      { timeout: 30000 },
    );
    await submit.click();
    const createResponse = await createResponsePromise;
    const createBody = (await createResponse.json()) as { publicCode?: string };
    await page.waitForFunction(
      () => {
        return (
          document.querySelector('[data-tt="create-saved-receipt"]') ||
          document.querySelector('[data-tt="detail"]') ||
          document.querySelector(".tt-toast")
        );
      },
      { timeout: 30000 },
    );

    assert.ok(createBody.publicCode, "create response must include publicCode");

    const receipt = page.locator('[data-tt="create-saved-receipt"]');
    if (await receipt.count()) {
      await page.click('[data-tt="create-retry-refresh"]');
      await page.waitForSelector('[data-tt="detail"]', { timeout: 20000 }).catch(() => undefined);
    }
    await page.waitForSelector('[data-tt="detail"], [data-tt-open]', { timeout: 15000 });
    assert.match(await page.content(), /Browser admin коробка|admin коробка/i);

    const boot = await page.request.get(`${fixture.baseUrl}/api/tan-tracker/bootstrap`);
    assert.equal(boot.status(), 200);
    const bootJson = (await boot.json()) as {
      orders: Array<{ id: string; item: string; attachments?: Array<{ id: string }> }>;
    };
    const order = bootJson.orders.find((o) => o.id === createBody.publicCode);
    assert.ok(order, "created transfer visible in bootstrap after save");
    assert.match(order!.item, /Browser admin/i);
    if (order!.attachments?.length) {
      const attId = order!.attachments[0]!.id;
      const dl = await page.request.get(
        `${fixture.baseUrl}/api/tan-tracker/transfers/${encodeURIComponent(order!.id)}/attachments/${encodeURIComponent(attId)}`,
      );
      assert.equal(dl.status(), 200);
      const body = await dl.body();
      assert.ok(body.equals(pngBytes), "downloaded attachment bytes match uploaded PNG");
    }

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    const bootAfterReload = await page.request.get(`${fixture.baseUrl}/api/tan-tracker/bootstrap`);
    const bootAfterJson = (await bootAfterReload.json()) as { orders: Array<{ id: string }> };
    assert.ok(
      bootAfterJson.orders.some((o) => o.id === createBody.publicCode),
      "transfer persists after page reload",
    );

    const meRes = await page.request.get(`${fixture.baseUrl}/api/auth/me`);
    assert.equal(meRes.status(), 200);
    assert.equal((await meRes.json()).user.role, "admin");
  }

  it("completes upload → recipient → submit → detail/reload as unlinked admin", async () => {
    const context = await fixture.browser.newContext({
      viewport: { width: 1280, height: 900 },
      baseURL: fixture.baseUrl,
    });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    await runAdminCreateWizard(page);
    await context.close();
  });

  it("double submit does not fire duplicate POST while createSubmitting", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    let postCount = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/tan-tracker/transfers")) postCount++;
    });
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "No duplicate click");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.click('[data-tt="create-recipient-browse"]');
    await page.locator('[data-tt-pick]').filter({ hasText: "Browser Fresh Recipient" }).first().click();
    await page.click('[data-tt="create-wizard-next"]');
    const submit = page.locator('[data-tt="create-wizard-submit"]');
    await submit.click({ clickCount: 2, delay: 50 });
    await page.waitForTimeout(3000);
    assert.ok(postCount <= 1, `expected at most one create POST, got ${postCount}`);
    await context.close();
  });
});
