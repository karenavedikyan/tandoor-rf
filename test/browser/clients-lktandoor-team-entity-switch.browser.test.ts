import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { addRopTeamMember, linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const HW = "77777777-7777-4777-8777-777777777777";
const ROP = "55555555-5555-4555-8555-555555555555";
const ROP_FOREIGN = "66666666-6666-4666-8666-666666666666";
const LEGAL_TWO_LABEL = "Legal Two";
const RETAIL_M2_LABEL = "SYNTH Store M2 Team";
const RETAIL_HW_LABEL = "SYNTH Store HW Regional";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

function clientsBytesForTeamEntitySwitch() {
  const clients = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json"), "utf8")) as Record<
    string,
    unknown
  >[];
  clients.push({
    guid_client: "b2000000-0000-4000-8000-000000000005",
    name_client: "Legal HW Dual Role",
    guid_holding: "a1000000-0000-4000-8000-000000000001",
    name_holding: "SYNTH Holding One",
    type_category: {
      guid_type: "t2",
      name_type: "Type B",
      guid_category: "c2",
      name_category: "Cat B",
    },
    guid_manager: HW,
    name_manager: "Бойко Светлана Петровна",
    guid_hardware_manager: HW,
    name_hardware_manager: "Бойко Светлана Петровна",
    guid_head_of_the_sales_department: ROP,
    name_head_of_the_sales_department: "ROP One",
    address: "SYNTH address dual",
    telephone: [],
    Discount: "",
    DiscountAmount: 0,
    markups: [],
    other: {},
  });
  return Buffer.from(JSON.stringify(clients));
}

function retailBytesForTeamEntitySwitch() {
  const retail = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json"), "utf8")) as Record<
    string,
    unknown
  >[];
  retail.push({
    guid_store: "c3000000-0000-4000-8000-00000000a1",
    guid_holding: "a1000000-0000-4000-8000-000000000001",
    warehouse: false,
    closed: false,
    type_category: {
      guid_type: "rt1",
      name_type: "Retail Type",
      guid_category: "rc1",
      name_category: "Retail Cat",
    },
    address: { store_address: RETAIL_M2_LABEL },
    information_loading: {},
    managers: {
      guid_manager: M2,
      name_manager: "Аветисян Армен Владимирович",
      guid_head_of_the_sales_department: ROP,
      name_head_of_the_sales_department: "ROP One",
    },
    contact_information: {},
    LPR_information: {},
    additional_information: {},
  });
  retail.push({
    guid_store: "c3000000-0000-4000-8000-00000000b2",
    guid_holding: "a1000000-0000-4000-8000-000000000001",
    warehouse: false,
    closed: false,
    type_category: {
      guid_type: "rt1",
      name_type: "Retail Type",
      guid_category: "rc1",
      name_category: "Retail Cat",
    },
    address: { store_address: RETAIL_HW_LABEL },
    information_loading: {},
    managers: {
      guid_manager: HW,
      name_hardware_manager: "Бойко Светлана Петровна",
      guid_head_of_the_sales_department: ROP,
      name_head_of_the_sales_department: "ROP One",
    },
    contact_information: {},
    LPR_information: {},
    additional_information: {},
  });
  return Buffer.from(JSON.stringify(retail));
}

async function closePageSafely(page: Page) {
  await page.unrouteAll({ behavior: "wait" });
  await page.close();
}

async function seed(databaseUrl: string) {
  const admin = await createTestUser({
    databaseUrl,
    email: "admin-team-entity-switch@example.com",
    password: TEST_PASSWORD,
    fullName: "Admin Team Entity Switch",
    role: "admin",
  });
  const director = await createTestUser({
    databaseUrl,
    email: "director-team-entity-switch@example.com",
    password: TEST_PASSWORD,
    fullName: "Director Team Entity Switch",
    role: "director",
  });
  await linkUserToEmployee({
    databaseUrl,
    userId: director.id,
    employeeId: M1,
    confirmedByUserId: admin.id,
  });
  const ropUser = await createTestUser({
    databaseUrl,
    email: "rop-team-entity-switch@example.com",
    password: TEST_PASSWORD,
    fullName: "ROP Team Entity Switch",
    role: "rop",
  });
  await linkUserToEmployee({
    databaseUrl,
    userId: ropUser.id,
    employeeId: ROP,
    confirmedByUserId: admin.id,
  });
  const managerUser = await createTestUser({
    databaseUrl,
    email: "manager-team-entity-switch@example.com",
    password: TEST_PASSWORD,
    fullName: "Manager Team Entity Switch",
    role: "manager",
  });
  await linkUserToEmployee({
    databaseUrl,
    userId: managerUser.id,
    employeeId: M2,
    confirmedByUserId: admin.id,
  });
  await addRopTeamMember({
    databaseUrl,
    ropUserId: ropUser.id,
    memberUserId: managerUser.id,
    createdByUserId: admin.id,
  });
  const employeesBytes = buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(ROP_FOREIGN, {
      name_manager: "ROP Foreign First",
      post: "Руководитель отдела продаж",
    }),
    buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
    buildEmployeeRosterEntry(M2, { name_manager: "Аветисян Армен Владимирович" }),
    buildEmployeeRosterEntry(HW, { name_manager: "Бойко Светлана Петровна" }),
    buildEmployeeRosterEntry(ROP, { name_manager: "ROP One", post: "Руководитель отдела продаж" }),
  ]);
  const holdingsBytes = fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json"));
  const clientsBytes = clientsBytesForTeamEntitySwitch();
  const retailBytes = retailBytesForTeamEntitySwitch();
  const dry = await runExchangeV3RegularUpdate({
    env: { ...process.env, DATABASE_URL: databaseUrl },
    argv: ["--dry-run"],
    holdingsBytes,
    clientsBytes,
    retailBytes,
    employeesBytes,
  });
  assert.equal(dry.status, "SUCCESS");
  await runExchangeV3RegularUpdate({
    env: { ...process.env, DATABASE_URL: databaseUrl },
    argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
    holdingsBytes,
    clientsBytes,
    retailBytes,
    employeesBytes,
  });
}

describe("lktandoor team territory entity switch after detail back", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    process.env.PGSSLMODE = "disable";
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await seed(databaseUrl);
    const { createApp } = await import("../../src/server");
    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const addr = appServer!.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  });

  after(async () => {
    await browser?.close();
    if (appServer) {
      await new Promise<void>((resolve, reject) =>
        appServer!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await closePool();
  });

  async function login(page: Page, email: string) {
    await page.goto(baseUrl + "/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile", { timeout: 30000 });
  }

  async function waitListSettled(page: Page) {
    await page.waitForFunction(
      () => {
        const stateEl = document.getElementById("clients-results-state");
        if (stateEl && !stateEl.classList.contains("clients-hidden")) {
          const text = (stateEl.textContent || "").trim();
          if (/Загрузка/i.test(text)) return false;
        }
        const body = document.getElementById("clients-table-body");
        if (!body) return false;
        if (body.getAttribute("aria-busy") === "true") return false;
        const rows = body.querySelectorAll("tr").length;
        const cards = document.querySelectorAll(".x13-client-card").length;
        if (rows > 0 || cards > 0) return true;
        if (stateEl && !stateEl.classList.contains("clients-hidden")) {
          const text = (stateEl.textContent || "").trim();
          if (/Нет записей|Ничего не найдено/i.test(text)) return true;
        }
        return false;
      },
      undefined,
      { timeout: 30000 },
    );
  }

  async function assertVisibleListRow(page: Page, label: string) {
    await waitListSettled(page);
    const row = page.locator("#clients-table-body tr, .x13-client-card").filter({ hasText: label });
    await row.first().waitFor({ state: "visible", timeout: 30000 });
    assert.ok((await row.count()) > 0, "expected visible row: " + label);
  }

  async function openRopManagerTerritory(page: Page) {
    await login(page, "rop-team-entity-switch@example.com");
    await page.goto(baseUrl + "/clients?view=teams");
    await page.waitForURL((url) => url.search.includes("ropEmployee=" + ROP), { timeout: 30000 });
    await page.waitForSelector('.x13-person[data-manager="' + M2 + '"]', { timeout: 30000 });
    const managerRow = page.locator('.x13-person[data-manager="' + M2 + '"][data-responsible-kind="manager"]');
    await managerRow.first().click();
    await page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await assertVisibleListRow(page, LEGAL_TWO_LABEL);
    assert.ok(page.url().includes("responsibleGuid=" + M2));
    assert.match(page.url(), /v3entity=legal_grouped/);
  }

  async function backFromLegalCard(page: Page) {
    await page.locator("#clients-table-body tr a").first().click();
    await page.waitForURL((url) => /^\/clients\/[^/?#]+/.test(url.pathname), { timeout: 30000 });
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL(
      (url) => url.pathname === "/clients" && url.search.includes("responsibleGuid=" + M2),
      { timeout: 30000 },
    );
    await assertVisibleListRow(page, LEGAL_TWO_LABEL);
  }

  function parseListRequest(url: string) {
    const parsed = new URL(url, baseUrl);
    return {
      entity: parsed.searchParams.get("entity"),
      responsibleGuid: parsed.searchParams.get("responsibleGuid"),
      ropBranchGuid: parsed.searchParams.get("ropBranchGuid"),
    };
  }

  it("after legal card back: scope bar and primary switcher toggle retail and back", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openRopManagerTerritory(page);
    await backFromLegalCard(page);

    const scopeRetailResponse = page.waitForResponse(
      (res) => {
        if (!res.url().includes("/api/clients/v3/list") || res.status() !== 200) return false;
        const req = parseListRequest(res.url());
        return req.entity === "retail" && req.responsibleGuid === M2 && req.ropBranchGuid === ROP;
      },
      { timeout: 30000 },
    );
    await page.locator('[data-v3-scope-entity="retail"]').click();
    const scopeList = await scopeRetailResponse;
    const scopeBody = (await scopeList.json()) as { total: number; items: unknown[] };
    assert.ok(scopeBody.total > 0, "scope retail total");
    assert.ok(scopeBody.items.length > 0, "scope retail items");
    await assertVisibleListRow(page, RETAIL_M2_LABEL);
    assert.match(page.url(), /v3entity=retail/);
    assert.ok(page.url().includes("responsibleGuid=" + M2));
    assert.ok(page.url().includes("ropEmployee=" + ROP));

    const primaryLegalResponse = page.waitForResponse(
      (res) => {
        if (!res.url().includes("/api/clients/v3/list") || res.status() !== 200) return false;
        const req = parseListRequest(res.url());
        return req.entity === "legal_grouped" && req.responsibleGuid === M2;
      },
      { timeout: 30000 },
    );
    await page.locator('.clients-entity-switcher--primary button[data-v3entity="legal_grouped"]').click();
    await primaryLegalResponse;
    await assertVisibleListRow(page, LEGAL_TWO_LABEL);
    assert.match(page.url(), /v3entity=legal_grouped/);

    const primaryRetailResponse = page.waitForResponse(
      (res) => {
        if (!res.url().includes("/api/clients/v3/list") || res.status() !== 200) return false;
        return parseListRequest(res.url()).entity === "retail";
      },
      { timeout: 30000 },
    );
    await page.locator('.clients-entity-switcher--primary button[data-v3entity="retail"]').click();
    await primaryRetailResponse;
    await assertVisibleListRow(page, RETAIL_M2_LABEL);
    assert.match(page.url(), /v3entity=retail/);

    await page.locator("#clients-table-body tr a, .x13-client-card").first().click();
    await page.waitForURL((url) => /^\/clients\/[^/?#]+/.test(url.pathname), { timeout: 30000 });
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL((url) => url.search.includes("v3entity=retail"), { timeout: 30000 });
    await assertVisibleListRow(page, RETAIL_M2_LABEL);

    await page.locator('[data-v3-scope-entity="legal"]').click();
    await assertVisibleListRow(page, LEGAL_TWO_LABEL);
    await page.goBack();
    await assertVisibleListRow(page, RETAIL_M2_LABEL);
    await page.goForward();
    await assertVisibleListRow(page, LEGAL_TWO_LABEL);
    await page.reload();
    await waitListSettled(page);
    assert.ok(page.url().includes("responsibleGuid=" + M2));
    assert.ok(page.url().includes("ropEmployee=" + ROP));

    await closePageSafely(page);
  });

  it("director regional hardware territory switches entities after card back", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "director-team-entity-switch@example.com");
    await page.goto(baseUrl + "/clients?v3mode=1&v3view=teams&view=teams");
    await page.locator('[data-open-rop-team="' + ROP + '"]').click();
    await page.waitForURL((url) => url.search.includes("ropEmployee=" + ROP), { timeout: 30000 });
    await page.locator('.x13-person[data-manager="' + HW + '"]').first().click();
    await page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await assertVisibleListRow(page, "Legal HW Dual Role");
    await page.locator("#clients-table-body tr a").first().click();
    await page.waitForURL((url) => /^\/clients\/[^/?#]+/.test(url.pathname), { timeout: 30000 });
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL((url) => url.search.includes("responsibleGuid=" + HW), { timeout: 30000 });

    await page.locator('[data-v3-scope-entity="retail"]').click();
    await page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=retail") &&
        res.url().includes("responsibleGuid=" + HW) &&
        res.status() === 200,
      { timeout: 30000 },
    );
    await assertVisibleListRow(page, RETAIL_HW_LABEL);
    assert.match(page.url(), /v3entity=retail/);

    await page.locator('.clients-entity-switcher--primary button[data-v3entity="legal_grouped"]').click();
    await assertVisibleListRow(page, "Legal HW Dual Role");
    await closePageSafely(page);
  });

  it("manager own portfolio primary switcher keeps non-empty retail list", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "manager-team-entity-switch@example.com");
    await page.goto(baseUrl + "/clients?v3mode=1&v3entity=legal_grouped");
    await assertVisibleListRow(page, LEGAL_TWO_LABEL);
    await page.locator("#clients-table-body tr a").first().click();
    await page.waitForURL((url) => /^\/clients\/[^/?#]+/.test(url.pathname), { timeout: 30000 });
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await assertVisibleListRow(page, LEGAL_TWO_LABEL);

    await page.locator('.clients-entity-switcher--primary button[data-v3entity="retail"]').click();
    await page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("entity=retail") && res.status() === 200,
      { timeout: 30000 },
    );
    await assertVisibleListRow(page, RETAIL_M2_LABEL);
    assert.match(page.url(), /v3entity=retail/);
    assert.ok(!page.url().includes("ropEmployee="));
    await closePageSafely(page);
  });
});
