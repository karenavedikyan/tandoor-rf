import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { createTestUser } from "../helpers/test-db";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("tan-tracker edit before first handoff (browser)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-edit-draft-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
    await createTestUser({
      databaseUrl: fixture.databaseUrl,
      email: "tt-browser-peer@test.local",
      password: fixture.password,
      fullName: "Browser Manager Peer",
      role: "manager",
    });
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

  it("create → code → edit recipient/title → same id, old code fails", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await login(page, "tt-browser-admin@test.local");
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "Edit-before-handoff item");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.click('[data-tt="create-recipient-browse"]');
    await page.locator('[data-tt-pick]').filter({ hasText: "Browser Fresh Recipient" }).first().click();
    await page.click('[data-tt="create-wizard-next"]');
    const createResp = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/tan-tracker/transfers") && r.status() === 201,
      { timeout: 30000 },
    );
    await page.click('[data-tt="create-wizard-submit"]');
    const created = await (await createResp).json();
    const transferId = created.publicCode as string;
    await page.waitForSelector('[data-tt="detail"]', { timeout: 20000 });

    await page.context().request.post(`${fixture.baseUrl}/api/auth/logout`, { headers: { Origin: fixture.baseUrl } });
    await login(page, "tt-browser-fresh@test.local");
    await page.goto(`${fixture.baseUrl}/tan-tracker?tt_order=${encodeURIComponent(transferId)}`);
    await page.waitForSelector('[data-tt="detail"]', { timeout: 20000 });
    await page.click('[data-tt="gen-code"]');
    await page.waitForSelector('[data-tt="shown-code"]', { timeout: 15000 });
    const oldCode = (await page.locator('[data-tt="shown-code"]').textContent())?.trim() ?? "";
    assert.match(oldCode, /^\d{6}$/);

    await page.context().request.post(`${fixture.baseUrl}/api/auth/logout`, { headers: { Origin: fixture.baseUrl } });
    await login(page, "tt-browser-admin@test.local");
    await page.goto(`${fixture.baseUrl}/tan-tracker?tt_order=${encodeURIComponent(transferId)}`);
    await page.waitForSelector('[data-tt="edit-draft"], [data-tt="handoff-panel"]', { timeout: 20000 });
    await page.click('[data-tt="edit-draft"]');
    await page.waitForSelector('[data-create-phase="review"]', { timeout: 15000 });
    await page.click('[data-tt="create-edit-item"]');
    await page.fill('[data-tt-field="item"]', "Edit-before-handoff REVISED");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-edit-recipient"]');
    await page.click('[data-tt="create-recipient-browse"]');
    await page.locator('[data-tt-pick]').filter({ hasText: "Browser Manager Peer" }).first().click();
    await page.click('[data-tt="create-wizard-next"]');

    const editResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/draft-edit`) &&
        r.status() === 200,
      { timeout: 30000 },
    );
    await page.click('[data-tt="create-wizard-submit"]');
    await editResp;
    await page.waitForSelector('[data-tt="detail"]', { timeout: 20000 });
    assert.match(await page.content(), /REVISED/);

    const staleVerify = await page.context().request.post(
      `${fixture.baseUrl}/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`,
      {
        headers: { Origin: fixture.baseUrl, "Content-Type": "application/json" },
        data: { code: oldCode },
      },
    );
    assert.notEqual(staleVerify.status(), 200);

    await browser.close();
  });
});
