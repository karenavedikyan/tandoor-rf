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
const REG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HW_A = "cc000000-0000-4000-8000-000000000001";
const HW_B = "cc000000-0000-4000-8000-000000000002";
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
const NOMATCH = "__pr103_nomatch__";

function territoryPath(responsibleGuid: string, kind: "regional" | "manager" | "hardware"): string {
  return (
    `/clients?v3mode=1&v3entity=legal_grouped&view=teams&v3view=teams&v3focus=1&ropEmployee=${ROP}&orgTeamGuid=${TEAM}` +
    `&responsibleGuid=${responsibleGuid}&responsibleKind=${kind}&teamKind=${kind}`
  );
}

function assertTopInUrl(url: string, typeGuid: string, label: string): void {
  const u = new URL(url);
  assert.equal(u.searchParams.get("v3type"), typeGuid, `${label}: v3type`);
  const filters = u.searchParams.get("filters") || "";
  assert.ok(decodeURIComponent(filters).includes(typeGuid), `${label}: filters.typeGuid`);
}

describe("PR103 ROP Escape keeps latest TOP filter", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let base = "";

  before(async () => {
    const db = getIntegrationDatabaseUrl();
    setIntegrationEnv(db, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(db);
    await seedPr103(db);
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
  });

  async function loginRop(): Promise<Page> {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await p.goto(base + "/login");
    await p.fill("#email", "qa-rop@example.test");
    await p.fill("#password", PW);
    await p.click('button[type="submit"]');
    await p.waitForURL((u) => u.pathname !== "/login");
    return p;
  }

  async function waitScopedList(p: Page, typeGuid: string): Promise<{ total: number }> {
    const res = await p.waitForResponse((r) => {
      if (!r.url().includes("/api/clients/v3/list") || r.status() !== 200) {
        return false;
      }
      return decodeURIComponent(r.url()).includes(typeGuid);
    });
    return (await res.json()) as { total: number };
  }

  async function runRopEscSequence(
    p: Page,
    subjectGuid: string,
    kind: "regional" | "manager" | "hardware",
    portfolioTotal: number,
    top150Total: number,
  ): Promise<void> {
    const listReady = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.goto(base + territoryPath(subjectGuid, kind));
    await listReady;

    for (const typeGuid of TYPES) {
      const wait = p.waitForResponse((r) =>
        r.url().includes("/api/clients/v3/list") && r.status() === 200 && decodeURIComponent(r.url()).includes(typeGuid),
      );
      await p.locator(TOP).selectOption(typeGuid);
      const body = (await (await wait).json()) as { total: number };
      assert.ok(body.total >= 0, `list for ${typeGuid}`);
    }
    assertTopInUrl(p.url(), TYPES[2], "after rapid TOP500");

    const searchWait = p.waitForResponse(
      (r) =>
        r.url().includes("/api/clients/v3/list") &&
        r.status() === 200 &&
        new URL(r.url()).searchParams.get("q") === NOMATCH,
    );
    await p.locator(FOCUS_SEARCH).fill(NOMATCH);
    const searchBody = (await (await searchWait).json()) as { total: number };
    assert.equal(searchBody.total, 0);

    const resetWait = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.locator("#v3-focus-reset-empty").click();
    const resetBody = (await (await resetWait).json()) as { total: number };
    assert.equal(resetBody.total, portfolioTotal);

    const top150Wait = p.waitForResponse((r) =>
      r.url().includes("/api/clients/v3/list") && r.status() === 200 && decodeURIComponent(r.url()).includes(TYPES[0]),
    );
    await p.locator(TOP).selectOption(TYPES[0]);
    const top150Body = (await (await top150Wait).json()) as { total: number };
    assert.equal(top150Body.total, top150Total);
    assertTopInUrl(p.url(), TYPES[0], "before Esc");

    const exitList = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.keyboard.press("Escape");
    await exitList;
    assertTopInUrl(p.url(), TYPES[0], "after Esc");
    await p.waitForFunction(() => !document.body.classList.contains("x14-focus-mode"));
    assert.equal(await p.locator('[data-testid="v3-focus-root"]').isVisible(), false);
  }

  for (const [kind, subject, portfolio, top150] of [
    ["regional", REG_A, 3, 1],
    ["manager", M1, 6, 2],
    ["hardware", HW_A, 3, 1],
  ] as const) {
    it(`ROP actor ${kind}: search/reset/reselect150/Esc keeps TOP150 in URL`, async () => {
      const p = await loginRop();
      await runRopEscSequence(p, subject, kind, portfolio, top150);
      await p.close();
    });
  }
});

async function seedPr103(databaseUrl: string): Promise<void> {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "test/fixtures/onec-exchange-v3/all_clients.json"), "utf8"),
  );
  const retailTemplate = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "test/fixtures/onec-exchange-v3/all_retail.json"), "utf8"),
  )[0];
  const holdings: unknown[] = [];
  const clients: unknown[] = [];
  const retail: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    const holding = `a1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const client = `b2000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const regional = i < 3 ? REG_A : REG_B;
    const hardware = i < 3 ? HW_A : HW_B;
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
      guid_regional_manager: regional,
      guid_hardware_manager: hardware,
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
    buildEmployeeRosterEntry(REG_A, { name_manager: "QA Regional A", post: "Региональный менеджер", ...member }),
    buildEmployeeRosterEntry(REG_B, { name_manager: "QA Regional B", post: "Региональный менеджер", ...member }),
    buildEmployeeRosterEntry(HW_A, { name_manager: "QA Hardware A", post: "Менеджер по фурнитуре", ...member }),
    buildEmployeeRosterEntry(HW_B, { name_manager: "QA Hardware B", post: "Менеджер по фурнитуре", ...member }),
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
        [parsed.roster.sourceSha256, 6],
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
  const ropUser = await createTestUser({
    databaseUrl,
    email: "qa-rop@example.test",
    password: PW,
    fullName: "QA ROP User",
    role: "rop",
  });
  await linkUserToEmployee({
    databaseUrl,
    userId: ropUser.id,
    employeeId: ROP,
    confirmedByUserId: admin.id,
  });
}
