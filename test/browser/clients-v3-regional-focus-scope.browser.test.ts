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

function territoryPath(responsibleGuid: string, kind: "regional" | "manager", extra = ""): string {
  const base =
    `/clients?v3mode=1&v3entity=legal_grouped&view=teams&v3view=teams&v3focus=1&ropEmployee=${ROP}&orgTeamGuid=${TEAM}` +
    `&responsibleGuid=${responsibleGuid}&responsibleKind=${kind}&teamKind=${kind}`;
  return base + extra;
}

function decodeUrl(url: string): string {
  return decodeURIComponent(url);
}

function assertScopeInUrl(url: string, guid: string, kind: string): void {
  const u = new URL(url);
  assert.equal(u.searchParams.get("responsibleGuid"), guid);
  assert.equal(u.searchParams.get("responsibleKind"), kind);
  assert.equal(u.searchParams.get("teamKind"), kind);
}

function assertScopeInApi(url: string, guid: string, kind: string): void {
  const u = new URL(url);
  assert.equal(u.searchParams.get("responsibleGuid"), guid, "list/options must carry responsibleGuid");
  assert.equal(u.searchParams.get("responsibleKind"), kind, "list/options must carry responsibleKind");
}

describe("clients v3 regional focus scope", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let base = "";

  before(async () => {
    const db = getIntegrationDatabaseUrl();
    setIntegrationEnv(db, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(db);
    await seedRegionalScope(db);
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

  async function loginPage(): Promise<Page> {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await p.goto(base + "/login");
    await p.fill("#email", "qa-admin@example.test");
    await p.fill("#password", PW);
    await p.click('button[type="submit"]');
    await p.waitForURL((u) => u.pathname !== "/login");
    return p;
  }

  async function openTerritoryFocus(p: Page, path: string): Promise<void> {
    const listReady = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.goto(base + path);
    await listReady;
    await p.locator('[data-testid="v3-focus-root"]', { timeout: 15000 }).waitFor({ state: "visible" });
    await p.locator(TOP).waitFor({ state: "visible" });
    await p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').first().waitFor();
  }

  async function selectTopAndAssertScope(
    p: Page,
    responsibleGuid: string,
    kind: string,
    topGuid: string,
    expectedTotal: number,
    forbiddenRegional?: string,
  ): Promise<void> {
    assertScopeInUrl(p.url(), responsibleGuid, kind);
    const listWait = p.waitForResponse((r) =>
      r.url().includes("/api/clients/v3/list") &&
      r.status() === 200 &&
      decodeUrl(r.url()).includes(topGuid),
    );
    const optionsWait = p.waitForResponse((r) => r.url().includes("/api/clients/v3/options") && r.status() === 200);
    await p.locator(TOP).selectOption(topGuid);
    const [listRes, optRes] = await Promise.all([listWait, optionsWait]);
    assertScopeInUrl(p.url(), responsibleGuid, kind);
    assertScopeInApi(listRes.url(), responsibleGuid, kind);
    assertScopeInApi(optRes.url(), responsibleGuid, kind);
    const body = (await listRes.json()) as { total: number; items: { guid?: string }[] };
    assert.equal(body.total, expectedTotal);
    if (forbiddenRegional) {
      for (const item of body.items) {
        const guid = String(item.guid || "").toLowerCase();
        assert.ok(
          !guid.includes(forbiddenRegional.slice(0, 8)),
          "other regional portfolio must not appear in scoped list",
        );
      }
    }
  }

  it("direct URL: regional manager keeps scope after TOP filter (1 of 2 in team)", async () => {
    const p = await loginPage();
    await openTerritoryFocus(p, territoryPath(REG_A, "regional"));
    await selectTopAndAssertScope(p, REG_A, "regional", TYPES[0], 1, REG_B);
    await p.close();
  });

  it("manager with v3manager alias keeps scope after TOP filter", async () => {
    const p = await loginPage();
    const path = territoryPath(M1, "manager", `&v3manager=${M1}`);
    await openTerritoryFocus(p, path);
    await selectTopAndAssertScope(p, M1, "manager", TYPES[0], 2);
    await p.close();
  });

  it("reset-empty clears TOP but keeps regional portfolio scope", async () => {
    const p = await loginPage();
    await openTerritoryFocus(p, territoryPath(REG_A, "regional"));
    await selectTopAndAssertScope(p, REG_A, "regional", TYPES[0], 1);
    const resetWait = p.waitForResponse((r) => r.url().includes("/api/clients/v3/list") && r.status() === 200);
    await p.locator("#v3-focus-reset").click();
    const resetRes = await resetWait;
    assertScopeInUrl(p.url(), REG_A, "regional");
    assertScopeInApi(resetRes.url(), REG_A, "regional");
    const body = (await resetRes.json()) as { total: number };
    assert.equal(body.total, 3, "regional portfolio without TOP filter");
    await p.close();
  });
});

async function seedRegionalScope(databaseUrl: string): Promise<void> {
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
        [parsed.roster.sourceSha256, 4],
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
