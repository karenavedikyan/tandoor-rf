import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { applyAuthoritativeWholesaleOrgSnapshot } from "../../src/onec-clients/roster-authoritative-org";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const M1 = "22222222-2222-4222-8222-222222222222";
const REG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROP = "55555555-5555-4555-8555-555555555555";
const TEAM = "ab000000-0000-4000-8000-000000000001";
const TYPES = [
  "ee000000-0000-4000-8000-000000000150",
  "ee000000-0000-4000-8000-000000000350",
  "ee000000-0000-4000-8000-000000000500",
];
const CAT = "ee000000-0000-4000-8000-000000000999";
const PW = "SyntheticOnly102!";
const TOP = "#v3-focus-filter-category_name-enum";
const FOCUS_SEARCH = "#v3-focus-search";
const LIST = "/clients?v3mode=1&v3entity=legal_grouped&view=all&v3view=all&v3focus=1";
const SEARCH = "#v3-focus-search";

describe("PR102 focus regression (options race + Esc ctx)", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let base = "";
  const pageErrors: string[] = [];

  before(async () => {
    const db = getIntegrationDatabaseUrl();
    setIntegrationEnv(db, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(db);
    await seedPr102(db);
    browser = await chromium.launch({ headless: true });
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    base = `http://127.0.0.1:${addr.port}`;
    setIntegrationEnv(db, base);
  });

  after(async () => {
    await browser?.close();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await closePool();
    assert.deepEqual(pageErrors, [], "unexpected page exceptions: " + pageErrors.join("; "));
  });

  async function openFocusWarm(p: Page): Promise<void> {
    const listUrl = LIST.replace("&v3focus=1", "");
    const first = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.goto(base + listUrl);
    await first;
    const focused = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.locator('[data-testid="v3-focus-enter"]:visible').click();
    await focused;
    await p.waitForSelector('[data-testid="v3-focus-root"]', { state: "visible" });
    await p.locator(TOP).waitFor({ state: "visible" });
    await p.waitForLoadState("networkidle");
    await p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').first().waitFor();
  }

  async function pageFor(): Promise<Page> {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    p.on("pageerror", (e) => pageErrors.push(e.message));
    await p.goto(base + "/login");
    await p.fill("#email", "qa-admin@example.test");
    await p.fill("#password", PW);
    await p.click('button[type="submit"]');
    await p.waitForURL((u) => u.pathname !== "/login");
    return p;
  }

  it("pending search draft survives metadata repaint and continued native typing", async () => {
    const p = await pageFor();
    let release!: () => void;
    let seen!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const arrived = new Promise<void>((r) => {
      seen = r;
    });
    await p.route("**/api/clients/v3/options?*", async (route) => {
      const res = await route.fetch();
      seen();
      await gate;
      await route.fulfill({ response: res });
    });
    await p.goto(base + LIST);
    await p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').first().waitFor();
    await arrived;
    await p.locator(SEARCH).fill("QA Leg");
    const late = p.waitForResponse((r) => r.url().includes("/api/clients/v3/options"));
    release();
    await (await late).finished();
    await p.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    assert.equal(await p.locator(SEARCH).inputValue(), "QA Leg", "uncommitted draft retained during options update");
    const result = p.waitForResponse(
      (r) => r.url().includes("/api/clients/v3/list") && new URL(r.url()).searchParams.get("q") === "QA Legal 0",
    );
    await p.locator(SEARCH).pressSequentially("al 0");
    assert.equal((await (await result).json()).total, 1);
    await p.close();
  });

  it("direct fullscreen bookmark: delayed options populate TOP enum choices", async () => {
    const p = await pageFor();
    await p.route("**/api/clients/v3/options?*", async (route) => {
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({ response: res });
    });
    await p.goto(base + LIST);
    await p.waitForSelector('[data-testid="v3-focus-root"]', { state: "visible", timeout: 60000 });
    await p.waitForLoadState("networkidle");
    await p.waitForFunction(
      ({ sel, types }) => {
        const values = Array.from(document.querySelectorAll(sel + " option")).map(
          (el) => (el as HTMLOptionElement).value,
        );
        return types.every((t: string) => values.includes(t));
      },
      { sel: TOP, types: TYPES },
      { timeout: 15000 },
    );
    const values = await p.locator(TOP + " option").evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    assert.ok(TYPES.every((t) => values.includes(t)), JSON.stringify({ values }));
    const cacheLen = await p.evaluate(() => window.__lktandoorFilterOptions?.types?.length ?? 0);
    assert.equal(cacheLen, 3);
    await p.close();
  });

  it("cold direct fullscreen bookmark: Esc exits without missing list context", async () => {
    const p = await pageFor();
    await p.goto(base + LIST);
    await p.locator("#v3-focus-exit").waitFor({ state: "visible", timeout: 60000 });
    await p.waitForLoadState("networkidle");
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.body.classList.contains("x14-focus-mode"));
    await p.close();
  });

  it("card back to fullscreen: delayed options still populate TOP enum", async () => {
    const p = await pageFor();
    const listUrl = LIST.replace("&v3focus=1", "");
    const firstList = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.goto(base + listUrl);
    await firstList;
    await p.locator('[data-testid="v3-focus-enter"]:visible').click();
    await p.waitForSelector('[data-testid="v3-focus-root"]', { state: "visible" });
    const link = p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').first();
    await link.click();
    await p.waitForURL((u) => /\/clients\/.+/.test(u.pathname));
    await p.route("**/api/clients/v3/options?*", async (route) => {
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({ response: res });
    });
    const back = p.locator('[data-testid="v3-back-to-list"]:visible');
    const backList = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await back.click();
    await backList;
    await p.waitForSelector(TOP, { state: "visible", timeout: 60000 });
    await p.waitForLoadState("networkidle");
    await p.waitForFunction(
      ({ sel, types }) => {
        const values = Array.from(document.querySelectorAll(sel + " option")).map(
          (el) => (el as HTMLOptionElement).value,
        );
        return types.every((t: string) => values.includes(t));
      },
      { sel: TOP, types: TYPES },
      { timeout: 15000 },
    );
    await p.close();
  });

  it("rapid TOP switching with native selectOption preserves latest filter", async () => {
    const p = await pageFor();
    await openFocusWarm(p);
    for (let round = 0; round < 5; round += 1) {
      const latest = p.waitForResponse(
        (r) =>
          r.url().includes("/api/clients/v3/list") &&
          r.status() === 200 &&
          decodeURIComponent(r.url()).includes(TYPES[2]),
      );
      for (const type of TYPES) {
        await p.locator(TOP).selectOption(type);
      }
      const r = await latest;
      assert.equal((await r.json()).total, 3, `round ${round}`);
      await p.waitForFunction(
        ({ s, v }) => (document.querySelector(s) as HTMLSelectElement)?.value === v,
        { s: TOP, v: TYPES[2] },
      );
      assert.ok(decodeURIComponent(p.url()).includes(TYPES[2]), `round ${round}: URL must keep TOP500`);
      await p.locator(TOP).selectOption("");
      await p.waitForResponse(
        (r) => r.url().includes("/api/clients/v3/list") && r.status() === 200 && !decodeURIComponent(r.url()).includes(TYPES[2]),
      );
    }
    await p.close();
  });

  for (const status of [400, 500, 403] as const) {
    it(`late metadata after list ${status} never resurrects cached rows`, async () => {
      const p = await pageFor();
      await openFocusWarm(p);
      await p.locator(TOP).selectOption(TYPES[0]);
      await p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
      await p.waitForLoadState("networkidle");
      let release!: () => void;
      let seen!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const arrived = new Promise<void>((r) => {
        seen = r;
      });
      await p.route("**/api/clients/v3/options?*", async (route) => {
        const res = await route.fetch();
        seen();
        await gate;
        await route.fulfill({ response: res });
      });
      await p.route("**/api/clients/v3/list?*", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic denied or failed request" }),
        }),
      );
      const failed = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === status);
      await p.locator(FOCUS_SEARCH).fill("NEW_FAILED_CRITERIA");
      await p.waitForTimeout(300);
      await failed;
      await arrived;
      if (status !== 403) {
        await p.locator('[data-testid="v3-focus-error"]').waitFor({ state: "visible", timeout: 15000 });
      }
      const late = p.waitForResponse((r) => r.url().includes("/api/clients/v3/options"));
      release();
      await late;
      await p.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      assert.equal(
        await p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').count(),
        0,
        "cached rows must not reappear after failed list load",
      );
      if (status !== 403) {
        assert.ok(await p.locator('[data-testid="v3-focus-error"]').isVisible());
      } else {
        assert.ok(
          (await p.locator('[data-testid="v3-focus-error"]').count()) > 0 ||
            (await p.locator("#results-state:not(.clients-hidden)").count()) > 0,
        );
      }
      await p.close();
    });
  }
});

async function seedPr102(databaseUrl: string): Promise<void> {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "test/fixtures/onec-exchange-v3/all_clients.json"), "utf8"),
  );
  const retailTemplate = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "test/fixtures/onec-exchange-v3/all_retail.json"), "utf8"),
  )[0];
  const holdings: unknown[] = [];
  const clients: unknown[] = [];
  const retail: unknown[] = [];
  for (let i = 0; i < 9; i++) {
    const holding = `a1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const client = `b2000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const tc = {
      guid_type: TYPES[i % 3],
      name_type: ["ТОП150", "ТОП350", "ТОП500"][i % 3],
      guid_category: CAT,
      name_category: "Категория НЕ ТОП",
    };
    holdings.push({
      guid_holding: holding,
      name_holding: `QA Holding ${i}`,
      type_category: tc,
      managers: { guid_manager: M1, name_manager: "QA Manager One" },
      legal_entities: [],
      retail_outlets: [],
    });
    clients.push({
      ...fixture[0],
      guid_client: client,
      name_client: `QA Legal ${i}`,
      guid_holding: holding,
      type_category: tc,
      guid_manager: M1,
      guid_regional_manager: REG,
      guid_head_of_the_sales_department: ROP,
    });
    retail.push({
      ...retailTemplate,
      guid_store: `c3000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      guid_holding: holding,
      type_category: tc,
    });
  }
  const member = {
    guid_team: TEAM,
    name_team: "QA Team",
    guid_team_leader: ROP,
    name_team_leader: "QA ROP",
  };
  const roster = buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(M1, { name_manager: "QA Manager One", ...member }),
    buildEmployeeRosterEntry(REG, { name_manager: "QA Regional", post: "Региональный менеджер", ...member }),
    buildEmployeeRosterEntry(ROP, { name_manager: "QA ROP", post: "Руководитель отдела продаж", ...member }),
  ]);
  const args = {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    holdingsBytes: Buffer.from(JSON.stringify(holdings)),
    clientsBytes: Buffer.from(JSON.stringify(clients)),
    retailBytes: Buffer.from(JSON.stringify(retail)),
    employeesBytes: roster,
  };
  const dry = await runExchangeV3RegularUpdate({ ...args, argv: ["--dry-run"] });
  assert.equal(dry.status, "SUCCESS");
  await runExchangeV3RegularUpdate({
    ...args,
    argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
  });
  const parsed = parseWholesaleEmployeeRosterBytes(roster);
  assert.ok(parsed.ok);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (parsed.ok) {
      await applyAuthoritativeWholesaleOrgSnapshot(client, parsed.roster);
      await client.query(
        `INSERT INTO onec_wholesale_roster_state(id,source_sha256,employee_count,imported_at)
         VALUES(1,$1,$2,NOW()) ON CONFLICT(id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,employee_count=EXCLUDED.employee_count,imported_at=NOW()`,
        [parsed.roster.sourceSha256, 3],
      );
    }
    await client.query("COMMIT");
  } finally {
    client.release();
    await pool.end();
  }
  const admin = await createTestUser({
    databaseUrl,
    email: "qa-admin@example.test",
    password: PW,
    fullName: "QA Admin",
    role: "admin",
  });
  await linkUserToEmployee({
    databaseUrl,
    userId: admin.id,
    employeeId: M1,
    confirmedByUserId: admin.id,
  });
}
