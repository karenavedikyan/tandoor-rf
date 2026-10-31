import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { webkit, type Browser, type Page } from "playwright";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { hashOtp } from "../../src/tan-tracker/phone-verification";
import {
  seedTanTrackerBrowserUsers, startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { tanTrackerLkDetailPath } from "./helpers/tan-tracker-routes";

const pepper = "independent-paste-otp-pepper-min16";
const code = "012345";
let fixture: BrowserHttpFixture;
let pool: Pool;

async function paste(page: Page, text: string, nativeClipboard: boolean) {
  await page.locator('[data-tt="code-input"]').focus();
  if (nativeClipboard) {
    await page.evaluate(value => navigator.clipboard.writeText(value), text);
    await page.keyboard.press("Control+V");
  } else {
    // WebKit does not expose Chromium's clipboard permissions in Playwright.
    // Exercise its actual DOM paste handler without bypassing the application parser.
    await page.locator('[data-tt="code-input"]').evaluate((element, value) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    }, text);
  }
}

describe("independent whole-message handoff code paste with canonical acceptance", { concurrency: false }, () => {
  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/independent-code-paste",
      extraEnv: { TT_OTP_PEPPER: pepper, TANBOT_MAX_ENABLED: "false" },
    });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
    pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
  });
  after(async () => {
    await pool?.end();
    if (fixture) await stopBrowserHttpFixture(fixture);
  });

  for (const engine of ["chromium", "webkit"] as const) {
    it(`${engine}: paste complete message preserves leading zero, never auto-submits, then receives once`, async () => {
      const browser: Browser = engine === "chromium" ? fixture.browser : await webkit.launch({ headless: true });
      const context = await browser.newContext({
        baseURL: fixture.baseUrl, viewport: { width: engine === "webkit" ? 390 : 1280, height: 780 },
        ...(engine === "chromium" ? { permissions: ["clipboard-read", "clipboard-write"] } : {}),
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      let verifyRequests = 0;
      page.on("pageerror", error => pageErrors.push(error.message));
      page.on("request", req => {
        if (req.method() === "POST" && req.url().includes("/code/verify")) verifyRequests++;
      });
      const transferId = randomUUID();
      const publicCode = engine === "chromium" ? "TT-2026-901" : "TT-2026-902";
      try {
        const users = (await pool.query(`SELECT id,email,full_name FROM users
          WHERE email IN ('tt-browser-admin@test.local','tt-browser-fresh@test.local')`)).rows;
        const admin = users.find(u => u.email === "tt-browser-admin@test.local")!;
        const recipient = users.find(u => u.email === "tt-browser-fresh@test.local")!;
        const from = await ensurePartyForUserOnWrite(pool, admin.id, admin.full_name, null);
        const to = await ensurePartyForUserOnWrite(pool, recipient.id, recipient.full_name, null);
        await pool.query(`INSERT INTO tt_transfers
          (id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,
           final_recipient_party_id,handoff_version,row_version)
          VALUES($1,$2,'Synthetic clipboard package','waiting',$3,$3,$4,$4,1,1)`,
          [transferId, publicCode, from.id, to.id]);
        await pool.query(`INSERT INTO tt_handoff_codes
          (transfer_id,handoff_version,pending_party_id,code_hash,expires_at,verify_attempt_count)
          VALUES($1,1,$2,$3,NOW()+INTERVAL '20 minutes',0)`, [transferId, to.id, hashOtp(code, pepper)]);

        await page.goto("/login");
        await page.fill("#email", "tt-browser-admin@test.local");
        await page.fill("#password", fixture.password);
        await page.click("#login-button");
        await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/, { timeout: 25000 });
        await page.waitForLoadState("networkidle");
        // The clients page has an unrelated existing WebKit navigation abort; capture tracker errors only.
        pageErrors.length = 0;
        await page.goto(tanTrackerLkDetailPath(publicCode));
        await page.waitForSelector('[data-tt="detail"]', { timeout: 25000 });
        const enter = page.locator('[data-tt="enter-code"]:visible,[data-tt="enter-code-dock"]:visible').first();
        await enter.click();
        const input = page.locator('[data-tt="code-input"]');
        await input.waitFor();
        await input.pressSequentially("123");
        assert.equal(await input.inputValue(), "123");
        assert.equal((await page.locator(".tt-code-cell").allTextContents()).join(""), "123",
          "ordinary digit typing must still update the six visible cells");
        await input.fill("");

        await paste(page, `Код для передачи ${publicCode}: ${code}\nСообщите его держателю лично. Действует 10 минут.`, engine === "chromium");
        assert.equal(await input.inputValue(), code, "full copied text must not turn track/year/TTL digits into the OTP");
        assert.equal((await page.locator(".tt-code-cell").allTextContents()).join(""), code);
        assert.equal(verifyRequests, 0, "paste must never accept the transfer automatically");
        const before = (await pool.query("SELECT holder_party_id,handoff_version FROM tt_transfers WHERE id=$1", [transferId])).rows[0];
        assert.equal(before.holder_party_id, from.id);
        assert.equal(before.handoff_version, 1);

        await page.keyboard.press("Home");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await paste(page, "0 1 2 3 4 5", engine === "chromium");
        assert.equal(await input.inputValue(), code, "paste in a later cell still replaces the complete code");
        await paste(page, "Код: 111111. Второй код: 222222.", engine === "chromium");
        assert.equal(verifyRequests, 0, "ambiguous text must never trigger verification");
        assert.equal(await input.inputValue(), code, "invalid paste must not erase the current good value");
        await input.evaluate(element => (element as HTMLInputElement).setSelectionRange(2, 2));
        await paste(page, "654321", engine === "chromium");
        assert.equal(await input.inputValue(), "654321", "exact six-digit paste replaces the whole code even at a middle caret");
        await paste(page, code, engine === "chromium");
        assert.equal(await input.inputValue(), code);

        const qaDir = path.join(process.cwd(), "var/independent-code-paste-qa");
        await mkdir(qaDir, { recursive: true });
        await page.screenshot({ path: path.join(qaDir, `${engine}-six-digits.png`), fullPage: true });
        const verification = page.waitForResponse(r => r.request().method() === "POST" && r.url().includes("/code/verify"));
        await page.locator('[data-tt="confirm-code"]').click();
        assert.equal((await verification).status(), 200);
        assert.equal(verifyRequests, 1);
        const after = (await pool.query("SELECT holder_party_id,handoff_version FROM tt_transfers WHERE id=$1", [transferId])).rows[0];
        assert.equal(after.holder_party_id, to.id);
        assert.equal(after.handoff_version, 2);
        assert.deepEqual(pageErrors, []);
      } finally {
        await context.close();
        if (engine !== "chromium") await browser.close();
      }
    });
  }
});
