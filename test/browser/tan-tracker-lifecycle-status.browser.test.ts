import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getPool } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser } from "../helpers/test-db";
import { startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture } from "./helpers/http-integration-browser";

describe("lifecycle and responsible holder across registry and detail", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  const longName = 'Карина Очень Длинная Фамилия Получателя <img src=x onerror="alert(1)">';
  const cases = [
    { n: 920, status: "active", holder: 0, pending: null, proof: false, key: "ready", text: "Ожидает передачи", name: "Вы" },
    { n: 921, status: "waiting", holder: 0, pending: 1, proof: false, key: "waiting", text: "Ожидает приёма", name: "Вы" },
    { n: 922, status: "active", holder: 1, pending: null, proof: true, key: "received", text: "Получение подтверждено", name: "Оазис" },
    { n: 923, status: "waiting", holder: 1, pending: 2, proof: true, key: "waiting", text: "Ожидает приёма", name: "Оазис" },
    { n: 924, status: "delivered", holder: 2, pending: null, proof: true, key: "received", text: "Получение подтверждено", name: "Карина" },
    { n: 925, status: "completed", holder: 2, pending: null, proof: true, key: "done", text: "Завершена", name: "Карина" },
    { n: 926, status: "active", holder: 1, pending: null, proof: false, key: "received", text: "Получение подтверждено", name: "Оазис" },
    { n: 927, status: "waiting", holder: 0, pending: 3, proof: false, key: "waiting", text: "Ожидает приёма", name: "Вы" },
    { n: 928, status: "active", holder: 0, pending: null, proof: false, key: "ready", text: "Ожидает передачи", name: "Вы" },
  ];
  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-lifecycle-browser", extraEnv: { TANBOT_MAX_ENABLED: "false" } });
    const ids: string[] = [];
    for (const [email, fullName] of [
      ["status-creator@test.local", "Отправитель Тест"],
      ["status-oasis@test.local", "Оазис"],
      ["status-karina@test.local", "Карина"],
    ]) {
      const user = await createTestUser({ databaseUrl: fixture.databaseUrl, email, password: fixture.password, fullName, role: "manager" });
      const client = await getPool()!.connect();
      try { ids.push((await ensurePartyForUserOnWrite(client, user.id, fullName, null)).id); }
      finally { client.release(); }
    }
    ids.push((await getPool()!.query(`INSERT INTO tt_parties(kind,display_name) VALUES('external',$1) RETURNING id`, [longName])).rows[0].id);
    for (const c of cases) {
      const id = `TT-2026-${c.n}`;
      await getPool()!.query(
        `INSERT INTO tt_transfers(id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,
          final_recipient_party_id,first_custody_at,completed_at,delivered_at,handoff_version,row_version,due_at)
         VALUES($1,$1,$2,$3,$4,$5,$6,$7,CASE WHEN $8 THEN NOW() END,
          CASE WHEN $3='completed' THEN NOW() END,CASE WHEN $3='delivered' THEN NOW() END,2,1,
          CASE WHEN $9 THEN NOW()-INTERVAL '2 days' END)`,
        [id, `Проверка ${c.n}`, c.status, ids[0], ids[c.holder], c.pending == null ? null : ids[c.pending], ids[2], c.proof, c.n === 927],
      );
    }
    await getPool()!.query(
      `INSERT INTO tt_audit_log(transfer_id,acting_party_id,action,detail) VALUES('TT-2026-926',$1,'code_verify_ok','{}')`, [ids[1]],
    );
    await getPool()!.query(
      `INSERT INTO tt_transfer_timeline(transfer_id,from_party_id,to_party_id,note)
       VALUES('TT-2026-928',$1,$1,'Подтверждено одноразовым кодом')`, [ids[0]],
    );
  });
  after(async () => { if (fixture) await stopBrowserHttpFixture(fixture); });

  it("shows the matrix without false receipt, holder promotion, truncation or script injection", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${fixture.baseUrl}/login`);
    await page.fill("#email", "status-creator@test.local");
    await page.fill("#password", fixture.password);
    await page.click("#login-button");
    await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/);
    await page.goto(`${fixture.baseUrl}/tan-tracker/`);
    await page.locator('table[data-tt="registry"]').waitFor();
    for (const c of cases) {
      const row = page.locator(`table tr[data-tt-open="TT-2026-${c.n}"]`);
      assert.match(await row.locator(`[data-tt-status="${c.key}"]`).innerText(), new RegExp(c.text));
      assert.equal(await row.locator('[data-tt-holder]').innerText(), c.name);
    }
    assert.match(await page.locator('table tr[data-tt-open="TT-2026-923"]').innerText(), /Карина/);
    assert.equal(await page.locator('table tr[data-tt-open="TT-2026-927"] [data-tt-status="overdue"]').count(), 1);
    assert.equal(await page.locator('table tr[data-tt-open="TT-2026-925"] .tt-custody-next').count(), 0);
    assert.equal(await page.locator('table [onerror]').count(), 0);
    const payload = await (await context.request.get(`${fixture.baseUrl}/api/tan-tracker/bootstrap`)).json();
    assert.equal(payload.orders.find((o: { id: string }) => o.id === "TT-2026-926").hasConfirmedReceipt, true);
    assert.equal(payload.orders.find((o: { id: string }) => o.id === "TT-2026-928").hasConfirmedReceipt, false);
    await page.screenshot({ path: "/home/user/workspace/tandoor-status-matrix-desktop.png", animations: "disabled" });
    await page.locator('.tt-registry-status-chip[data-preset="completed"]').click();
    assert.equal(await page.locator("table tbody tr").count(), 1);
    await page.locator('.tt-registry-status-chip[data-preset="all"]').click();
    await page.locator('[data-tt="search"]').fill("TT-2026-923");
    await page.waitForFunction(() => document.querySelectorAll("table tbody tr").length === 1);
    assert.match(await page.locator("table tbody").innerText(), /Оазис/);
    await page.locator('[data-tt="search"]').fill("");
    await page.waitForFunction(() => document.querySelectorAll("table tbody tr").length === 9);
    await page.setViewportSize({ width: 375, height: 812 });
    for (const c of cases) {
      const card = page.locator(`.tt-card-v2[data-tt-open="TT-2026-${c.n}"]`);
      await card.waitFor({ state: "visible" });
      assert.equal(await card.isVisible(), true);
      assert.match(await card.locator(`[data-tt-status="${c.key}"]`).innerText(), new RegExp(c.text));
      assert.equal(await card.locator('[data-tt-holder]').innerText(), c.name);
      if (c.n === 927) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: "/home/user/workspace/tandoor-status-long-card-mobile.png", animations: "disabled" });
      }
      await card.click();
      await page.locator(`[data-tt="detail"] [data-tt-status="${c.key}"]:visible`).first().waitFor();
      assert.equal(await page.locator(`[data-tt="detail"] [data-tt-status="${c.key}"]:visible`).count() > 0, true);
      assert.equal(await page.locator('[data-tt="detail"] [data-tt-holder]:visible').first().innerText(), c.name);
      if (c.n === 927) {
        assert.match(await page.locator('[data-tt="detail"] [data-tt-status="waiting"]:visible').first().innerText(), /<img src=x/);
        assert.equal(await page.locator('[data-tt="detail"] [onerror]').count(), 0);
        await page.screenshot({ path: "/home/user/workspace/tandoor-status-long-detail-mobile.png", animations: "disabled" });
      }
      if (c.n === 925) await page.screenshot({ path: "/home/user/workspace/tandoor-status-completed-mobile.png", animations: "disabled" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator(c.status === "completed" ? '[data-tt="terminal-back-list"]' : '[data-tt="back-list"]').click();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await page.locator('table tr[data-tt-open="TT-2026-923"] [data-tt-holder]').innerText(), "Оазис");
    assert.deepEqual(errors, []);
    await context.close();
  });
});
