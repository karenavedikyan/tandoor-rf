import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { Pool } from "pg";
import { runCleanReload } from "../../src/onec-clean-reload/clean-reload";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import { writeCleanReloadBundleDir } from "../helpers/onec-clean-reload-fixtures";
import { validateClientsForApplyTest } from "../helpers/onec-clients-extended-fixtures";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import {
  catalogEntriesFromXmlSet,
  buildMinimalCatalogXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { EXTENDED_FIXTURE_GUIDS } from "../helpers/onec-clients-extended-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const ADMIN_EMAIL = "admin@example.com";
const OLD_CLIENT = "11111111-1111-4111-8111-111111111111";

describe("clean reload admin browser (real PostgreSQL)", { concurrency: false }, () => {
  let browser: Browser;
  let databaseUrl = "";
  let bundleDir = "";
  let baseUrl = "";
  let server: http.Server;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
    if (bundleDir) {
      await rm(bundleDir, { recursive: true, force: true });
    }
  });

  async function seedAndReload(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl || "http://127.0.0.1:3000");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    await createTestUser({
      databaseUrl,
      email: ADMIN_EMAIL,
      password: TEST_PASSWORD,
      fullName: "Clean Reload Admin",
      role: "admin",
    });

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: OLD_CLIENT,
        name_client: "Legacy Browser Client",
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
        name_manager: "Legacy Manager",
        address: "Old",
      },
    ]);

    const legacyValidated = validateClientsForApplyTest(buildClientsFileBytes([sampleClient()]));
    assert.equal(legacyValidated.ok, true);
    if (!legacyValidated.ok) return;
    await applyClientsImport({
      databaseUrl,
      payload: legacyValidated.payload,
      expectedVerificationFingerprint: verificationFingerprintFromPayload({
        payload: legacyValidated.payload,
      }),
    });

    const catalogEntries = catalogEntriesFromXmlSet(buildMinimalCatalogXmlSet());
    const parsed = await parseCatalogSet(
      catalogEntries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    const validatedCatalog = validateCatalogSet(parsed.data!);
    assert.equal(validatedCatalog.ok, true);
    await applyCatalogImport(databaseUrl, validatedCatalog.data!);

    bundleDir = await mkdtemp(path.join(os.tmpdir(), "clean-reload-browser-"));
    await writeCleanReloadBundleDir(bundleDir);

    const dryRun = await runCleanReload({
      mode: "dry_run",
      bundleDir,
      databaseUrl,
      confirmExtendedContract: true,
      operatorReference: "browser-test",
    });
    assert.equal(dryRun.ok, true);

    const apply = await runCleanReload({
      mode: "apply",
      bundleDir,
      databaseUrl,
      expectedBundleFingerprint: dryRun.plan.bundleFingerprint,
      confirmTargetDb: dryRun.plan.targetDbFingerprint,
      confirmExtendedContract: true,
      operatorReference: "browser-test",
    });
    assert.equal(apply.ok, true, JSON.stringify(apply));
  }

  async function startServer(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl);
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  it("admin login → clients list → search → card → manager and outlets after reload", async () => {
    await seedAndReload();
    await startServer();

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: baseUrl });
    const page = await context.newPage();

    await page.goto("/login");
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 10000 });

    await page.goto("/clients");
    await page.waitForSelector("#clients-app:not(.clients-hidden)");
    await page.fill("#search-input", "Holding");
    await page.waitForFunction(() => {
      const count = document.querySelector("#result-count")?.textContent ?? "";
      return /2/.test(count) || /1/.test(count);
    });

    await page.goto(`/clients/${EXTENDED_FIXTURE_GUIDS.HOLDING_GUID}`);
    await page.waitForSelector("#client-detail:not(.clients-hidden)", { timeout: 15000 });
    await page.waitForSelector(".pc-meta", { timeout: 15000 });
    assert.match(await page.locator(".pc-meta").textContent() ?? "", /Manager One/i);

    await page.click('[data-card-tab="data"]');
    await page.waitForSelector("#pc-panel-data:not([hidden])", { timeout: 10000 });
    const outletText = await page.locator('[data-testid="pc-outlet-0"]').textContent();
    assert.match(outletText ?? "", /Открыт/i);

    await page.reload();
    await page.waitForSelector("#client-detail:not(.clients-hidden)", { timeout: 15000 });
    assert.match(await page.locator("#client-detail-root").textContent() ?? "", /Manager One/i);

    await context.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
