import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { Pool } from "pg";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
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

  it("technical admin can batch-delete legacy-audit track via canAdminDeleteTransfer", async () => {
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 1 });
    const adminId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "tt-browser-admin@test.local",
      ])
    ).rows[0]!.id;
    const client = await pool.connect();
    const code = "BRLEG1";
    try {
      const party = await ensurePartyForUserOnWrite(client, adminId!, "Browser Admin", null);
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          handoff_version, row_version, first_custody_at)
         VALUES ('tt-br-leg-1', $1, 'Browser legacy audit', 'active', $2, $2, 1, 1, NOW())`,
        [code, party.id],
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ('tt-br-leg-1', $1::uuid, $2, 'code_verify_ok', '{}'::jsonb)`,
        [adminId, party.id],
      );
    } finally {
      client.release();
      await pool.end();
    }
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    await page.locator('[data-tt="registry-select-all"]').click({ force: true });
    const deleteBtn = page.locator('[data-tt="registry-batch"][data-mode="delete"]');
    await deleteBtn.waitFor({ state: "visible" });
    assert.equal(await deleteBtn.isDisabled(), false);
    assert.equal(await deleteBtn.locator(".tt-selbtn-count").textContent(), "1");
    await context.close();
  });

  it("manager batch delete stays disabled after receipt without server DTO", async () => {
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 1 });
    const managerId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
        "tt-browser-fresh@test.local",
      ])
    ).rows[0]!.id;
    const client = await pool.connect();
    const code = "BRMGRRCV";
    try {
      const party = await ensurePartyForUserOnWrite(client, managerId!, "Browser Fresh", null);
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          handoff_version, row_version, first_custody_at)
         VALUES ('tt-br-mgr-rcv', $1, 'Manager received', 'active', $2, $2, 1, 1, NOW())`,
        [code, party.id],
      );
    } finally {
      client.release();
      await pool.end();
    }
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-fresh@test.local");
    await page.goto("/tan-tracker");
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    await page.locator('[data-tt="registry-select-all"]').click({ force: true });
    const deleteBtn = page.locator('[data-tt="registry-batch"][data-mode="delete"]');
    await deleteBtn.waitFor({ state: "visible" });
    assert.equal(await deleteBtn.isDisabled(), true);
    assert.equal(await deleteBtn.locator(".tt-selbtn-count").textContent(), "0");
    await context.close();
  });

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
