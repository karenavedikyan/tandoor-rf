import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, devices } from "playwright";
import { Pool } from "pg";
import {
  startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { createTestUser } from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";

describe("independent: external holder mobile dock never observes itself", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  let est = "";
  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/independent-dock-review",
      extraEnv: { TT_EXTERNAL_MESSENGER_ENABLED: "true" },
    });
    const staff = await createTestUser({
      databaseUrl: fixture.databaseUrl, email: "dock@test.local",
      password: fixture.password, fullName: "Synthetic Sender", role: "manager",
    });
    const pool = new Pool({ connectionString: fixture.databaseUrl });
    try {
      const staffParty = await ensurePartyForUserOnWrite(pool, staff.id, "Synthetic Sender", null);
      const party = (await pool.query(
        `INSERT INTO tt_parties(kind,display_name,phone_e164)
         VALUES('external','Synthetic Holder','+79990000333') RETURNING id`,
      )).rows[0].id;
      const person = (await pool.query(
        `INSERT INTO tt_external_persons(party_id,display_name,phone_e164)
         VALUES($1,'Synthetic Holder','+79990000333') RETURNING id`, [party],
      )).rows[0].id;
      await pool.query(
        `INSERT INTO tt_external_person_verifications
         (person_id,channel,messenger_user_id,messenger_chat_id)
         VALUES($1,'max','123456','-654321')`, [person],
      );
      await pool.query(
        `INSERT INTO tt_transfers
         (id,public_code,item_title,status,creator_party_id,holder_party_id,
          final_recipient_party_id,handoff_version,first_custody_at)
         VALUES('DOCKLOCAL01','DOCKLOCAL01','Synthetic parcel','delivered',$1,$2,$2,2,NOW())`,
        [staffParty.id, party],
      );
      const c = await pool.connect();
      try { est = await createPersonBrowserSession(c, person, "max"); }
      finally { c.release(); }
    } finally { await pool.end(); }
  });
  after(async () => { if (fixture) await stopBrowserHttpFixture(fixture); });

  for (const engine of [chromium, webkit]) {
    it(`${engine.name()}: stable delivered external actions, no self-observation`, async () => {
      const browser = engine === chromium ? fixture.browser : await webkit.launch({ headless: true });
      const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: fixture.baseUrl });
      const page = await context.newPage();
      try {
        await page.addInitScript(() => {
          const w = window as any;
          w.__dockObserved = [];
          w.__dockToggles = 0;
          const Native = window.IntersectionObserver;
          window.IntersectionObserver = class extends Native {
            observe(target: Element) {
              w.__dockObserved.push({
                self: !!target.closest('[data-tt="detail-mobile-dock"]'),
              });
              return super.observe(target);
            }
          };
          new MutationObserver((records) => {
            for (const r of records) {
              if ((r.target as Element).matches?.('[data-tt="detail-mobile-dock"]')) w.__dockToggles++;
            }
          }).observe(document, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
        });
        let mutationRequests = 0;
        page.on("request", (req) => { if (req.method() !== "GET") mutationRequests++; });
        await page.goto(`${fixture.baseUrl}/tan-tracker/?est=${encodeURIComponent(est)}&tt_order=DOCKLOCAL01&tt_screen=detail`);
        await page.waitForFunction(() => !!(window as any).__TT_EXTERNAL_PERSON__, { timeout: 10000 });
        console.log(engine.name(), "bootstrap", await page.evaluate(() => ({
          external: !!(window as any).__TT_EXTERNAL_PERSON__,
          orders: ((window as any).__TT_LK_BOOTSTRAP__?.orders || []).map((x: any) => x.id),
          view: (window as any).TanTrackerPrototype?.state?.view,
          error: document.getElementById("tt-state-panel")?.textContent,
        })));
        await page.locator('[data-tt="holder-delivered"]').waitFor({ timeout: 10000 });
        await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));
        const observed = await page.evaluate(() => ({
          targets: (window as any).__dockObserved as Array<{ self: boolean }>,
          toggles: (window as any).__dockToggles as number,
        }));
        console.log(engine.name(), "dock observations", JSON.stringify(observed));
        assert.equal(observed.targets.some((x) => x.self), false, "Dock must never observe its own descendant");
        assert.ok(observed.toggles <= 3, "No hide/show feedback loop");
        assert.equal(await page.locator('[data-tt="holder-delivered"] [data-tt="transfer"]').isVisible(), true);
        assert.equal(mutationRequests, 0, "Rendering must not mutate canonical transfer");
        await page.screenshot({ path: join(tmpdir(), `tandoor-dock-${engine.name()}-verified.png`) });
        await page.locator('[data-tt="holder-delivered"] [data-tt="transfer"]').click();
        await page.locator('[data-tt-field="pickQ"]').waitFor({ timeout: 10000 });
        assert.equal(mutationRequests, 0, "Opening forward UI must not apply handoff");
      } finally {
        await context.close();
        if (engine !== chromium) await browser.close();
      }
    });
  }
});
