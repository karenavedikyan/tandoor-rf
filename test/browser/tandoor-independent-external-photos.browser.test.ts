import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { chromium, webkit, type Page } from "playwright";
import { startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture } from "./helpers/http-integration-browser";
import { createTestUser } from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { readAttachmentBytes } from "../../src/tan-tracker/attachments";

describe("independent external request photos and comment", { concurrency: false }, () => {
  let f: BrowserHttpFixture;
  let pool: Pool;
  let serial = 0;
  let red: Buffer, blue: Buffer;
  const photos = '[data-tt="ext-request"] img[src^="blob:"]';
  const next = '[data-tt="ext-request-next"]';
  const picker = '[data-tt="ext-photo-input"]';
  const qaDir = process.env.TT_REVIEW_SCREENSHOTS_DIR || join(tmpdir(), "tandoor-external-ui-qa");
  before(async () => {
    f = await startBrowserHttpFixture({ attachmentsDir: "var/independent-external-photos", extraEnv: {
      TT_EXTERNAL_MESSENGER_ENABLED: "true", TT_OTP_PEPPER: "independent-photos-test-pepper",
    } });
    pool = new Pool({ connectionString: f.databaseUrl });
    const staff = await createTestUser({ databaseUrl: f.databaseUrl, email: "photos-staff@test.local",
      password: f.password, fullName: "Photo Test Staff", role: "manager" });
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Photo Test Staff", "+79994446000");
    red = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#ba2737" } }).png().toBuffer();
    blue = await sharp({ create: { width: 240, height: 320, channels: 3, background: "#2474b0" } }).png().toBuffer();
    await mkdir(qaDir, { recursive: true });
  });
  after(async () => { await pool?.end(); if (f) await stopBrowserHttpFixture(f); });

  async function newSender(page: Page) {
    serial++;
    const phone = "+79994446" + String(serial).padStart(3, "0");
    const party = (await pool.query("INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Photo Test Sender',$1) RETURNING id", [phone])).rows[0].id;
    const person = (await pool.query("INSERT INTO tt_external_persons(phone_e164,display_name,party_id) VALUES($1,'Photo Test Sender',$2) RETURNING id", [phone, party])).rows[0].id;
    await pool.query("INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id) VALUES($1,'max',$2,$2)", [person, String(882000 + serial)]);
    const c = await pool.connect();
    let est: string;
    try { est = await createPersonBrowserSession(c, person, "max"); } finally { c.release(); }
    await page.goto(`${f.baseUrl}/tan-tracker?est=${encodeURIComponent(est!)}`);
    await page.locator('[data-tt="ext-request-open"]').click();
    await page.locator('[data-tt-field="extItem"]').fill("Synthetic photo parcel");
    await page.locator(next).click();
    await page.locator(picker).waitFor({ state: "attached" });
    return { person };
  }
  const data = (name: string, buffer: Buffer) => ({ name, mimeType: "image/png", buffer });
  async function addThroughButton(page: Page, name: string, buffer: Buffer) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Добавить фото", exact: true }).click();
    await (await chooser).setFiles(data(name, buffer));
  }
  async function loaded(page: Page, n: number) {
    await page.waitForFunction(({ selector, count }) => {
      const imgs = [...document.querySelectorAll(selector)] as HTMLImageElement[];
      return imgs.length === count && imgs.every(i => i.complete && i.naturalWidth > 0);
    }, { selector: photos, count: n });
  }
  async function openEveryPhoto(page: Page, n: number) {
    for (let i = 0; i < n; i++) {
      await page.locator(photos).nth(i).locator("xpath=ancestor::button[1]").click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await dialog.locator("img").evaluate((img: HTMLImageElement) => img.decode());
      assert.ok(await dialog.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
      if (i === 0) await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
      else await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
  }
  it("cancelled delayed upload cannot attach a hidden photo to the next request", async () => {
    const context = await f.browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let held = false;
    try {
      await newSender(page);
      const isOld = (r: { url: () => string; headers: () => Record<string, string> }) =>
        r.url().includes("/request/photo?") && r.headers()["x-tt-filename"] === "old-red.png";
      const oldDone = Promise.race([
        page.waitForResponse(r => isOld(r.request())).then(r => r.status()),
        page.waitForEvent("requestfailed", { predicate: isOld }).then(() => 0),
      ]);
      await page.route("**/public/external/request/photo?*", async route => {
        if (!held) { held = true; await gate; }
        await route.continue();
      });
      await addThroughButton(page, "old-red.png", red);
      await page.waitForFunction(s => (document.querySelector(s) as HTMLButtonElement)?.disabled === true, next);
      await page.locator('[data-tt="ext-request-close"]').click();
      await page.locator('[data-tt="ext-request-open"]').click();
      await page.locator('[data-tt-field="extItem"]').fill("New clean request");
      await page.locator(next).click();
      await page.locator(picker).waitFor({ state: "attached" });
      await addThroughButton(page, "only-blue.png", blue);
      await loaded(page, 1);
      await page.waitForFunction(s => document.querySelector(s)?.textContent?.trim() === "Далее", next);
      release();
      assert.notEqual(await oldDone, 201, "obsolete draft upload must never succeed");
      await page.locator(next).click();
      await page.locator(next).click();
      await page.locator('[data-tt="ext-pick-recipient"]').filter({ hasText: "Photo Test Staff" }).click();
      await page.locator(next).click();
      await page.locator(next).click();
      await page.locator(".tt-ext-chat-summary").waitFor();
      await loaded(page, 1);
      const confirmed = page.waitForResponse(r => r.url().includes("/request/confirm"));
      await page.locator(next).click();
      const result = await confirmed;
      assert.equal(result.status(), 200);
      const { publicCode } = await result.json();
      const rows = (await pool.query("SELECT storage_key FROM tt_transfer_attachments WHERE transfer_id=$1", [publicCode])).rows;
      assert.equal(rows.length, 1);
      const bytes = await readAttachmentBytes(rows[0].storage_key, pool);
      assert.ok(bytes?.equals(blue), "only the visible new blue photo belongs to this transfer");
    } finally { release(); await context.close(); }
  });
  it("late cancelled comment save cannot overwrite or advance a new form", async () => {
    const context = await f.browser.newContext();
    const page = await context.newPage();
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const seen = new Promise<void>(r => { captured = r; });
    try {
      const { person } = await newSender(page);
      await page.locator(next).click();
      await page.locator('[data-tt-field="extComment"]').fill("OLD CANCELLED COMMENT");
      await page.route("**/public/external/request/draft", async route => {
        if (route.request().postDataJSON()?.payload?.comment === "OLD CANCELLED COMMENT") {
          captured(); await gate;
        }
        await route.continue();
      });
      const oldDone = page.waitForResponse(r => r.url().endsWith("/request/draft") &&
        r.request().postDataJSON()?.payload?.comment === "OLD CANCELLED COMMENT");
      await page.locator(next).click();
      await seen;
      await page.locator('[data-tt="ext-request-close"]').click();
      await page.locator('[data-tt="ext-request-open"]').click();
      await page.locator('[data-tt-field="extItem"]').fill("NEW CURRENT ITEM");
      await page.locator(next).click();
      await page.locator(picker).waitFor({ state: "attached" });
      release();
      assert.ok([404, 409].includes((await oldDone).status()), "old draft-bound save must be rejected");
      await page.locator(picker).waitFor({ state: "attached" });
      const rows = (await pool.query("SELECT payload FROM tt_external_request_drafts WHERE person_id=$1::uuid AND confirmed_transfer_id IS NULL", [person])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].payload.item, "NEW CURRENT ITEM");
      assert.notEqual(rows[0].payload.comment, "OLD CANCELLED COMMENT");
    } finally { release(); await context.close(); }
  });
  for (const engine of [chromium, webkit]) {
    it(`${engine.name()}: pending, two photos, viewing, comment and summary, real confirmation`, async () => {
      const browser = engine === chromium ? f.browser : await webkit.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      try {
        await newSender(page);
        assert.ok((await page.getByRole("button", { name: "Добавить фото", exact: true }).boundingBox())!.height >= 44);
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        await page.route("**/public/external/request/photo?*", async route => { await gate; await route.continue(); });
        await addThroughButton(page, "red.png", red);
        await page.waitForFunction(s => (document.querySelector(s) as HTMLButtonElement)?.disabled === true, next);
        assert.match(await page.locator('[data-tt="ext-request"]').innerText(), /загруз/i);
        release();
        await loaded(page, 1);
        await page.unroute("**/public/external/request/photo?*");
        await addThroughButton(page, "blue.png", blue);
        await loaded(page, 2);
        await openEveryPhoto(page, 2);
        await page.screenshot({ path: join(qaDir, `${engine.name()}-photos.png`), fullPage: true });
        await page.locator(next).click();
        const comment = page.locator('[data-tt-field="extComment"]');
        assert.equal((await page.locator(next).innerText()).trim(), "Пропустить");
        await comment.fill("Handle carefully");
        assert.equal((await page.locator(next).innerText()).trim(), "Далее");
        assert.equal(await comment.evaluate(el => document.activeElement === el), true);
        await comment.fill("   ");
        assert.equal((await page.locator(next).innerText()).trim(), "Пропустить");
        await comment.fill("Handle carefully");
        await page.locator('[data-tt="ext-request-back"]').click();
        await loaded(page, 2);
        await page.locator(next).click();
        assert.equal(await comment.inputValue(), "Handle carefully");
        await page.screenshot({ path: join(qaDir, `${engine.name()}-comment.png`), fullPage: true });
        await page.locator(next).click();
        await page.locator('[data-tt="ext-pick-recipient"]').filter({ hasText: "Photo Test Staff" }).click();
        await page.locator(next).click();
        await page.locator('[data-tt="ext-due-tomorrow"]').click();
        await page.locator(next).click();
        await page.locator(".tt-ext-chat-summary").waitFor();
        await loaded(page, 2);
        await openEveryPhoto(page, 2);
        for (const width of [320, 1280, 390]) {
          await page.setViewportSize({ width, height: 900 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
          await page.screenshot({ path: join(qaDir, `${engine.name()}-summary-${width}.png`), fullPage: true });
        }
        const confirm = page.waitForResponse(r => r.url().includes("/request/confirm") && r.request().method() === "POST");
        await page.locator(next).click();
        const result = await confirm;
        assert.equal(result.status(), 200);
        const { publicCode } = await result.json();
        assert.ok(publicCode);
        const count = await pool.query("SELECT COUNT(*)::int AS n FROM tt_transfer_attachments WHERE transfer_id=$1", [publicCode]);
        assert.equal(count.rows[0].n, 2);
        assert.deepEqual(errors, []);
      } finally { await context.close(); if (engine !== chromium) await browser.close(); }
    });
    it(`${engine.name()}: failed upload is visible, never counted, same file retries`, async () => {
      const browser = engine === chromium ? f.browser : await webkit.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      try {
        await newSender(page);
        await page.route("**/public/external/request/photo?*", route => route.fulfill({ status: 503,
          contentType: "application/json", body: JSON.stringify({ error: { message: "Synthetic upload failure" } }) }));
        await addThroughButton(page, "retry.png", red);
        await page.getByText("Synthetic upload failure", { exact: false }).waitFor();
        assert.equal(await page.locator(photos).count(), 0);
        assert.equal((await page.locator(next).innerText()).trim(), "Пропустить");
        await page.unroute("**/public/external/request/photo?*");
        await addThroughButton(page, "retry.png", red);
        await loaded(page, 1);
        await page.waitForFunction(s => document.querySelector(s)?.textContent?.trim() === "Далее", next);
        assert.equal((await page.locator(next).innerText()).trim(), "Далее");
        assert.deepEqual(errors, []);
      } finally { await context.close(); if (engine !== chromium) await browser.close(); }
    });
  }
});
