import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  chromium,
  devices,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from "playwright";
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

const VISUAL_VIEWPORTS = [
  { label: "w320", width: 320, height: 800 },
  { label: "w390", width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 900 },
] as const;

const VISUAL_THEMES = ["light", "dark"] as const;

type ExtFixture = BrowserHttpFixture & { estToken?: string };

async function saveBrowserDiagnostic(page: Page, label: string): Promise<string> {
  await mkdir(DIAG_DIR, { recursive: true });
  const file = path.join(DIAG_DIR, `tan-tracker-external-shell-${label}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const meta = path.join(DIAG_DIR, `tan-tracker-external-shell-${label}-${Date.now()}.url.txt`);
  await writeFile(meta, page.url(), "utf8");
  return file;
}

async function applyPageTheme(page: Page, theme: (typeof VISUAL_THEMES)[number]): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
  }, theme);
}

async function assertNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  assert.ok(ok, `${context}: document must not horizontal overflow`);
}

async function saveVisualAcceptanceShot(page: Page, scene: string, viewport: string, theme: string): Promise<string> {
  await mkdir(DIAG_DIR, { recursive: true });
  const file = path.join(DIAG_DIR, `ext-shell-visual-${scene}-${viewport}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function captureVisualMatrix(
  page: Page,
  scene: "registry" | "summary" | "pending-detail",
  assertReady: () => Promise<void>,
): Promise<void> {
  for (const vp of VISUAL_VIEWPORTS) {
    for (const theme of VISUAL_THEMES) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await applyPageTheme(page, theme);
      await assertReady();
      await assertNoHorizontalOverflow(page, `${scene} ${vp.label} ${theme}`);
      await saveVisualAcceptanceShot(page, scene, vp.label, theme);
    }
  }
}

async function openExternalHome(page: Page, baseUrl: string, est: string): Promise<void> {
  await page.goto(`${baseUrl}/tan-tracker?est=${encodeURIComponent(est)}`);
  await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 30000 });
  await page.waitForSelector('[data-tt="external-bar"]', { timeout: 15000 });
  await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 15000 });
}

async function advanceExternalWizardToSummary(page: Page): Promise<void> {
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
  await page.waitForSelector(".tt-ext-chat-summary", { timeout: 15000 });
  const summaryText = (await page.locator(".tt-ext-chat-summary").textContent()) || "";
  assert.match(summaryText, /Shell Staff/);
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

function redactAttachmentDownloadPath(href: string, baseUrl: string): string {
  try {
    const u = new URL(href, baseUrl);
    u.searchParams.delete("cap");
    u.searchParams.delete("est");
    u.searchParams.delete("tt_hat");
    return `${u.pathname}${u.search}`;
  } catch {
    return href
      .replace(/([?&]est=)[^&]+/gi, "$1REDACTED")
      .replace(/([?&]cap=)[^&]+/gi, "$1REDACTED");
  }
}

async function fetchAttachmentBytesViaPage(
  page: Page,
  href: string,
): Promise<{ status: number; bytes: number[] }> {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const buf = await res.arrayBuffer();
    return { status: res.status, bytes: Array.from(new Uint8Array(buf)) };
  }, href);
}

async function runExternalRequestWizard(page: Page, baseUrl: string, est: string): Promise<string> {
  try {
    await openExternalHome(page, baseUrl, est);
  } catch (err) {
    const shot = await saveBrowserDiagnostic(page, "missing-ext-request-open");
    throw new Error(
      `${err instanceof Error ? err.message : String(err)} (diagnostic screenshot: ${shot})`,
    );
  }
  await advanceExternalWizardToSummary(page);

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
  const doneText = (await page.locator('[data-tt="ext-request"]').textContent()) || "";
  assert.match(doneText, /Shell Staff/);
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

      await page.waitForSelector('[data-tt="enter-code"]', { timeout: 15000 });

      const staffContext: BrowserContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
      const staffPage = await staffContext.newPage();
      try {
        await loginStaff(staffPage, fixture);
        await staffPage.goto(`${fixture.baseUrl}/tan-tracker`);
        await staffPage.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
        const orderCard = staffPage.locator(`[data-tt-open="${publicCode}"]`).first();
        try {
          await orderCard.waitFor({ timeout: 15000 });
          await orderCard.click();
        } catch (staffListErr) {
          const staffShot = await saveBrowserDiagnostic(staffPage, "staff-registry-missing-order");
          throw new Error(
            `${staffListErr instanceof Error ? staffListErr.message : String(staffListErr)} (staff screenshot: ${staffShot})`,
          );
        }
        await staffPage.waitForSelector('[data-tt="gen-code"]', { timeout: 15000 });
        const codeResp = staffPage.waitForResponse(
          (r) => r.url().includes("/code/generate") && r.request().method() === "POST",
          { timeout: 30000 },
        );
        await staffPage.click('[data-tt="gen-code"]');
        assert.equal((await codeResp).status(), 200);
        await staffPage.waitForSelector('[data-tt="shown-code"]', { timeout: 15000 });
        const handoffCode = (await staffPage.locator('[data-tt="shown-code"]').textContent())?.trim() ?? "";
        assert.match(handoffCode, /^\d{6}$/);

        await page.click('[data-tt="enter-code"]');
        await page.waitForSelector('[data-tt="code-input"]', { timeout: 10000 });
        const verifyResp = page.waitForResponse(
          (r) => r.url().includes("/code/verify") && r.request().method() === "POST",
          { timeout: 30000 },
        );
        await page.fill('[data-tt="code-input"]', handoffCode);
        await page.click('[data-tt="confirm-code"]');
        assert.equal((await verifyResp).status(), 200);
        await page.waitForFunction(
          (code) => {
            const proto = (window as unknown as { TanTrackerPrototype?: { orders?: () => Array<{ id: string; status: string; holderId?: string }> } }).TanTrackerPrototype;
            const o = proto?.orders?.().find((x) => x.id === code);
            return o && o.status === "active";
          },
          publicCode,
          { timeout: 20000 },
        );
        await page.waitForFunction(
          () => {
            const w = window as unknown as {
              __TT_EXTERNAL_PERSON__?: boolean;
              TanTrackerPrototype?: { state?: { actingContactId?: string }; contacts?: () => Array<{ id: string; kind: string }> };
            };
            const actor = w.TanTrackerPrototype?.state?.actingContactId;
            const c = w.TanTrackerPrototype?.contacts?.().find((x) => x.id === actor);
            return !!w.__TT_EXTERNAL_PERSON__ && c?.kind === "external";
          },
          undefined,
          { timeout: 10000 },
        );
        assert.equal(await page.locator('[data-tt="complete"]').count(), 0);

        await staffPage.goto(`${fixture.baseUrl}/tan-tracker`);
        await staffPage.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
        await staffPage.locator(`[data-tt-open="${publicCode}"]`).first().click();
        await staffPage.waitForSelector('[data-tt="attach-download"]', { timeout: 15000 });

        const attachments = staffPage.locator("details").filter({ has: staffPage.locator('[data-tt="attach-download"]') });
        if ((await attachments.getAttribute("open")) === null) {
          await attachments.locator("summary").first().click();
        }
        const downloadHref = await staffPage.locator('[data-tt="attach-download"]').first().getAttribute("href");
        assert.ok(downloadHref);
        const downloadResult = await fetchAttachmentBytesViaPage(staffPage, downloadHref);
        assert.equal(
          downloadResult.status,
          200,
          `attachment download path=${redactAttachmentDownloadPath(downloadHref, fixture.baseUrl)} status=${downloadResult.status}`,
        );
        assert.ok(Buffer.from(downloadResult.bytes).equals(pngBytes));
      } finally {
        await staffPage.close();
        await staffContext.close();
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

  it("visual acceptance: registry, summary, pending detail matrix (Chromium)", async () => {
    const est = fixture.estToken;
    assert.ok(est);
    const page = await fixture.browser.newPage();
    try {
      await openExternalHome(page, fixture.baseUrl, est);
      await captureVisualMatrix(page, "registry", async () => {
        await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 5000 });
        assert.ok(await page.locator('[data-tt="ext-request-open"]').isVisible());
      });

      await advanceExternalWizardToSummary(page);
      await captureVisualMatrix(page, "summary", async () => {
        await page.waitForSelector(".tt-ext-chat-summary", { timeout: 5000 });
        assert.ok(await page.locator('[data-tt="ext-request-next"]').isVisible());
      });

      const confirmReq = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/confirm") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      const confirmResp = await confirmReq;
      assert.equal(confirmResp.status(), 200);
      const confirmJson = (await confirmResp.json()) as { publicCode?: string };
      const firstCode = confirmJson.publicCode;
      assert.ok(firstCode);
      await page.click('[data-tt="ext-request-open-order"]');
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 15000 });

      await page.click('[data-tt="back-list"]');
      await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 15000 });
      await advanceExternalWizardToSummary(page);
      const confirmReq2 = page.waitForResponse(
        (r) => r.url().includes("/api/tan-tracker/public/external/request/confirm") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await page.click('[data-tt="ext-request-next"]');
      const confirmResp2 = await confirmReq2;
      assert.equal(confirmResp2.status(), 200);
      const secondCode = ((await confirmResp2.json()) as { publicCode?: string }).publicCode;
      assert.ok(secondCode);
      assert.notEqual(secondCode, firstCode);

      await page.click('[data-tt="ext-request-open-order"]');
      await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 15000 });

      await captureVisualMatrix(page, "pending-detail", async () => {
        await page.waitForSelector('[data-tt="enter-code"]', { timeout: 10000 });
        assert.ok(await page.locator('[data-tt="enter-code"]').isVisible());
        await page.waitForFunction(
          (code) => {
            const proto = (window as unknown as { TanTrackerPrototype?: { state?: { orderId?: string } } })
              .TanTrackerPrototype;
            return proto?.state?.orderId === code;
          },
          secondCode,
          { timeout: 10000 },
        );
      });
    } catch (err) {
      const shot = await saveBrowserDiagnostic(page, "visual-acceptance-failure");
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
