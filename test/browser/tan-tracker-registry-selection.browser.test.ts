import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("tan-tracker registry selection browser", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-registry-selection-browser" });
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

  it("loads registry personal bar and select-all affordance for LK admin", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    assert.ok(await page.locator('[data-tt="registry-personal-bar"]').count());
    assert.ok(await page.locator('[data-tt="registry-select-all"]').count());
    await context.close();
  });
});
