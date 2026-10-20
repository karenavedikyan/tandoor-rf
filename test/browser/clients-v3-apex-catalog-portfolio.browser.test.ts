import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runAuthoritativeWholesaleOrgRebuild } from "../../src/onec-clients/run-authoritative-org-rebuild";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { buildFullFlatOrgHierarchyRosterBytes, FLAT_ORG } from "../helpers/flat-org-hierarchy-fixtures";

const TEST_PASSWORD = "StrongPass123!";

function authoritativeEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PGSSLMODE: "disable",
    TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT: "1",
  };
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
    const dry = await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: ["--dry-run", "--employee-roster", "/dev/null"],
      rosterBytes,
    });
    assert.equal(dry.status, "SUCCESS", dry.message);
    await runAuthoritativeWholesaleOrgRebuild({
      env: authoritativeEnv(databaseUrl),
      argv: [
        "--apply",
        "--employee-roster",
        "/dev/null",
        "--expected-roster-sha256",
        dry.rosterSourceSha256!,
        "--confirm-target-db",
        dry.targetDbFingerprint!,
      ],
      rosterBytes,
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

  it("opens employee portfolio from apex catalog row and returns to teams root", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);
    await page.goto(`${baseUrl}/clients?view=teams&v3mode=1&v3entity=legal_grouped&v3view=teams`);
    const morozovaSelector =
      '[data-open-catalog-portfolio][data-employee-guid="' + FLAT_ORG.MOROZOVA + '"]';
    await page.waitForSelector(morozovaSelector, { timeout: 30000 });
    const listRequest = page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await page.locator(morozovaSelector).click();
    await listRequest;
    await page.waitForURL(
      (url) =>
        url.searchParams.get("orgCatalogEntry") === "employee_portfolio" &&
        url.searchParams.get("responsibleGuid") === FLAT_ORG.MOROZOVA,
      { timeout: 30000 },
    );
    assert.equal(page.url().includes("ropEmployee="), false);
    await page.click("#clients-breadcrumbs-back");
    await page.waitForURL((url) => url.pathname.includes("/clients") && !url.searchParams.get("orgCatalogEntry"), {
      timeout: 30000,
    });
    assert.equal(page.url().includes("view=teams"), true);
    await page.close();
  });
});
