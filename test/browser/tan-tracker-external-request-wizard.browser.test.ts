import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
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

const FIXTURE_A = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-admin-wizard.png");
const FIXTURE_B = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-external-photo-b.png");
const STAFF_EMAIL = "ext-wizard-staff@test.local";

type ExtFixture = BrowserHttpFixture & { estToken?: string; personId?: string };

async function openExternalHome(page: Page, baseUrl: string, est: string): Promise<void> {
  await page.goto(`${baseUrl}/tan-tracker?est=${encodeURIComponent(est)}`);
  await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 30000 });
  await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 15000 });
}

async function startWizardItemStep(page: Page): Promise<void> {
  await page.click('[data-tt="ext-request-open"]');
  await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });
  await page.fill('[data-tt-field="extItem"]', "Wizard photo E2E");
  const draftItem = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.click('[data-tt="ext-request-next"]');
  assert.equal((await draftItem).status(), 200);
  await page.waitForSelector('[data-tt="ext-photo-add"]', { timeout: 10000 });
}

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

async function runWizardPhotoCommentScenario(page: Page, baseUrl: string, est: string): Promise<void> {
  await openExternalHome(page, baseUrl, est);
  await startWizardItemStep(page);

  const nextBtn = page.locator('[data-tt="ext-request-next"]');
  assert.equal(await nextBtn.textContent(), "Пропустить");

  const photoUp1 = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.locator('[data-tt="ext-photo-input"]').setInputFiles(FIXTURE_A);
  assert.equal((await photoUp1).status(), 201);
  await page.waitForSelector('.tt-ext-photo--ok img', { timeout: 15000 });
  assert.equal(await nextBtn.textContent(), "Далее");

  const photoUp2 = page.waitForResponse(
    (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.locator('[data-tt="ext-photo-input"]').setInputFiles(FIXTURE_B);
  assert.equal((await photoUp2).status(), 201);
  await page.waitForSelector('.tt-ext-photo--ok img >> nth=1', { timeout: 15000 });

  await page.click('[data-tt="ext-request-next"]');
  await page.waitForSelector('[data-tt-field="extComment"]', { timeout: 10000 });
  assert.equal(await nextBtn.textContent(), "Пропустить");

  await page.fill('[data-tt-field="extComment"]', "Need box");
  assert.equal(await nextBtn.textContent(), "Далее");

  await page.fill('[data-tt-field="extComment"]', "   ");
  assert.equal(await nextBtn.textContent(), "Пропустить");

  await page.fill('[data-tt-field="extComment"]', "Final note");
  await page.click('[data-tt="ext-request-back"]');
  await page.waitForSelector('[data-tt="ext-photo-add"]', { timeout: 10000 });
  const okCount = await page.locator(".tt-ext-photo--ok").count();
  assert.equal(okCount, 2);

  await page.click('[data-tt="ext-request-next"]');
  await page.waitForSelector('[data-tt-field="extComment"]', { timeout: 10000 });
  const cmtVal = await page.inputValue('[data-tt-field="extComment"]');
  assert.equal(cmtVal, "Final note");

  await page.click('[data-tt="ext-request-next"]');
  await page.waitForSelector('[data-tt="ext-pick-recipient"]', { timeout: 15000 });
  await page.locator('[data-tt="ext-pick-recipient"]').filter({ hasText: "Wizard Staff" }).first().click();
  await page.click('[data-tt="ext-request-next"]');
  await page.waitForSelector('[data-tt="ext-due-today"]', { timeout: 10000 });
  await page.click('[data-tt="ext-request-next"]');
  await page.waitForSelector(".tt-ext-chat-summary", { timeout: 15000 });

  const summaryPhotos = page.locator(".tt-ext-summary-photos-dd .tt-ext-photo--ok img");
  assert.equal(await summaryPhotos.count(), 2);

  await summaryPhotos.first().click();
  await page.waitForSelector('[data-tt="ext-photo-viewer"]', { timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-tt="ext-photo-viewer"]', { state: "detached", timeout: 5000 });
}

describe("external request wizard photo + comment UX (browser)", { concurrency: false }, () => {
  let fixture: ExtFixture;

  before(async () => {
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-ext-wizard-browser",
      extraEnv: { TT_OTP_PEPPER: "test-otp-pepper-min-16-chars" },
    });
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
    const staff = await createTestUser({
      databaseUrl: fixture.databaseUrl,
      email: STAFF_EMAIL,
      password: fixture.password,
      fullName: "Wizard Staff",
      role: "manager",
    });
    await pool.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Wizard Staff", "+79991234098");
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Wizard Ext', '+79991234099') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991234099', 'Wizard Ext', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', '880099', '880099')`,
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
    fixture.personId = person;
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  for (const engine of [chromium, webkit] as const) {
    for (const mobile of [false, true] as const) {
      const label = `${engine.name()}${mobile ? " mobile" : " desktop"}`;
      it(`photos, comment labels, summary viewer (${label})`, async (t) => {
        const browser = await launchRequired(engine, t);
        assert.ok(browser);
        const est = fixture.estToken;
        assert.ok(est);
        const context = mobile
          ? await browser.newContext({ ...devices["iPhone 13"], baseURL: fixture.baseUrl })
          : await browser.newContext({ baseURL: fixture.baseUrl, viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        try {
          await runWizardPhotoCommentScenario(page, fixture.baseUrl, est);
        } finally {
          await context.close();
          await browser.close();
        }
      });
    }
  }

  it("failed upload retry and pending lock (Chromium)", async (t) => {
    const browser = await launchRequired(chromium, t);
    assert.ok(browser);
    const est = fixture.estToken!;
    const page = await browser.newPage();
    let failRemaining = 1;
    await page.route("**/api/tan-tracker/public/external/request/photo?*", async (route) => {
      if (failRemaining > 0 && route.request().method() === "POST") {
        failRemaining -= 1;
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Не удалось загрузить фото." } }),
        });
        return;
      }
      await route.continue();
    });
    try {
      await openExternalHome(page, fixture.baseUrl, est);
      await startWizardItemStep(page);
      const nextBtn = page.locator('[data-tt="ext-request-next"]');
      const firstUp = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.locator('[data-tt="ext-photo-input"]').setInputFiles(FIXTURE_A);
      assert.equal((await firstUp).status(), 400);
      await page.waitForSelector(".tt-ext-photo--err", { timeout: 15000 });
      const retryUp = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-photo-retry"]');
      assert.equal((await retryUp).status(), 201);
      await page.waitForSelector(".tt-ext-photo--ok", { timeout: 20000 });
      assert.equal(await nextBtn.textContent(), "Далее");
      assert.equal(await nextBtn.getAttribute("disabled"), null);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it("cancel during upload ignores stale success (Chromium)", async (t) => {
    const browser = await launchRequired(chromium, t);
    assert.ok(browser);
    const est = fixture.estToken!;
    const page = await browser.newPage();
    let releaseDelay: (() => void) | null = null;
    const delayGate = new Promise<void>((resolve) => {
      releaseDelay = resolve;
    });
    let holdPhoto = true;
    await page.route("**/api/tan-tracker/public/external/request/photo?*", async (route) => {
      if (holdPhoto && route.request().method() === "POST") {
        holdPhoto = false;
        await delayGate;
      }
      await route.continue();
    });
    try {
      await openExternalHome(page, fixture.baseUrl, est);
      await startWizardItemStep(page);
      void page.locator('[data-tt="ext-photo-input"]').setInputFiles(FIXTURE_A);
      await page.waitForSelector(".tt-ext-photo--pending", { timeout: 5000 });
      await page.click('[data-tt="ext-request-close"]');
      await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 10000 });
      releaseDelay!();
      await page
        .waitForResponse(
          (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
          { timeout: 30000 },
        )
        .catch(() => null);
      const staleOk = await page.locator(".tt-ext-photo--ok").count();
      assert.equal(staleOk, 0);
    } finally {
      releaseDelay?.();
      await page.close();
      await browser.close();
    }
  });

  it("cancel then new request confirms only new photo bytes (Chromium)", async (t) => {
    const browser = await launchRequired(chromium, t);
    assert.ok(browser);
    const est = fixture.estToken!;
    const bytesB = await readFile(FIXTURE_B);
    const page = await browser.newPage();
    let releaseStaleUpload: (() => void) | null = null;
    const staleUploadGate = new Promise<void>((resolve) => {
      releaseStaleUpload = resolve;
    });
    let holdFirstPhotoPost = true;
    await page.route("**/api/tan-tracker/public/external/request/photo?*", async (route) => {
      if (holdFirstPhotoPost && route.request().method() === "POST") {
        holdFirstPhotoPost = false;
        await staleUploadGate;
      }
      await route.continue();
    });
    try {
      await openExternalHome(page, fixture.baseUrl, est);
      await startWizardItemStep(page);
      void page.locator('[data-tt="ext-photo-input"]').setInputFiles(FIXTURE_A);
      await page.waitForSelector(".tt-ext-photo--pending", { timeout: 5000 });
      await page.click('[data-tt="ext-request-close"]');
      await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 10000 });

      await page.click('[data-tt="ext-request-open"]');
      await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });
      await page.fill('[data-tt-field="extItem"]', "Fresh after cancel");
      const freshDraft = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      assert.equal((await freshDraft).status(), 200);

      const stalePhoto = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      releaseStaleUpload!();
      const staleStatus = (await stalePhoto).status();
      assert.ok(staleStatus === 404 || staleStatus === 409);

      const photoUp = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/photo") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.locator('[data-tt="ext-photo-input"]').setInputFiles(FIXTURE_B);
      assert.equal((await photoUp).status(), 201);
      await page.waitForSelector(".tt-ext-photo--ok", { timeout: 20000 });

      await page.click('[data-tt="ext-request-next"]');
      await page.waitForSelector('[data-tt-field="extComment"]', { timeout: 10000 });
      const draftAfterComment = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      assert.equal((await draftAfterComment).status(), 200);
      await page.waitForSelector('[data-tt="ext-pick-recipient"]', { timeout: 15000 });
      await page.locator('[data-tt="ext-pick-recipient"]').filter({ hasText: "Wizard Staff" }).first().waitFor({ timeout: 15000 });
      await page.locator('[data-tt="ext-pick-recipient"]').filter({ hasText: "Wizard Staff" }).first().click();
      const draftAfterRecipient = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      assert.equal((await draftAfterRecipient).status(), 200);
      await page.waitForSelector('[data-tt="ext-due-today"]', { timeout: 10000 });
      const draftAfterDue = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      assert.equal((await draftAfterDue).status(), 200);
      await page.waitForSelector(".tt-ext-chat-summary", { timeout: 15000 });
      const formState = await page.evaluate(() => {
        const f = (window as unknown as { TanTrackerPrototype?: { state?: { extRequestForm?: { draftId?: string; recipientUserId?: string; item?: string } } } })
          .TanTrackerPrototype?.state?.extRequestForm;
        return { draftId: f?.draftId || "", recipientUserId: f?.recipientUserId || "", item: f?.item || "" };
      });
      assert.ok(formState.recipientUserId, "recipientUserId must be set before confirm");
      assert.ok(formState.draftId);
      const poolPre = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
      try {
        const fileCount = await poolPre.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
          [formState.draftId],
        );
        assert.equal(fileCount.rows[0]?.c, 1, "draft must contain exactly one photo after fresh start");
      } finally {
        await poolPre.end();
      }
      const confirmReq = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/confirm") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      const confirmResp = await confirmReq;
      if (confirmResp.status() !== 200) {
        const errBody = await confirmResp.text();
        assert.fail(`confirm failed ${confirmResp.status()}: ${errBody}`);
      }
      const confirmJson = (await confirmResp.json()) as { publicCode?: string };
      assert.ok(confirmJson.publicCode);

      const pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
      try {
        const att = await pool.query<{ byte_size: string; storage_key: string }>(
          `SELECT byte_size::text, storage_key FROM tt_transfer_attachments WHERE transfer_id = $1 ORDER BY created_at`,
          [confirmJson.publicCode],
        );
        assert.equal(att.rowCount, 1);
        assert.equal(Number(att.rows[0]!.byte_size), bytesB.length);
        const blob = await pool.query<{ content: Buffer }>(
          `SELECT content FROM tt_attachment_blobs WHERE storage_key = $1`,
          [att.rows[0]!.storage_key],
        );
        assert.ok(blob.rows[0]?.content.equals(bytesB));
      } finally {
        await pool.end();
      }
    } finally {
      releaseStaleUpload?.();
      await page.close();
      await browser.close();
    }
  });

  it("delayed stale payload save cannot overwrite new draft (Chromium)", async (t) => {
    const browser = await launchRequired(chromium, t);
    assert.ok(browser);
    const est = fixture.estToken!;
    const page = await browser.newPage();
    let releaseStaleSave: (() => void) | null = null;
    const staleSaveGate = new Promise<void>((resolve) => {
      releaseStaleSave = resolve;
    });
    let holdStalePhotoSave = true;
    await page.route("**/api/tan-tracker/public/external/request/draft", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      let body: { step?: string; payload?: { item?: string }; startFresh?: boolean } = {};
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch (_e) {
        body = {};
      }
      if (holdStalePhotoSave && body.step === "photo" && body.payload?.item === "OLD_ITEM") {
        holdStalePhotoSave = false;
        await staleSaveGate;
      }
      await route.continue();
    });
    try {
      await openExternalHome(page, fixture.baseUrl, est);
      await page.click('[data-tt="ext-request-open"]');
      await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });
      await page.fill('[data-tt-field="extItem"]', "OLD_ITEM");
      const staleReq = page.waitForRequest(
        (r) => {
          if (!r.url().includes("/api/tan-tracker/public/external/request/draft") || r.method() !== "POST") {
            return false;
          }
          try {
            const body = JSON.parse(r.postData() || "{}") as { step?: string; payload?: { item?: string } };
            return body.step === "photo" && body.payload?.item === "OLD_ITEM";
          } catch (_e) {
            return false;
          }
        },
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      await staleReq;
      await page.click('[data-tt="ext-request-close"]');
      await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 10000 });

      await page.click('[data-tt="ext-request-open"]');
      await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });
      await page.fill('[data-tt-field="extItem"]', "NEW_ITEM");
      const freshDraft = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      assert.equal((await freshDraft).status(), 200);
      await page.waitForSelector('[data-tt="ext-photo-add"]', { timeout: 15000 });

      const staleResp = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      releaseStaleSave!();
      const staleStatus = (await staleResp).status();
      assert.ok(staleStatus === 404 || staleStatus === 409);

      const formItem = await page.evaluate(() => {
        const f = (window as unknown as { TanTrackerPrototype?: { state?: { extRequestForm?: { item?: string } } } })
          .TanTrackerPrototype?.state?.extRequestForm;
        return f?.item || "";
      });
      assert.equal(formItem, "NEW_ITEM");
      assert.equal(await page.locator('[data-tt-field="extItem"]').count(), 0);

      const pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
      try {
        const row = await pool.query<{ item: string; c: number }>(
          `SELECT payload->>'item' AS item, COUNT(*) OVER()::int AS c
           FROM tt_external_request_drafts
           WHERE person_id = $1::uuid AND confirmed_transfer_id IS NULL`,
          [fixture.personId],
        );
        assert.equal(row.rows[0]?.c, 1);
        assert.equal(row.rows[0]?.item, "NEW_ITEM");
      } finally {
        await pool.end();
      }
    } finally {
      releaseStaleSave?.();
      await page.close();
      await browser.close();
    }
  });

  it("delayed startFresh from canceled flow leaves one active draft (Chromium)", async (t) => {
    const browser = await launchRequired(chromium, t);
    assert.ok(browser);
    const est = fixture.estToken!;
    const page = await browser.newPage();
    let releaseStartFresh: (() => void) | null = null;
    const startFreshGate = new Promise<void>((resolve) => {
      releaseStartFresh = resolve;
    });
    let holdStartFresh = true;
    await page.route("**/api/tan-tracker/public/external/request/draft", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      let body: { startFresh?: boolean } = {};
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch (_e) {
        body = {};
      }
      if (holdStartFresh && body.startFresh === true) {
        holdStartFresh = false;
        await startFreshGate;
      }
      await route.continue();
    });
    try {
      await openExternalHome(page, fixture.baseUrl, est);
      await page.click('[data-tt="ext-request-open"]');
      await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });
      await page.fill('[data-tt-field="extItem"]', "FIRST_FLOW");
      void page.click('[data-tt="ext-request-next"]');
      await page.click('[data-tt="ext-request-close"]');
      await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 10000 });

      await page.click('[data-tt="ext-request-open"]');
      await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });
      await page.fill('[data-tt-field="extItem"]', "SECOND_FLOW");
      const secondStart = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      void page.click('[data-tt="ext-request-next"]');
      releaseStartFresh!();
      assert.equal((await secondStart).status(), 200);
      await page.waitForSelector('[data-tt="ext-photo-add"]', { timeout: 15000 });

      const draftId = await page.evaluate(() => {
        return (
          (window as unknown as { TanTrackerPrototype?: { state?: { extRequestForm?: { draftId?: string } } } })
            .TanTrackerPrototype?.state?.extRequestForm?.draftId || ""
        );
      });
      assert.ok(draftId);

      const pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
      try {
        const rows = await pool.query<{ id: string; item: string }>(
          `SELECT id::text, payload->>'item' AS item FROM tt_external_request_drafts
           WHERE person_id = $1::uuid AND confirmed_transfer_id IS NULL`,
          [fixture.personId],
        );
        assert.equal(rows.rowCount, 1);
        assert.equal(rows.rows[0]!.id, draftId);
        assert.equal(rows.rows[0]!.item, "SECOND_FLOW");
      } finally {
        await pool.end();
      }
    } finally {
      releaseStartFresh?.();
      await page.close();
      await browser.close();
    }
  });
});
