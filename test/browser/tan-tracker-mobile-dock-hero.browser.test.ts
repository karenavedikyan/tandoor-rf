import assert from "node:assert/strict";
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
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser } from "../helpers/test-db";
import {
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

const IPHONE = devices["iPhone 13"];
const STAFF_EMAIL = "dock-hero-staff@test.local";

type DockFixture = BrowserHttpFixture & {
  estToken: string;
  deliveredTransferId: string;
  pendingTransferId: string;
  internalTransferId: string;
};

const IO_INSTRUMENTATION = `
(() => {
  if (window.__ttDockIoPatched) return;
  window.__ttDockIoPatched = true;
  window.__ttDockTest = { ioTargets: [] };
  const Native = window.IntersectionObserver;
  window.IntersectionObserver = function (cb, opts) {
    const obs = new Native(cb, opts);
    const nativeObserve = obs.observe.bind(obs);
    obs.observe = function (target) {
      const dock = document.querySelector('[data-tt="detail-mobile-dock"]');
      window.__ttDockTest.ioTargets.push({
        inDock: !!(dock && dock.contains(target)),
        tt: target.getAttribute && target.getAttribute("data-tt"),
      });
      return nativeObserve(target);
    };
    return obs;
  };
  window.IntersectionObserver.prototype = Native.prototype;
})();
`;

async function launchEngine(
  engine: BrowserType<Browser>,
  t: { skip: (message?: string) => void },
): Promise<Browser | null> {
  try {
    if (engine === chromium) {
      return await chromium.launch({ headless: true, channel: "chromium" });
    }
    return await webkit.launch({ headless: true });
  } catch (err) {
    t.skip(`${engine.name()} required: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function openDetailById(page: Page, transferId: string): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const proto = (window as unknown as { TanTrackerPrototype?: { orders?: () => Array<{ id: string }> } })
        .TanTrackerPrototype;
      return !!proto?.orders?.().some((o) => o.id === id);
    },
    transferId,
    { timeout: 30000 },
  );
  await page.evaluate((id) => {
    const w = window as unknown as {
      TanTrackerPrototype: { state: { view: string; orderId: string | null } };
      __ttLkRenderTracker?: () => void;
    };
    w.TanTrackerPrototype.state.view = "detail";
    w.TanTrackerPrototype.state.orderId = id;
    w.__ttLkRenderTracker?.();
  }, transferId);
  await page.waitForSelector('[data-tt="detail"]', { timeout: 15000 });
}

async function newMobileContext(browser: Browser, baseUrl: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: baseUrl,
    ...IPHONE,
  });
  await context.addInitScript(IO_INSTRUMENTATION);
  return context;
}

async function measureDockStability(page: Page): Promise<{
  dockMutations: number;
  dockHidden: boolean;
  ioTargets: Array<{ inDock: boolean; tt: string | null }>;
}> {
  return page.evaluate(async () => {
    const dock = document.querySelector('[data-tt="detail-mobile-dock"]');
    let dockMutations = 0;
    let dockHidden = true;
    if (dock) {
      dockHidden = dock.hidden;
      const mo = new MutationObserver(() => {
        dockMutations += 1;
      });
      mo.observe(dock, { attributes: true, attributeFilter: ["hidden", "class"] });
      await new Promise((r) => setTimeout(r, 500));
      mo.disconnect();
      dockHidden = dock.hidden;
    } else {
      await new Promise((r) => setTimeout(r, 500));
    }
    const ioTargets = (window as unknown as { __ttDockTest?: { ioTargets: Array<{ inDock: boolean; tt: string | null }> } })
      .__ttDockTest?.ioTargets ?? [];
    return { dockMutations, dockHidden, ioTargets };
  });
}

function assertNoSelfDockObservation(ioTargets: Array<{ inDock: boolean }>): void {
  assert.ok(
    ioTargets.every((t) => !t.inDock),
    `IntersectionObserver must not target elements inside the mobile dock (got ${JSON.stringify(ioTargets)})`,
  );
}

async function openExternalDeliveredDetail(page: Page, est: string, transferId: string, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/tan-tracker?est=${encodeURIComponent(est)}`);
  await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 30000 });
  await openDetailById(page, transferId);
  await page.waitForSelector('[data-tt="holder-delivered"]', { timeout: 15000 });
}

describe("mobile detail dock hero observer (Chromium + WebKit iPhone)", { concurrency: false }, () => {
  let fixture: DockFixture;

  before(async () => {
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    fixture = (await startBrowserHttpFixture({
      attachmentsDir: "var/tt-mobile-dock-hero-browser",
      extraEnv: {
        TT_OTP_PEPPER: "test-otp-pepper-min-16-chars",
        TT_EXTERNAL_MESSENGER_ENABLED: "true",
      },
    })) as DockFixture;

    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
    const staff = await createTestUser({
      databaseUrl: fixture.databaseUrl,
      email: STAFF_EMAIL,
      password: fixture.password,
      fullName: "Dock Staff",
      role: "manager",
    });
    const staffParty = await ensurePartyForUserOnWrite(pool, staff.id, "Dock Staff", "+79992001001");
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Dock Ext Final', '+79992001002') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const pendingExtParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Dock Pending', '+79992001003') RETURNING id::text`,
      )
    ).rows[0]!.id;

    fixture.deliveredTransferId = "DOCK-DELIVERED-1";
    fixture.pendingTransferId = "DOCK-PENDING-1";
    fixture.internalTransferId = "DOCK-INTERNAL-1";

    const now = new Date();
    await pool.query(
      `INSERT INTO tt_transfers (
         id, public_code, item_title, status, from_external, creator_party_id, holder_party_id,
         pending_party_id, final_recipient_party_id, handoff_version, holder_since
       ) VALUES ($1, $1, 'Delivered final parcel', 'delivered', TRUE, $2, $2, NULL, $2, 2, $3)`,
      [fixture.deliveredTransferId, extParty, now],
    );
    await pool.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, occurred_at)
       VALUES ($1, $2, $3, 'Подтверждено одноразовым кодом', $4)`,
      [fixture.deliveredTransferId, staffParty.id, extParty, now],
    );

    await pool.query(
      `INSERT INTO tt_transfers (
         id, public_code, item_title, status, from_external, creator_party_id, holder_party_id,
         pending_party_id, final_recipient_party_id, handoff_version
       ) VALUES ($1, $1, 'Pending relay parcel', 'waiting', TRUE, $2, $2, $3, $3, 1)`,
      [fixture.pendingTransferId, extParty, pendingExtParty],
    );
    await pool.query(
      `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
       VALUES ($1, 1, $2, $3, 'dock pending snapshot')`,
      [fixture.pendingTransferId, extParty, pendingExtParty],
    );

    await pool.query(
      `INSERT INTO tt_transfers (
         id, public_code, item_title, status, creator_party_id, holder_party_id,
         pending_party_id, final_recipient_party_id, handoff_version
       ) VALUES ($1, $1, 'Internal mobile dock', 'waiting', $2, $2, $3, $3, 1)`,
      [fixture.internalTransferId, staffParty.id, extParty],
    );
    await pool.query(
      `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
       VALUES ($1, 1, $2, $3, 'dock internal snapshot')`,
      [fixture.internalTransferId, staffParty.id, extParty],
    );

    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79992001002', 'Dock Ext Final', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id, notifications_enabled)
       VALUES ($1::uuid, 'telegram', '881001', '881002', TRUE)`,
      [person],
    );
    const client = await pool.connect();
    try {
      fixture.estToken = await createPersonBrowserSession(client, person, "telegram");
    } finally {
      client.release();
      await pool.end();
    }
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  for (const engine of [chromium, webkit] as const) {
    it(`${engine.name()}: external delivered final — stable dock, forward action`, async (t) => {
      const browser = await launchEngine(engine, t);
      if (!browser) return;
      const context = await newMobileContext(browser, fixture.baseUrl);
      const page = await context.newPage();
      try {
        await openExternalDeliveredDetail(page, fixture.estToken, fixture.deliveredTransferId, fixture.baseUrl);
        const metrics = await measureDockStability(page);
        assertNoSelfDockObservation(metrics.ioTargets);
        assert.ok(metrics.dockMutations <= 2, `dock attribute churn ${metrics.dockMutations}`);
        assert.equal(metrics.dockHidden, true);
        assert.equal(await page.locator('[data-tt="detail-mobile-dock"] [data-tt="complete"]:visible').count(), 0);
        await page.click('[data-tt="transfer"]');
        await page.waitForSelector('[data-tt-field="pickQ"]', { timeout: 10000 });
      } finally {
        await context.close();
        await browser.close();
      }
    });

    it(`${engine.name()}: external pending holder — no finish dock`, async (t) => {
      const browser = await launchEngine(engine, t);
      if (!browser) return;
      const context = await newMobileContext(browser, fixture.baseUrl);
      const page = await context.newPage();
      try {
        await page.goto(`${fixture.baseUrl}/tan-tracker?est=${encodeURIComponent(fixture.estToken)}`);
        await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 30000 });
        await openDetailById(page, fixture.pendingTransferId);
        await page.waitForSelector('[data-tt="enter-code"]', { timeout: 15000 });
        const metrics = await measureDockStability(page);
        assertNoSelfDockObservation(metrics.ioTargets);
        assert.equal(await page.locator('[data-tt="detail-mobile-dock"] [data-tt="complete"]').count(), 0);
      } finally {
        await context.close();
        await browser.close();
      }
    });

    it(`${engine.name()}: internal holder — dock tracks main hero without oscillation`, async (t) => {
      const browser = await launchEngine(engine, t);
      if (!browser) return;
      const context = await newMobileContext(browser, fixture.baseUrl);
      const page = await context.newPage();
      try {
        await page.goto(`${fixture.baseUrl}/login`);
        await page.fill("#email", STAFF_EMAIL);
        await page.fill("#password", fixture.password);
        await page.click("#login-button");
        await page.waitForURL(/\/(clients|profile|work|access|admin|tan-tracker)(\/|\?|$)/, { timeout: 25000 });
        await page.goto(`${fixture.baseUrl}/tan-tracker`);
        await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 25000 });
        await openDetailById(page, fixture.internalTransferId);
        await page.waitForSelector('[data-tt="enter-code"]', { timeout: 15000 });
        assert.equal(await page.locator('[data-tt="detail-mobile-dock"]').count(), 1);
        await page.evaluate(() => {
          const root = document.querySelector('[data-tt="detail"]');
          if (!root) return;
          const pad = document.createElement("div");
          pad.setAttribute("data-tt-test", "scroll-pad");
          pad.style.height = "120vh";
          root.appendChild(pad);
          const dock = root.querySelector('[data-tt="detail-mobile-dock"]');
          let hero: Element | null = null;
          root.querySelectorAll("[data-tt-detail-hero-primary]").forEach((el) => {
            if (!dock?.contains(el)) hero = el;
          });
          if (hero) {
            const y = hero.getBoundingClientRect().top + window.scrollY + hero.getBoundingClientRect().height + 120;
            window.scrollTo(0, y);
          }
        });
        await page.waitForTimeout(150);
        const scrolledOut = await measureDockStability(page);
        assertNoSelfDockObservation(scrolledOut.ioTargets);
        assert.ok(scrolledOut.ioTargets.length >= 1);
        assert.ok(scrolledOut.dockMutations <= 4, `dock oscillation ${scrolledOut.dockMutations}`);
        await page.waitForFunction(() => {
          const dock = document.querySelector('[data-tt="detail-mobile-dock"]');
          return !!dock && dock.hidden === false;
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
        const scrolledBack = await measureDockStability(page);
        assert.ok(scrolledBack.dockMutations <= 4);
        await page.waitForFunction(() => {
          const dock = document.querySelector('[data-tt="detail-mobile-dock"]');
          return !!dock && dock.hidden === true;
        });
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
});
