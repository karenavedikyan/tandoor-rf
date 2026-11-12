import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { getPool } from "../../src/db/pool";
import type { Page } from "playwright";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

const FIXTURE_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tan-tracker-admin-wizard.png");

describe("tan-tracker admin full create wizard (browser + real PG)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  let pngBytes: Buffer;

  before(async () => {
    pngBytes = await fs.readFile(FIXTURE_PNG);
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-admin-wizard-browser",
      extraEnv: { TANBOT_MAX_ENABLED: "false" },
    });
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

  async function runAdminCreateWizard(page: Page) {
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
    await page.click('[data-tt="create"]');
    await page.waitForSelector('[data-tt="create-wizard"]', { timeout: 15000 });

    await page.fill('[data-tt-field="item"]', "Browser admin коробка");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="files"]', { timeout: 10000 });

    const fileInput = page.locator('[data-tt="attach-input"]').first();
    await fileInput.setInputFiles(FIXTURE_PNG);
    await page.waitForFunction(
      () => {
        const busy = document.querySelector('[data-tt="attach-busy"]');
        const btn = document.querySelector('[data-tt="create-wizard-next"]');
        return !busy && btn && !btn.hasAttribute("disabled");
      },
      { timeout: 20000 },
    );
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="recipient"]', { timeout: 10000 });

    assert.equal(await page.locator('[data-tt="create-recipient-browse"]').count(), 0);
    await page.fill('[data-tt-field="newPhone"]', "+79990001122");
    await page.fill('[data-tt-field="newName"]', "Browser Fresh Recipient");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="review"]', { timeout: 10000 });

    const submit = page.locator('[data-tt="create-wizard-submit"]');
    const createResponsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/api/tan-tracker/transfers") &&
        r.status() === 201,
      { timeout: 30000 },
    );
    await submit.click();
    const createResponse = await createResponsePromise;
    const createBody = (await createResponse.json()) as { publicCode?: string };
    await page.waitForSelector('[data-tt="detail"]', { timeout: 30000 });

    assert.ok(createBody.publicCode, "create response must include publicCode");

    const receipt = page.locator('[data-tt="create-saved-receipt"]');
    if (await receipt.count()) {
      await page.click('[data-tt="create-retry-refresh"]');
      await page.waitForSelector('[data-tt="detail"]', { timeout: 20000 });
    }
    assert.match(await page.content(), /Browser admin коробка|admin коробка/i);

    const boot = await page.request.get(`${fixture.baseUrl}/api/tan-tracker/bootstrap`);
    assert.equal(boot.status(), 200);
    const bootJson = (await boot.json()) as {
      orders: Array<{ id: string; item: string; attachments?: Array<{ id: string }> }>;
    };
    const order = bootJson.orders.find((o) => o.id === createBody.publicCode);
    assert.ok(order, "created transfer visible in bootstrap after save");
    assert.match(order!.item, /Browser admin/i);
    assert.equal(order!.attachments?.length, 1, "exactly one attachment must be linked to the transfer");
    const attId = order!.attachments![0]!.id;
    const dl = await page.request.get(
      `${fixture.baseUrl}/api/tan-tracker/transfers/${encodeURIComponent(order!.id)}/attachments/${encodeURIComponent(attId)}`,
    );
    assert.equal(dl.status(), 200);
    const body = await dl.body();
    assert.ok(body.equals(pngBytes), "downloaded attachment bytes match fixture PNG");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 20000 });
    const bootAfterReload = await page.request.get(`${fixture.baseUrl}/api/tan-tracker/bootstrap`);
    const bootAfterJson = (await bootAfterReload.json()) as { orders: Array<{ id: string }> };
    assert.ok(
      bootAfterJson.orders.some((o) => o.id === createBody.publicCode),
      "transfer persists after page reload",
    );

    const meRes = await page.request.get(`${fixture.baseUrl}/api/auth/me`);
    assert.equal(meRes.status(), 200);
    assert.equal((await meRes.json()).user.role, "admin");
  }

  it("completes upload → recipient → submit → detail/reload as unlinked admin", async () => {
    const context = await fixture.browser.newContext({
      viewport: { width: 1280, height: 900 },
      baseURL: fixture.baseUrl,
    });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    await runAdminCreateWizard(page);
    await context.close();
  });

  it("double submit sends exactly one POST 201 and saves one transfer", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    await login(page, "tt-browser-admin@test.local");
    const createPosts: number[] = [];
    page.on("response", (res) => {
      if (res.request().method() === "POST" && res.url().includes("/api/tan-tracker/transfers")) {
        createPosts.push(res.status());
      }
    });
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.click('[data-tt="create"]');
    await page.fill('[data-tt-field="item"]', "No duplicate click");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    await page.fill('[data-tt-field="newPhone"]', "+79990001122");
    await page.fill('[data-tt-field="newName"]', "Browser Fresh Recipient");
    await page.click('[data-tt="create-wizard-next"]');
    const submit = page.locator('[data-tt="create-wizard-submit"]');
    const createResponsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/api/tan-tracker/transfers") &&
        r.status() === 201,
      { timeout: 30000 },
    );
    await submit.click({ clickCount: 2, delay: 50 });
    const createResponse = await createResponsePromise;
    const createBody = (await createResponse.json()) as { publicCode?: string };
    await page.waitForSelector('[data-tt="detail"]', { timeout: 30000 });
    await page.waitForFunction(
      () => !document.querySelector('[data-tt="create-pending"]'),
      { timeout: 10000 },
    );
    assert.equal(createPosts.length, 1, `expected exactly one create POST, got ${createPosts.join(",")}`);
    assert.equal(createPosts[0], 201);
    assert.ok(createBody.publicCode);
    const boot = await page.request.get(`${fixture.baseUrl}/api/tan-tracker/bootstrap`);
    assert.ok(
      (await boot.json()).orders.some((o: { id: string }) => o.id === createBody.publicCode),
      "saved transfer visible after double-click attempt",
    );
    await context.close();
  });

  it("admin wizard reuses another creator's external phone and preserves its private label after reload", { timeout: 60000 }, async () => {
    const number = "+79990005577", alias = "Мой получатель по номеру";
    const pool = getPool()!;
    const old = (await pool.query(
      `INSERT INTO tt_parties(kind,display_name,phone_e164,created_by_user_id)
       SELECT 'external','Other creator original label',$1,id FROM users WHERE email='tt-browser-fresh@test.local'
       RETURNING id,created_by_user_id`,
      [number])).rows[0];
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: fixture.baseUrl });
    await context.route("**/*", route => new URL(route.request().url()).origin === fixture.baseUrl
      ? route.continue() : route.abort());
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await login(page, "tt-browser-admin@test.local");
      await page.goto(`${fixture.baseUrl}/tan-tracker`);
      await page.click('[data-tt="create"]');
      await page.fill('[data-tt-field="item"]', "Existing phone admin regression");
      await page.click('[data-tt="create-wizard-next"]');
      await page.click('[data-tt="create-skip-files"]');
      await page.fill('[data-tt-field="newPhone"]', number);
      await page.fill('[data-tt-field="newName"]', alias);
      await page.click('[data-tt="create-wizard-next"]');
      const pending = page.waitForResponse(r => r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/tan-tracker/transfers");
      await page.click('[data-tt="create-wizard-submit"]');
      const response = await pending;
      assert.equal(response.status(), 201, await response.text());
      const created = await response.json();
      await page.waitForSelector('[data-tt="detail"]');
      await page.reload();
      await page.waitForSelector('[data-tt="detail"]');
      const detail = await page.locator('[data-tt="detail"]').innerText();
      assert.match(detail, /Мой получатель по номеру/);
      assert.doesNotMatch(detail, /Other creator original label/);
      const transfer = (await pool.query("SELECT pending_party_id,final_recipient_party_id FROM tt_transfers WHERE id=$1",
        [created.publicCode])).rows[0];
      assert.equal(transfer.pending_party_id, old.id);
      assert.equal(transfer.final_recipient_party_id, old.id);
      const contacts = (await pool.query(
        "SELECT id,display_name,created_by_user_id FROM tt_parties WHERE kind='external' AND phone_e164=$1",
        [number])).rows;
      assert.equal(contacts.length, 1);
      assert.equal(contacts[0].id, old.id);
      assert.equal(contacts[0].created_by_user_id, old.created_by_user_id);
      assert.equal(contacts[0].display_name, "Other creator original label");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("mobile unified phone entry validates, edits personal names and assigns the canonical staff account", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 375, height: 812 }, baseURL: fixture.baseUrl });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await login(page, "tt-browser-admin@test.local");
    await page.goto(`${fixture.baseUrl}/tan-tracker`);
    await page.waitForSelector('[data-testid="tan-tracker"]');
    await page.locator('[data-tt="create-fab"]:visible, [data-tt="create"]:visible').first().click();
    await page.fill('[data-tt-field="item"]', "Mobile phone-first agreement");
    await page.click('[data-tt="create-wizard-next"]');
    await page.click('[data-tt="create-skip-files"]');
    assert.equal(await page.locator('[data-tt="create-recipient-browse"]').count(), 0);
    await page.click('[data-tt="create-wizard-next"]');
    assert.equal(await page.locator('[data-create-phase="recipient"]').count(), 1);
    await page.fill('[data-tt-field="newPhone"]', "8 (999) 000-11-22");
    await page.fill('[data-tt-field="newName"]', "Мой Антон на складе");
    await page.click('[data-tt="create-wizard-next"]');
    await page.waitForSelector('[data-create-phase="review"]');
    assert.match(await page.locator('[data-tt="create-wizard"]').innerText(), /Мой Антон на складе/);
    await page.click('[data-tt="create-edit-recipient"]');
    assert.equal(await page.inputValue('[data-tt-field="newName"]'), "Мой Антон на складе");
    await page.locator('[data-tt-field="newPhone"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/home/user/workspace/tandor-phone-entry-mobile.png" });
    await page.fill('[data-tt-field="newName"]', "Мой сотрудник");
    await page.click('[data-tt="create-wizard-next"]');
    const pending = page.waitForResponse(r => r.request().method() === "POST" &&
      r.url().endsWith("/api/tan-tracker/transfers") && r.status() === 201);
    await page.click('[data-tt="create-wizard-submit"]');
    const created = await (await pending).json();
    await page.waitForSelector('[data-tt="detail"]');
    assert.match(await page.locator('[data-tt="detail"]').innerText(), /Мой сотрудник/);
    const own = await (await page.request.get("/api/tan-tracker/bootstrap")).json();
    const order = own.orders.find((o: { id: string }) => o.id === created.publicCode);
    assert.ok(order);
    const recipient = own.contacts.find((c: { id: string }) => c.id === order.finalRecipientId);
    assert.equal(recipient.kind, "user");
    assert.equal(recipient.name, "Мой сотрудник");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.waitForSelector('[data-tt="detail"]');
    assert.match(await page.locator('[data-tt="detail"]').innerText(), /Мой сотрудник/);
    await page.screenshot({ path: "/home/user/workspace/tandor-phone-detail-desktop.png", fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    const recipientContext = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    const recipientPage = await recipientContext.newPage();
    await login(recipientPage, "tt-browser-fresh@test.local");
    const theirs = await (await recipientPage.request.get("/api/tan-tracker/bootstrap")).json();
    assert.ok(theirs.orders.some((o: { id: string }) => o.id === created.publicCode));
    assert.equal(theirs.contacts.find((c: { id: string }) => c.id === recipient.id).name, "Browser Fresh Recipient");
    await recipientContext.close();
  });
});
