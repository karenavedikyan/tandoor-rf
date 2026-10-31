import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { getPool } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser } from "../helpers/test-db";
import { startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture } from "./helpers/http-integration-browser";

describe("completion follows current custody (browser + real PG)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-holder-complete-browser", extraEnv: { TANBOT_MAX_ENABLED: "false" } });
    const people = [];
    for (const [email, fullName] of [
      ["holder-creator@test.local", "Отправитель Тест"],
      ["holder-oasis@test.local", "Оазис Тест"],
    ]) {
      const user = await createTestUser({ databaseUrl: fixture.databaseUrl, email, password: fixture.password, fullName, role: "manager" });
      const client = await getPool()!.connect();
      try { people.push(await ensurePartyForUserOnWrite(client, user.id, fullName, null)); }
      finally { client.release(); }
    }
    await getPool()!.query(
      `INSERT INTO tt_transfers(id,public_code,item_title,status,creator_party_id,holder_party_id,final_recipient_party_id,handoff_version,row_version,delivered_at)
       VALUES('TT-2026-910','TT-2026-910','Документы у Оазиса','delivered',$1,$2,$2,2,1,NOW())`,
      [people[0]!.id, people[1]!.id],
    );
  });
  after(async () => { if (fixture) await stopBrowserHttpFixture(fixture); });

  async function open(page: Page, email: string) {
    await page.goto(`${fixture.baseUrl}/login`);
    await page.fill("#email", email);
    await page.fill("#password", fixture.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/);
    await page.goto(`${fixture.baseUrl}/tan-tracker/`);
    await page.locator("table").getByText("Документы у Оазиса", { exact: true }).click();
  }

  it("denies former creator in UI and API; lets current holder cancel then explicitly finish", async () => {
    const errors: string[] = [];
    const creator = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await creator.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await open(page, "holder-creator@test.local");
    assert.equal(await page.locator('[data-tt="complete"]:visible').count(), 0);
    assert.match(await page.locator('[data-tt="detail-task-former"]').innerText(), /Ваш этап завершён/);
    const denied = await creator.request.post(`${fixture.baseUrl}/api/tan-tracker/transfers/TT-2026-910/legacy-complete`,
      { headers: { Origin: fixture.baseUrl }, data: {} });
    assert.equal(denied.status(), 403, await denied.text());
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.locator('[data-tt="complete"]:visible').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await page.locator('[data-tt="complete"]:visible').count(), 0);
    await creator.close();

    const holder = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 } });
    const hp = await holder.newPage();
    hp.on("pageerror", e => errors.push(e.message));
    await open(hp, "holder-oasis@test.local");
    await hp.locator('[data-tt="complete"]:visible').first().click();
    assert.equal(await hp.locator('[data-tt="complete-confirm"]').isVisible(), true);
    assert.equal(await hp.evaluate(() => document.activeElement?.getAttribute("data-tt")), "cancel-complete");
    await hp.locator('[data-tt="cancel-complete"]').click();
    assert.equal(await hp.locator('[data-tt="complete-confirm"]').count(), 0);
    assert.equal((await getPool()!.query(`SELECT status FROM tt_transfers WHERE id='TT-2026-910'`)).rows[0].status, "delivered");
    await hp.setViewportSize({ width: 375, height: 812 });
    await hp.locator('[data-tt="complete"]:visible').first().click();
    const panel = hp.locator('[data-tt="complete-confirm"]');
    assert.equal(await panel.isVisible(), true);
    const box = await panel.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 376);
    assert.equal(await hp.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const completion = hp.waitForResponse(r => r.url().endsWith("/legacy-complete") && r.request().method() === "POST");
    await hp.locator('[data-tt="confirm-complete"]').click();
    assert.equal((await completion).status(), 200);
    await hp.waitForFunction(() => document.body.innerText.includes("Передача завершена"));
    assert.equal(await hp.locator('[data-tt="complete"]:visible').count(), 0);
    const row = (await getPool()!.query(`SELECT status,handoff_version FROM tt_transfers WHERE id='TT-2026-910'`)).rows[0];
    assert.equal(row.status, "completed");
    assert.equal(row.handoff_version, 3);
    assert.deepEqual(errors, []);
    await holder.close();
  });
});
