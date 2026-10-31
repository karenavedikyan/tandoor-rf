import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser } from "../helpers/test-db";
import { startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture } from "./helpers/http-integration-browser";

describe("external creation versus forwarding an existing item", () => {
  let fixture: BrowserHttpFixture;
  let pool: Pool;
  let est: string;
  const id = "TT-2026-950";

  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-action-context-browser",
      extraEnv: { TT_OTP_PEPPER: "test-otp-pepper-min-16-chars", TT_EXTERNAL_MESSENGER_ENABLED: "true" },
    });
    pool = new Pool({ connectionString: fixture.databaseUrl });
    const staff = await createTestUser({
      databaseUrl: fixture.databaseUrl, email: "action-context-staff@test.local",
      password: fixture.password, fullName: "Тестовый отправитель", role: "manager",
    });
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1", [staff.id]);
    const sender = await ensurePartyForUserOnWrite(pool, staff.id, "Тестовый отправитель", "+79991234001");
    const holder = (await pool.query(
      "INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Тестовый получатель','+79991234002') RETURNING id",
    )).rows[0].id;
    await pool.query(
      `INSERT INTO tt_transfers(id,public_code,item_title,status,creator_party_id,holder_party_id,final_recipient_party_id,handoff_version,row_version,delivered_at)
       VALUES($1,$1,'Ключи от склада','delivered',$2,$3,$3,2,1,NOW())`,
      [id, sender.id, holder],
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
  });

  after(async () => {
    if (pool) await pool.end();
    if (fixture) await stopBrowserHttpFixture(fixture);
  });

  for (const width of [375, 1440]) {
    it(`${width}px: separates new item, current item and forwarding; opening/cancelling changes no transfer`, async () => {
      const context = await fixture.browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${fixture.baseUrl}/tan-tracker/?est=${encodeURIComponent(est)}`);
      await page.locator('[data-tt="ext-request-open"]').waitFor();
      await page.getByText("Ключи от склада", { exact: true }).first().waitFor();
      assert.equal(await page.locator('[data-tt="external-bar"]').count(), 1);
      assert.equal(await page.locator('[data-tt="ext-request-open"]').innerText(), "Создать новую передачу");
      assert.match(await page.locator(".tt-ext-new-entry").innerText(), /другого предмета.*отдельный трек/s);
      assert.match(await page.locator('[data-tt-ext-group="held"]').innerText(), /Предметы у вас.*Ключи от склада/is);
      await page.getByText("Ключи от склада", { exact: true }).first().click();
      const current = page.locator('[data-tt="holder-delivered"]');
      await current.waitFor();
      assert.equal(await page.locator('[data-tt="external-bar"]').count(), 1);
      assert.equal(await page.locator('[data-tt="ext-request-open"]').count(), 0);
      assert.match(await current.innerText(), /продолжение трека TT-2026-950/);
      await current.getByRole("button", { name: "Передать этот предмет дальше", exact: true }).click();
      await page.locator('[data-tt="forward-existing-context"]').waitFor();
      assert.match(await page.locator('[data-tt="forward-existing-context"]').innerText(), /Трек TT-2026-950 сохранится/);
      assert.equal(await page.locator('[data-tt="ext-request-open"]').count(), 0);
      assert.equal(await page.locator('[data-tt="external-bar"]').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole("button", { name: "Назад", exact: true }).click();
      await current.waitFor();
      await page.getByRole("button", { name: "← Мои передачи", exact: true }).click();
      await page.locator('[data-tt="ext-request-open"]').click();
      await page.locator('[data-tt-field="extItem"]').waitFor();
      assert.equal(await page.locator('[data-tt-field="extItem"]').inputValue(), "");
      assert.equal(await page.getByRole("heading", { name: "Создать новую передачу", exact: true }).count(), 1);
      assert.match(await page.locator(".tt-ext-chat-sub").innerText(), /Новый предмет.*отдельный трек/);
      assert.equal(await page.locator('[data-tt="external-bar"]').count(), 1);
      assert.equal(await page.locator('[data-tt="ext-request-open"]').count(), 0);
      await page.getByRole("button", { name: "← Мои передачи", exact: true }).click();
      await page.getByText("Ключи от склада", { exact: true }).first().click();
      await page.reload();
      await current.waitFor();
      assert.equal(await page.locator('[data-tt="ext-request-open"]').count(), 0);
      assert.equal(await page.locator('[data-tt="external-bar"]').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const rows = await pool.query("SELECT id,status,row_version,handoff_version FROM tt_transfers ORDER BY id");
      assert.deepEqual(rows.rows, [{ id, status: "delivered", row_version: 1, handoff_version: 2 }]);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  it("forwarding changes the existing track; creating another item produces a distinct track", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.baseUrl}/tan-tracker/?est=${encodeURIComponent(est)}`);
    await page.getByText("Ключи от склада", { exact: true }).first().click();
    await page.getByRole("button", { name: "Передать этот предмет дальше", exact: true }).click();
    await page.locator('[data-tt="contact-pick"] button').first().click();
    const forwarding = page.waitForResponse(r => r.url().endsWith("/public/holder/pending/change") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
    assert.equal((await forwarding).status(), 200);
    await page.getByRole("button", { name: "Ввести код", exact: true }).waitFor();
    const original = (await pool.query(
      "SELECT id,status,holder_party_id,pending_party_id,row_version,handoff_version FROM tt_transfers WHERE id=$1", [id],
    )).rows[0];
    assert.equal(original.status, "waiting");
    assert.ok(original.pending_party_id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM tt_transfers")).rows[0].n, 1);
    await page.getByRole("button", { name: "Ввести код", exact: true }).click();
    await page.locator('[data-tt="code-input"]').waitFor();
    assert.equal(await page.locator('[data-tt="external-bar"]').count(), 1);
    assert.equal(await page.locator('[data-tt="ext-request-open"]').count(), 0);
    await page.getByRole("button", { name: "← Мои передачи", exact: true }).click();
    await page.locator('[data-tt="ext-request-open"]').click();
    await page.locator('[data-tt-field="extItem"]').fill("Новый комплект документов");
    await page.locator('[data-tt="ext-request-next"]').click();
    await page.locator('[data-tt="ext-photo-input"]').waitFor({ state: "attached" });
    await page.locator('[data-tt="ext-request-next"]').click();
    await page.locator('[data-tt-field="extComment"]').waitFor();
    await page.locator('[data-tt="ext-request-next"]').click();
    await page.locator('[data-tt="ext-pick-recipient"]').filter({ hasText: "Тестовый отправитель" }).first().click();
    await page.locator('[data-tt="ext-request-next"]').click();
    await page.locator('[data-tt="ext-due-tomorrow"]').click();
    await page.locator('[data-tt="ext-request-next"]').click();
    await page.locator(".tt-ext-chat-summary").waitFor();
    const creation = page.waitForResponse(r => r.url().endsWith("/external/request/confirm") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Создать заявку", exact: true }).click();
    const response = await creation;
    assert.equal(response.status(), 200);
    const result = await response.json() as { publicCode: string };
    assert.notEqual(result.publicCode, id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM tt_transfers")).rows[0].n, 2);
    assert.deepEqual((await pool.query(
      "SELECT id,status,holder_party_id,pending_party_id,row_version,handoff_version FROM tt_transfers WHERE id=$1", [id],
    )).rows[0], original);
    assert.equal((await pool.query("SELECT item_title FROM tt_transfers WHERE id=$1", [result.publicCode])).rows[0].item_title, "Новый комплект документов");
    assert.deepEqual(errors, []);
    await context.close();
  });

  it("with several items, a direct link and reload stay on the selected track, not the first bootstrap row", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto(`${fixture.baseUrl}/tan-tracker/?est=${encodeURIComponent(est)}#tan-tracker?tt_screen=detail&tt_id=${id}`);
    await page.getByRole("heading", { name: "Ключи от склада", exact: true }).waitFor();
    assert.equal(await page.locator('[data-tt="ext-request-open"]').count(), 0);
    await page.reload();
    await page.getByRole("heading", { name: "Ключи от склада", exact: true }).waitFor();
    assert.equal(await page.locator('[data-tt="ext-request-open"]').count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Новый комплект документов", exact: true }).count(), 0);
    await context.close();
  });
});
