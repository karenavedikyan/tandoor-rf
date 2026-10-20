import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runAuthoritativeWholesaleOrgRebuild } from "../../src/onec-clients/run-authoritative-org-rebuild";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { buildFullFlatOrgHierarchyRosterBytes, FLAT_ORG } from "../helpers/flat-org-hierarchy-fixtures";

const TEST_PASSWORD = "StrongPass123!";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const FOREIGN = FLAT_ORG.KOMKOV;

function authoritativeEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PGSSLMODE: "disable",
    TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT: "1",
  };
}

function morozovaPortfolioClientsBytes(): Buffer {
  const base = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json"), "utf8")) as Record<
    string,
    unknown
  >[];
  const extra = [
    {
      guid_client: "b2000000-0000-4000-8000-0000000000a1",
      name_client: "Morozova Manager Client",
      guid_holding: "",
      name_holding: "",
      type_category: { guid_type: "t1", name_type: "Type A", guid_category: "c1", name_category: "Cat A" },
      guid_manager: FLAT_ORG.MOROZOVA,
      name_manager: "Morozova Leader",
      guid_head_of_the_sales_department: FLAT_ORG.GUSLEVA,
      name_head_of_the_sales_department: "Gusleva Leader",
      address: "Morozova mgr",
      telephone: [],
      Discount: "",
      DiscountAmount: 0,
      markups: [],
      other: {},
    },
    {
      guid_client: "b2000000-0000-4000-8000-0000000000a2",
      name_client: "Morozova Regional Client",
      guid_holding: "",
      name_holding: "",
      type_category: { guid_type: "t2", name_type: "Type B", guid_category: "c2", name_category: "Cat B" },
      guid_regional_manager: FLAT_ORG.MOROZOVA,
      name_regional_manager: "Morozova Leader",
      guid_head_of_the_sales_department: FLAT_ORG.GUSLEVA,
      name_head_of_the_sales_department: "Gusleva Leader",
      address: "Morozova reg",
      telephone: [],
      Discount: "",
      DiscountAmount: 0,
      markups: [],
      other: {},
    },
    {
      guid_client: "b2000000-0000-4000-8000-0000000000ff",
      name_client: "Foreign Komkov Client",
      guid_holding: "",
      name_holding: "",
      type_category: { guid_type: "t1", name_type: "Type A", guid_category: "c1", name_category: "Cat A" },
      guid_manager: FOREIGN,
      name_manager: "Komkov Leader",
      guid_head_of_the_sales_department: FLAT_ORG.GUSLEVA,
      name_head_of_the_sales_department: "Gusleva Leader",
      address: "Foreign",
      telephone: [],
      Discount: "",
      DiscountAmount: 0,
      markups: [],
      other: {},
    },
  ];
  return Buffer.from(JSON.stringify([...base, ...extra]));
}

function morozovaPortfolioRetailBytes(): Buffer {
  const base = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json"), "utf8")) as unknown[];
  const extra = [
    {
      guid_store: "c3000000-0000-4000-8000-0000000000a1",
      guid_holding: "",
      warehouse: false,
      closed: false,
      type_category: {},
      address: { store_address: "Portfolio Manager TT" },
      managers: { guid_manager: FLAT_ORG.MOROZOVA },
    },
    {
      guid_store: "c3000000-0000-4000-8000-0000000000a2",
      guid_holding: "",
      warehouse: false,
      closed: false,
      type_category: {},
      address: { store_address: "Portfolio Regional TT" },
      managers: { guid_regional_manager: FLAT_ORG.MOROZOVA },
    },
    {
      guid_store: "c3000000-0000-4000-8000-0000000000ff",
      guid_holding: "",
      warehouse: false,
      closed: false,
      type_category: {},
      address: { store_address: "Foreign Portfolio TT" },
      managers: { guid_manager: FOREIGN },
    },
  ];
  return Buffer.from(JSON.stringify([...base, ...extra]));
}

describe("apex catalog employee portfolio navigation", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin-apex-catalog@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Apex Catalog",
      role: "admin",
    });

    const rosterBytes = buildFullFlatOrgHierarchyRosterBytes();
    const dryOrg = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes,
    });
    assert.equal(dryOrg.status, "SUCCESS", dryOrg.message);
    await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: [
        "--apply",
        "--employee-roster",
        "/dev/null",
        "--expected-roster-sha256",
        dryOrg.rosterSourceSha256!,
        "--confirm-target-db",
        dryOrg.targetDbFingerprint!,
      ],
      rosterBytes,
    });

    const employeesBytes = buildFullFlatOrgHierarchyRosterBytes();
    const dryV3 = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: morozovaPortfolioClientsBytes(),
      retailBytes: morozovaPortfolioRetailBytes(),
      employeesBytes,
    });
    assert.equal(dryV3.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dryV3.verificationFingerprint!],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: morozovaPortfolioClientsBytes(),
      retailBytes: morozovaPortfolioRetailBytes(),
      employeesBytes,
    });

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

  async function login(page: Page) {
    await page.goto(`${baseUrl}/login`);
    await page.fill('input[name="email"]', "admin-apex-catalog@example.com");
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/clients" || url.pathname === "/profile", {
      timeout: 30000,
    });
  }

  it("union portfolio counts match list and exclude foreign assignments", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);
    await page.goto(`${baseUrl}/clients?view=teams&v3mode=1&v3entity=legal_grouped&v3view=teams`);
    const morozovaSelector =
      '[data-open-catalog-portfolio][data-employee-guid="' + FLAT_ORG.MOROZOVA + '"]';
    await page.waitForSelector(morozovaSelector, { timeout: 30000 });
    const cardText = await page.locator(morozovaSelector).innerText();
    assert.match(cardText, /2\s+клиентов/);

    const summaryResponse = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/scope-summary") && res.url().includes("employeePortfolioGuid=" + FLAT_ORG.MOROZOVA),
      { timeout: 30000 },
    );
    const listResponse = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.url().includes("employeePortfolioGuid"),
      { timeout: 30000 },
    );
    await page.locator(morozovaSelector).click();
    const listRes = await listResponse;
    const listBody = (await listRes.json()) as { total: number; items: Array<{ name?: string }> };
    assert.equal(listBody.total, 2);
    const names = listBody.items.map((item) => item.name || "").join(" ");
    assert.match(names, /Morozova Manager Client/);
    assert.match(names, /Morozova Regional Client/);
    assert.doesNotMatch(names, /Foreign Komkov Client/);
    const summary = (await (await summaryResponse).json()) as {
      legal: number;
      retail: number;
    };
    assert.equal(summary.legal, 2);
    assert.equal(summary.retail, 2);

    await page.waitForSelector("table tbody tr:visible, .clients-card:visible, .x13-client-card:visible", { timeout: 30000 });
    await page.locator(
      'a.clients-link--secondary[href*="b2000000-0000-4000-8000-0000000000a1"]:visible, .x13-client-card[data-list-href*="b2000000-0000-4000-8000-0000000000a1"]:visible',
    ).first().click();
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL(
      (url) => url.pathname === "/clients" && url.searchParams.get("orgCatalogEntry") === "employee_portfolio",
      { timeout: 30000 },
    );
    await page.reload();
    assert.match(page.url(), /orgCatalogEntry=employee_portfolio/);
    const outletResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients/v3/list") &&
        res.url().includes("entity=retail") &&
        res.url().includes("employeePortfolioGuid=" + FLAT_ORG.MOROZOVA),
      { timeout: 30000 },
    );
    const outletUrl = new URL(page.url());
    outletUrl.searchParams.set("v3entity", "retail");
    outletUrl.searchParams.set("entity", "outlets");
    await page.goto(outletUrl.toString());
    const outletBody = (await (await outletResponse).json()) as { total: number; items: unknown[] };
    assert.equal(outletBody.total, 2);
    const outletRows = JSON.stringify(outletBody.items);
    assert.match(outletRows, /Portfolio Manager TT/);
    assert.match(outletRows, /Portfolio Regional TT/);
    assert.doesNotMatch(outletRows, /Foreign Portfolio TT/);
    await page.locator('[data-testid="v3-lktandoor-back"]').click();
    await page.waitForURL((url) => !url.searchParams.get("orgCatalogEntry"), { timeout: 30000 });
    await page.waitForSelector(morozovaSelector, { timeout: 30000 });
    await page.close();
  });
});
