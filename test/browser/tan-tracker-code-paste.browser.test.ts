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
    t.skip(`${engine.name()} required: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loginStaff(page: import("playwright").Page, fixture: BrowserHttpFixture) {
  await page.goto(`${fixture.baseUrl}/login`);
  await page.fill("#email", STAFF_EMAIL);
  await page.fill("#password", fixture.password);
  await page.click("#login-button");
  await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
}

describe("handoff code paste in LK (browser)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/code-paste-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 1 });
    const staffId = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [STAFF_EMAIL])).rows[0]!
      .id;
    const client = await pool.connect();
    try {
      const staffParty = await ensurePartyForUserOnWrite(client, staffId!, "Browser Admin", null);
      const freshId = (
        await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = 'tt-browser-fresh@test.local'`)
      ).rows[0]!.id;
      const freshParty = await ensurePartyForUserOnWrite(client, freshId!, "Browser Fresh Recipient", null);
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ('tt-paste-1','PASTE01','Paste box','waiting',FALSE,$1,$1,$2,$2,1,1)`,
        [staffParty.id, freshParty.id],
      );
    } finally {
      client.release();
      await pool.end();
    }
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  async function openCodeEntry(page: import("playwright").Page) {
    await loginStaff(page, fixture);
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    await page.locator('[data-tt-open="PASTE01"]').first().click();
    await page.click('[data-tt="enter-code"]');
    await page.waitForSelector('[data-tt="code-input"]', { timeout: 15000 });
  }

  async function pasteIntoCodeInput(page: import("playwright").Page, text: string) {
    await page.locator('[data-tt="code-input"]').evaluate((el, payload) => {
      const input = el as HTMLInputElement;
      const dt = new DataTransfer();
      dt.setData("text/plain", payload);
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    }, text);
  }

  it("pastes labeled messenger text (Chromium)", async () => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    try {
      await openCodeEntry(page);
      await pasteIntoCodeInput(
        page,
        "Код для передачи TT-2026-001: 012345\nСообщите его держателю.",
      );
      await page.waitForFunction(
        () => (document.querySelector('[data-tt="code-input"]') as HTMLInputElement)?.value === "012345",
        { timeout: 8000 },
      );
    } finally {
      await context.close();
    }
  });

  it("pastes labeled messenger text (WebKit)", async (t) => {
    const browser = await launchRequired(webkit, t);
    if (!browser) return;
    const context = await browser.newContext({ baseURL: fixture.baseUrl, viewport: { width: 390, height: 700 } });
    const page = await context.newPage();
    try {
      await openCodeEntry(page);
      await pasteIntoCodeInput(page, "Код: 012345");
      await page.waitForFunction(
        () => (document.querySelector('[data-tt="code-input"]') as HTMLInputElement)?.value === "012345",
        { timeout: 8000 },
      );
    } finally {
      await context.close();
      await browser.close();
    }
  });

  it("ambiguous paste keeps prior digits (Chromium)", async () => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl, viewport: { width: 390, height: 700 } });
    const page = await context.newPage();
    try {
      await openCodeEntry(page);
      await page.locator('[data-tt="code-input"]').fill("123456");
      await page.evaluate(() => {
        const input = document.querySelector('[data-tt="code-input"]') as HTMLInputElement;
        const text = "Код: 111111 и код: 222222";
        input.value = text;
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertFromPaste" }));
      });
      await page.waitForSelector('[data-tt="code-paste-error"]', { timeout: 5000 });
      assert.equal(await page.locator('[data-tt="code-input"]').inputValue(), "123456");
    } finally {
      await context.close();
    }
  });
});
