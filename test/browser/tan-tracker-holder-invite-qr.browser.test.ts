import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { webkit, type Browser } from "playwright";
import { Pool } from "pg";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser } from "../helpers/test-db";
import { startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture } from "./helpers/http-integration-browser";

describe("current external holder shares a recipient invitation and mobile QR", () => {
  let fixture: BrowserHttpFixture;
  let pool: Pool;
  let safari: Browser;
  let est: string;
  let baseline: unknown;
  const id = "TT-2026-960";
  const stateSql = "SELECT id,status,holder_party_id,pending_party_id,handoff_version,row_version FROM tt_transfers ORDER BY id";
  const detailUrl = () => `${fixture.baseUrl}/tan-tracker/?est=${encodeURIComponent(est)}#tan-tracker?tt_screen=detail&tt_id=${id}`;

  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-holder-invite-qr-browser",
      extraEnv: { TT_OTP_PEPPER: "test-otp-pepper-min-16-chars", TT_EXTERNAL_MESSENGER_ENABLED: "true" },
    });
    pool = new Pool({ connectionString: fixture.databaseUrl });
    const staff = await createTestUser({
      databaseUrl: fixture.databaseUrl, email: "holder-invite-staff@test.local",
      password: fixture.password, fullName: "Тестовый сотрудник", role: "manager",
    });
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1", [staff.id]);
    const sender = await ensurePartyForUserOnWrite(pool, staff.id, "Тестовый сотрудник", "+79991234001");
    const holder = (await pool.query(
      "INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Тестовый получатель','+79991234002') RETURNING id",
    )).rows[0].id;
    await pool.query(
      `INSERT INTO tt_transfers(id,public_code,item_title,status,creator_party_id,holder_party_id,final_recipient_party_id,handoff_version,row_version,delivered_at)
       VALUES($1,$1,'Ключи от склада','delivered',$2,$3,$3,2,1,NOW())`, [id, sender.id, holder],
    );
    const person = (await pool.query(
      "INSERT INTO tt_external_persons(phone_e164,display_name,party_id) VALUES('+79991234002','Тестовый получатель',$1) RETURNING id",
      [holder],
    )).rows[0].id;
    await pool.query(
      "INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id) VALUES($1,'telegram','880001','880001')",
      [person],
    );
    const client = await pool.connect();
    try { est = await createPersonBrowserSession(client, person, "telegram"); }
    finally { client.release(); }
    const context = await fixture.browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(detailUrl());
      await page.getByRole("button", { name: "Передать этот предмет дальше", exact: true }).click();
      await page.locator('[data-tt="contact-pick"] button').first().click();
      const result = page.waitForResponse(r => r.url().endsWith("/public/holder/pending/change") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
      assert.equal((await result).status(), 200);
      await page.getByRole("button", { name: "Поделиться приглашением", exact: true }).waitFor();
      baseline = (await pool.query(stateSql)).rows;
    } finally { await context.close(); }
    safari = await webkit.launch({ headless: true });
  });

  after(async () => {
    if (safari) await safari.close();
    if (pool) await pool.end();
    if (fixture) await stopBrowserHttpFixture(fixture);
  });

  for (const engine of ["chromium", "webkit"] as const) {
    it(`${engine}: recipient-only invitation, full-text copy, rendered raster QR and actual recipient page`, async () => {
      const context = await (engine === "webkit" ? safari : fixture.browser).newContext({
        viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, colorScheme: "dark",
      });
      try {
        await context.addInitScript(`(() => {
          Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
          Object.defineProperty(navigator, "clipboard", {
            configurable: true, value: { writeText: async (text) => { window.__copiedInvite = text; } },
          });
        })()`);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.goto(detailUrl());
        assert.equal(await page.locator('[data-tt="messenger-invite-message-text"]').count(), 0);
        await page.getByRole("button", { name: "Поделиться приглашением", exact: true }).click();
        await page.waitForFunction(() => Boolean((window as any).__copiedInvite));
        const text = await page.evaluate(() => (window as any).__copiedInvite as string);
        for (const expected of ["Отправитель: Тестовый получатель", "Получатель: Тестовый сотрудник", "Предмет: Ключи от склада", `Трек: ${id}`, "получите код приёма", "Сообщите этот код отправителю"]) {
          assert.ok(text.includes(expected), expected);
        }
        const urls = text.match(/https?:\/\/\S+/g) || [];
        assert.equal(urls.length, 1);
        const invitation = new URL(urls[0]);
        assert.equal(invitation.pathname, "/tan-tracker/recipient");
        assert.ok(invitation.hash.includes("tt_tok="));
        assert.doesNotMatch(urls[0], /[?&#](est|tt_hat|holderAccessToken)=/);
        assert.ok(!urls[0].includes(est));
        await page.getByRole("button", { name: "QR-код", exact: true }).click();
        const qr = page.locator(".tt-qr-image");
        await qr.evaluate((img: HTMLImageElement) => img.decode());
        assert.equal(await qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 200), true);
        assert.match((await qr.getAttribute("src")) || "", /^data:image\/gif;base64,/);
        assert.equal(await page.locator(".tt-qr-wrap svg").count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.reload();
        await page.getByRole("button", { name: "Поделиться приглашением", exact: true }).waitFor();
        await page.getByRole("button", { name: "QR-код", exact: true }).click();
        await page.locator(".tt-qr-image").evaluate((img: HTMLImageElement) => img.decode());
        // A fresh recipient context must not inherit the sender's session.
        const recipientContext = await (engine === "webkit" ? safari : fixture.browser).newContext();
        try {
          const recipient = await recipientContext.newPage();
          const recipientErrors: string[] = [];
          recipient.on("pageerror", e => recipientErrors.push(e.message));
          const response = recipient.waitForResponse(r => r.url().includes("/public/recipient/context?"));
          await recipient.goto(urls[0]);
          assert.equal((await response).status(), 200);
          await recipient.getByText("Ключи от склада", { exact: true }).first().waitFor();
          assert.equal(await recipient.locator('input[type="password"]').count(), 0);
          assert.equal(await recipient.getByRole("button", { name: "Отправить код на телефон", exact: true }).isVisible(), true);
          assert.deepEqual(recipientErrors, []);
        } finally { await recipientContext.close(); }
        assert.deepEqual((await pool.query(stateSql)).rows, baseline);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }

  for (const mode of ["native", "abort", "sync-error", "denied"] as const) {
    it(`share mode ${mode}: native sharing, cancellation and safe clipboard fallback`, async () => {
      const context = await fixture.browser.newContext({ viewport: { width: 375, height: 812 } });
      try {
        await context.addInitScript(`(() => {
          const mode = ${JSON.stringify(mode)};
          window.__shareCalls = [];
          window.__copyCalls = [];
          Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
          Object.defineProperty(navigator, "share", { configurable: true, value: mode === "denied" ? undefined : (data) => {
            window.__shareCalls.push(data);
            if (mode === "sync-error") throw new DOMException("Unavailable", "NotAllowedError");
            if (mode === "abort") return Promise.reject(new DOMException("Cancelled", "AbortError"));
            return Promise.resolve();
          } });
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => {
            window.__copyCalls.push(text);
            if (mode === "denied") throw new DOMException("Denied", "NotAllowedError");
          } } });
          if (mode === "denied") document.execCommand = () => false;
        })()`);
        const page = await context.newPage();
        await page.goto(detailUrl());
        await page.getByRole("button", { name: "Поделиться приглашением", exact: true }).click();
        if (mode === "denied") {
          const manual = page.locator('[data-tt="messenger-invite-message-text"]');
          await manual.waitFor();
          assert.match(await manual.inputValue(), /Сообщите этот код отправителю/);
          assert.match(await manual.inputValue(), /Получить код приёма: http/);
        } else {
          await page.waitForFunction((m) => m === "sync-error" ? (window as any).__copyCalls.length === 1 : (window as any).__shareCalls.length === 1, mode);
          const calls = await page.evaluate(() => ({ share: (window as any).__shareCalls, copy: (window as any).__copyCalls }));
          assert.equal(calls.share.length, 1);
          assert.equal(calls.copy.length, mode === "sync-error" ? 1 : 0);
          assert.match(calls.share[0].text, /Трек: TT-2026-960/);
        }
        assert.deepEqual((await pool.query(stateSql)).rows, baseline);
      } finally { await context.close(); }
    });
  }

  for (const broken of ["missing-generator", "broken-image"] as const) {
    it(`${broken}: readable QR error instead of a white rectangle; sharing remains available`, async () => {
      const context = await fixture.browser.newContext();
      try {
        await context.route("**/qrcode-generator.js", route => route.fulfill({
          contentType: "application/javascript",
          body: broken === "missing-generator" ? "window.qrcode=undefined;" :
            "window.qrcode=function(){return {addData(){},make(){},getModuleCount(){return 21},createDataURL(){return 'data:image/gif;base64,broken'}}};",
        }));
        const page = await context.newPage();
        await page.goto(detailUrl());
        await page.getByRole("button", { name: "QR-код", exact: true }).click();
        await page.locator(".tt-qr-error").waitFor();
        assert.match(await page.locator(".tt-qr-error").innerText(), /Не удалось показать QR-код/);
        assert.equal(await page.getByRole("button", { name: "Поделиться приглашением", exact: true }).isEnabled(), true);
        assert.deepEqual((await pool.query(stateSql)).rows, baseline);
      } finally { await context.close(); }
    });
  }
});
