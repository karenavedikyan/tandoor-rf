import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { chromium, webkit, type Browser, type BrowserType } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const STAFF_EMAIL = "tt-browser-admin@test.local";

async function launchRequired(engine: BrowserType<Browser>, t: { skip: (message?: string) => void }) {
  try {
    if (engine === chromium) {
      return await chromium.launch({ headless: true, channel: "chromium" });
    }
    return await webkit.launch({ headless: true });
  } catch (err) {
    t.skip(`${engine.name()} required for acceptance: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loginStaff(page: import("playwright").Page, fixture: BrowserHttpFixture) {
  await page.goto(`${fixture.baseUrl}/login`);
  await page.fill("#email", STAFF_EMAIL);
  await page.fill("#password", fixture.password);
  await page.click("#login-button");
  await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
}

describe("staff pending recipient gen-code in LK", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/staff-gen-code-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 1 });
    const staffId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [STAFF_EMAIL])
    ).rows[0]!.id;
    const client = await pool.connect();
    try {
      const staffParty = await ensurePartyForUserOnWrite(client, staffId!, "Browser Admin", null);
      const extParty = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Ext creator', '+79991234999') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ('tt-staff-gen-1','STAFFGEN1','From client','waiting',TRUE,$1,$1,$2,$2,1,1)`,
        [extParty, staffParty.id],
      );
    } finally {
      client.release();
      await pool.end();
    }
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  async function run(browser: Browser, label: string) {
    const context = await browser.newContext({ baseURL: fixture.baseUrl, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    try {
      await loginStaff(page, fixture);
      await page.goto("/tan-tracker");
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
      await page.locator('[data-tt-open="STAFFGEN1"]').first().click();
      await page.waitForSelector('[data-tt="gen-code"]', { timeout: 15000 });
      const resp = page.waitForResponse(
        (r) => r.url().includes("/code/generate") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="gen-code"]');
      assert.equal((await resp).status(), 200, `${label}: generate must succeed`);
      await page.waitForSelector('[data-tt="shown-code"]', { timeout: 15000 });
    } finally {
      await context.close();
    }
  }

  it("shows gen-code for fromExternal pending staff (Chromium)", async () => {
    await run(fixture.browser, "chromium");
  });

  it("does not show gen-code for non-recipient staff (Chromium)", async () => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${fixture.baseUrl}/login`);
      await page.fill("#email", "tt-browser-fresh@test.local");
      await page.fill("#password", fixture.password);
      await page.click("#login-button");
      await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
      await page.goto("/tan-tracker");
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
      assert.equal(await page.locator('[data-tt="gen-code"]').count(), 0);
      assert.equal(await page.locator('[data-tt-open="STAFFGEN1"]').count(), 0);
    } finally {
      await context.close();
    }
  });

  it("shows gen-code for fromExternal pending staff (WebKit)", async (t) => {
    const browser = await launchRequired(webkit, t);
    if (!browser) return;
    try {
      await run(browser, "webkit");
    } finally {
      await browser.close();
    }
  });
});
