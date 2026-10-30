import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { chromium, devices, webkit, type Browser, type BrowserType, type Page } from "playwright";
import {
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser } from "../helpers/test-db";

const FIXTURE_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-admin-wizard.png");
const IPHONE_13 = devices["iPhone 13"];
const STAFF_EMAIL = "ext-shell-staff@test.local";
const DIAG_DIR = path.join(process.cwd(), "var/browser-diagnostics");

type ExtFixture = BrowserHttpFixture & { estToken?: string };

async function saveBrowserDiagnostic(page: Page, label: string): Promise<string> {
  await mkdir(DIAG_DIR, { recursive: true });
  const file = path.join(DIAG_DIR, `tan-tracker-external-shell-${label}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const meta = path.join(DIAG_DIR, `tan-tracker-external-shell-${label}-${Date.now()}.url.txt`);
  await writeFile(meta, page.url(), "utf8");
  return file;
}

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

async function loginStaff(page: Page, fixture: BrowserHttpFixture) {
  await page.goto(`${fixture.baseUrl}/login`);
  await page.fill("#email", STAFF_EMAIL);
  await page.fill("#password", fixture.password);
  await page.click("#login-button");
  await page.waitForURL(/\/(clients|profile|work|access|admin|tan-tracker)(\/|\?|$)/, { timeout: 25000 });
}

async function runExternalRequestWizard(page: Page, baseUrl: string, est: string): Promise<string> {
  await page.goto(`${baseUrl}/tan-tracker?est=${encodeURIComponent(est)}`);
  await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 30000 });
  try {
    await page.waitForSelector('[data-tt="external-bar"]', { timeout: 15000 });
    await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 15000 });
  } catch (err) {
    const shot = await saveBrowserDiagnostic(page, "missing-ext-request-open");
    throw new Error(
      `${err instanceof Error ? err.message : String(err)} (diagnostic screenshot: ${shot})`,
    );
  }
  await page.click('[data-tt="ext-request-open"]');
  await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });

  await page.fill('[data-tt-field="extItem"]', "Browser E2E parcel");
  const draftItem = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.click('[data-tt="ext-request-next"]');
  assert.equal((await draftItem).status(), 200);

  await page.waitForSelector('[data-tt="ext-photo-input"]', { timeout: 10000 });
  const photoUp = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.locator('[data-tt="ext-photo-input"]').setInputFiles(FIXTURE_PNG);
  assert.equal((await photoUp).status(), 201);
  await page.click('[data-tt="ext-request-next"]');

  await page.waitForSelector('[data-tt-field="extComment"]', { timeout: 10000 });
  await page.fill('[data-tt-field="extComment"]', "Handle with care");
  const draftComment = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.click('[data-tt="ext-request-next"]');
  assert.equal((await draftComment).status(), 200);

  await page.waitForSelector('[data-tt="ext-pick-recipient"]', { timeout: 15000 });
  await page.locator('[data-tt="ext-pick-recipient"]').filter({ hasText: "Shell Staff" }).first().click();
  const draftRecipient = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.click('[data-tt="ext-request-next"]');
  assert.equal((await draftRecipient).status(), 200);

  await page.waitForSelector('[data-tt="ext-due-tomorrow"]', { timeout: 10000 });
  await page.click('[data-tt="ext-due-tomorrow"]');
  const draftDue = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.click('[data-tt="ext-request-next"]');
  assert.equal((await draftDue).status(), 200);

  const confirmReq = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/confirm") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.click('[data-tt="ext-request-next"]');
  const confirmResp = await confirmReq;
  assert.equal(confirmResp.status(), 200);
  const confirmJson = (await confirmResp.json()) as { publicCode?: string };
  assert.ok(confirmJson.publicCode);
  await page.waitForSelector('[data-tt="ext-request-open-order"]', { timeout: 15000 });
  return confirmJson.publicCode!;
}

describe("external person tan-tracker shell (browser)", { concurrency: false }, () => {
  let fixture: ExtFixture;

  before(async () => {
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-ext-person-browser",
      extraEnv: {
        TT_OTP_PEPPER: "test-otp-pepper-min-16-chars",
        TT_EXTERNAL_MESSENGER_ENABLED: "true",
      },
    });
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
    const staff = await createTestUser({
      databaseUrl: fixture.databaseUrl,
      email: STAFF_EMAIL,
      password: fixture.password,
      fullName: "Shell Staff",
      role: "manager",
    });
    await pool.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
    const staffParty = await ensurePartyForUserOnWrite(pool, staff.id, "Shell Staff", "+79991234001");
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Shell Ext', '+79991234002') RETURNING id::text`,
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version)
       VALUES ('EXTSHELL1','EXTSHELL1','seed','completed',TRUE,$1,$2,$2,$2,1)`,
      [extParty, staffParty.id],
    );
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991234002', 'Shell Ext', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', '880001', '880001')`,
      [person],
    );
    const client = await pool.connect();
    let est = "";
    try {
      est = await createPersonBrowserSession(client, person, "telegram");
    } finally {
      client.release();
      await pool.end();
    }
    fixture.estToken = est;
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  it("6-step ext-request wizard, detail, staff attachment download (Chromium)", async () => {
    const est = fixture.estToken;
    assert.ok(est);
    const pngBytes = await readFile(FIXTURE_PNG);
    const page = await fixture.browser.newPage();
    try {
      const publicCode = await runExternalRequestWizard(page, fixture.baseUrl, est);
      await page.click('[data-tt="ext-request-open-order"]');
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 15000 });
      await page.waitForFunction(
        (code) => {
          const proto = (window as unknown as { TanTrackerPrototype?: { state?: { orderId?: string } } }).TanTrackerPrototype;
          return proto?.state?.orderId === code;
        },
        publicCode,
        { timeout: 10000 },
      );

      const staffPage = await fixture.browser.newPage();
      try {
        await loginStaff(staffPage, fixture);
        await staffPage.goto(`${fixture.baseUrl}/tan-tracker`);
        await staffPage.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
        await staffPage.locator(`[data-tt="open-order"][data-order-id="${publicCode}"]`).first().click();
        await staffPage.waitForSelector('[data-testid="tan-tracker"]', { timeout: 15000 });
        const attachments = staffPage.locator("details").filter({ has: staffPage.locator('[data-tt="attach-download"]') });
        if ((await attachments.getAttribute("open")) === null) {
          await attachments.locator("summary").first().click();
        }
        const downloadHref = await staffPage.locator('[data-tt="attach-download"]').first().getAttribute("href");
        assert.ok(downloadHref);
        const downloadResponse = await staffPage.request.get(`${fixture.baseUrl}${downloadHref}`);
        assert.equal(downloadResponse.status(), 200);
        assert.ok(Buffer.from(await downloadResponse.body()).equals(pngBytes));
      } finally {
        await staffPage.close();
      }
    } catch (err) {
      const shot = await saveBrowserDiagnostic(page, "chromium-wizard-failure");
      throw new Error(
        `${err instanceof Error ? err.message : String(err)} (diagnostic screenshot: ${shot})`,
      );
    } finally {
      await page.close();
    }
  });

  it("6-step ext-request wizard (WebKit iPhone 13)", async (t) => {
    const est = fixture.estToken;
    assert.ok(est);
    const browser = await launchRequired(webkit, t);
    const context = await browser!.newContext({ ...IPHONE_13, baseURL: fixture.baseUrl });
    let page: Page | undefined;
    try {
      page = await context.newPage();
      const publicCode = await runExternalRequestWizard(page, fixture.baseUrl, est);
      assert.ok(publicCode.length >= 4);
      await page.click('[data-tt="ext-request-open-order"]');
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 15000 });
    } catch (err) {
      if (page) {
        const shot = await saveBrowserDiagnostic(page, "webkit-wizard-failure");
        throw new Error(
          `${err instanceof Error ? err.message : String(err)} (diagnostic screenshot: ${shot})`,
        );
      }
      throw err;
    } finally {
      await context.close();
      await browser!.close();
    }
  });
});
