import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { Pool } from "pg";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { createTestUser } from "../helpers/test-db";

describe("tan-tracker LK write capability browser", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-lk-write-cap-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);

    const emp = randomUUID();
    await createTestUser({
      databaseUrl: fixture.databaseUrl,
      email: "tt-browser-mgr@test.local",
      password: fixture.password,
      fullName: "Browser Mgr",
      role: "manager",
    });
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 1 });
    try {
      await pool.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Browser Mgr', 'Manager', '{}')`,
        [emp],
      );
      const mgr = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "tt-browser-mgr@test.local",
      ])).rows[0];
      await linkUserToEmployee({
        databaseUrl: fixture.databaseUrl,
        userId: mgr.id,
        employeeId: emp,
        confirmedByUserId: mgr.id,
      });
      const client = await pool.connect();
      try {
        await ensurePartyForUserOnWrite(client, mgr.id, "Browser Mgr", "+79997778801");
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
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

  it("technical admin sees create entry and no read-only banner (desktop + mobile)", async () => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 375, height: 740 },
    ]) {
      const context = await fixture.browser.newContext({ viewport, baseURL: fixture.baseUrl });
      const page = await context.newPage();
      await login(page, "tt-browser-admin@test.local");
      await page.goto("/tan-tracker");
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
      assert.equal(await page.locator('[data-tt="lk-readonly-banner"]').count(), 0);
      if (viewport.width >= 1280) {
        await page.waitForSelector('[data-tt="create"]', { timeout: 15000 });
      } else {
        await page.waitForSelector('[data-tt="create-fab"]', { timeout: 15000, state: "visible" });
      }
      await context.close();
    }
  });

  it("linked manager sees create entry when canWrite=true", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-mgr@test.local");
    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    assert.equal(await page.locator('[data-tt="lk-readonly-banner"]').count(), 0);
    await page.waitForSelector('[data-tt="create"]', { timeout: 15000 });
    await context.close();
  });

  it("admin opens create wizard from CTA (real HTTP bootstrap)", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-tt="create"]', { timeout: 20000 });
    await page.click('[data-tt="create"]');
    await page.waitForSelector('[data-tt="create-wizard"]', { timeout: 10000 });
    await page.waitForSelector('[data-tt-field="item"]', { timeout: 5000 });
    await context.close();
  });
});
