import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { chromium, type Browser, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { loginCabinet, waitClientsShellReady } from "./helpers/cabinet-login";
import {
  buildMeasureBannerBundleExpression,
  buildMeasureButtonExpression,
  buildMeasurePairExpression,
} from "./helpers/preview-banner-contrast-eval";

const TEST_PASSWORD = "StrongPass123!";
const ORIGIN = "http://127.0.0.1:3000";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const M1 = "11111111-1111-4111-8111-111111111111";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BANNER_BACKDROP = ".clients-preview-banner";
const STOP_BTN = "#clients-preview-stop-btn";

const SCREENSHOT_DIR = "/cursor/stores/self/media";
const CONTRAST_LOG_PATH =
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/internal/preview-banner-contrast-measurements.json";
const MIN_CONTRAST = 4.5;
const MIN_DISABLED_CONTRAST = 3;

type ContrastSample = {
  label: string;
  fgRgb: number[];
  bgRgb: number[];
  ratio: number;
};

async function measurePair(
  page: Page,
  textSelector: string,
  backdropSelector: string,
  label: string,
): Promise<ContrastSample> {
  return page.evaluate(buildMeasurePairExpression(textSelector, backdropSelector, label));
}

async function measureButton(
  page: Page,
  selector: string,
  backdropSelector: string,
  label: string,
  state: "default" | "hover" | "focus",
): Promise<ContrastSample> {
  const button = page.locator(selector);
  if (state === "hover") {
    await button.hover();
  } else if (state === "focus") {
    await button.focus();
  }
  return page.evaluate(buildMeasureButtonExpression(selector, backdropSelector, label));
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== theme) {
    await page.locator(".legacy-topbar [data-theme-toggle]").click();
  }
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
  await page.evaluate(() => document.fonts.ready);
}

describe("admin employee preview banner contrast", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;
  let managerUserId = "";
  const contrastLog: ContrastSample[] = [];

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seedDatabase(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Preview Employee",
      role: "manager",
    });
    managerUserId = manager.id;

    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });

    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C1,
        name_client: "Synthetic Client",
        guid_manager: M1,
        name_manager: "Preview Employee",
      },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, C1, {
      formatVersion: "extended_v1",
      sourceSha256: "a".repeat(64),
      importedAt: new Date().toISOString(),
      isHolding: false,
      holdingLink: { state: "none", pendingGuid: null },
      clientManagerRosterState: "in_wholesale_roster",
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: ROP_A, name: "ROP", state: "directory_unverified" },
      currentRetailOutlets: [],
      retailOutletHistory: [],
      blocks: { clientExtendedReady: true, outletNormalizedReady: true },
    });
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

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async function login(page: Page): Promise<void> {
    await loginCabinet(page, "admin@example.com", TEST_PASSWORD);
    await waitClientsShellReady(page);
  }

  async function startPreview(page: Page): Promise<void> {
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await page.click("#shell-preview-open");
    await page.waitForSelector("#shell-preview-picker");
    await page.fill("#shell-preview-query", "manager-a");
    await page.waitForResponse(
      (r) => r.url().includes("/api/admin/access/preview/candidates") && r.status() === 200,
    );
    await page.waitForSelector(`[data-preview-id="${managerUserId}"]`, { timeout: 20000 });
    const startResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/access/preview/start") && response.status() === 200,
    );
    await page.click(`[data-preview-id="${managerUserId}"]`);
    await startResponse;
    await page.waitForURL(/\/clients/, { timeout: 15000 });
    await page.waitForSelector(".clients-preview-banner");
  }

  function assertContrast(samples: ContrastSample[], minRatio = MIN_CONTRAST): void {
    for (const sample of samples) {
      contrastLog.push(sample);
      assert.ok(
        sample.ratio >= minRatio,
        `${sample.label}: contrast ${sample.ratio.toFixed(2)} < ${minRatio} (fg rgb(${sample.fgRgb.join(",")}) bg rgb(${sample.bgRgb.join(",")}))`,
      );
    }
  }

  it("preview banner readable in light/dark on clients, profile, sales and error state", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    const viewports = [
      { name: "mobile", width: 390, height: 844 },
      { name: "desktop", width: 1440, height: 900 },
    ];

    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      const page = await context.newPage();
      await login(page);
      await startPreview(page);

      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const theme of ["light", "dark"] as const) {
          await setTheme(page, theme);
          const variant = "normal";
          const bundleLabel = `${variant}/${theme}/${viewport.name}`;
          const bundled = await page.evaluate(
            buildMeasureBannerBundleExpression(
              ".clients-preview-banner__text",
              STOP_BTN,
              BANNER_BACKDROP,
              bundleLabel,
            ),
          );
          const samples = [
            ...bundled,
            await measureButton(
              page,
              STOP_BTN,
              BANNER_BACKDROP,
              `${variant}/${theme}/${viewport.name}/button-hover`,
              "hover",
            ),
            await measureButton(
              page,
              STOP_BTN,
              BANNER_BACKDROP,
              `${variant}/${theme}/${viewport.name}/button-focus`,
              "focus",
            ),
          ];
          assertContrast(samples);
          if (theme === "dark" && viewport.name === "mobile") {
            await page.evaluate(() => {
              const btn = document.getElementById("clients-preview-stop-btn");
              if (btn) btn.disabled = true;
            });
            assertContrast(
              [
                await measureButton(
                  page,
                  STOP_BTN,
                  BANNER_BACKDROP,
                  `${variant}/${theme}/${viewport.name}/button-disabled`,
                  "default",
                ),
              ],
              MIN_DISABLED_CONTRAST,
            );
            await page.evaluate(() => {
              const btn = document.getElementById("clients-preview-stop-btn");
              if (btn) btn.disabled = false;
            });
          }
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `preview-banner-${variant}-${theme}-${viewport.name}.png`),
            fullPage: false,
          });
        }
      }

      await setTheme(page, "dark");
      await page.locator(".legacy-topbar [data-theme-toggle]").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".clients-preview-banner");
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");

      await page.goto("/profile", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".clients-preview-banner");
      await setTheme(page, "dark");
      assertContrast([
        await measurePair(
          page,
          ".clients-preview-banner__text",
          ".clients-preview-banner",
          "profile/dark/text",
        ),
        await measureButton(page, STOP_BTN, BANNER_BACKDROP, "profile/dark/button", "default"),
      ]);

      await page.goto("/sales?month=2026-09", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".clients-preview-banner");
      await setTheme(page, "light");
      assertContrast([
        await measurePair(
          page,
          ".clients-preview-banner__text",
          ".clients-preview-banner",
          "sales/light/text",
        ),
      ]);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/access", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".clients-preview-banner");
      await setTheme(page, "dark");
      const accessDarkSamples = [
        await measurePair(
          page,
          ".clients-preview-banner__text",
          ".clients-preview-banner",
          "access/dark/mobile/text",
        ),
        await measureButton(
          page,
          STOP_BTN,
          BANNER_BACKDROP,
          "access/dark/mobile/button",
          "default",
        ),
        await measureButton(
          page,
          STOP_BTN,
          BANNER_BACKDROP,
          "access/dark/mobile/button-hover",
          "hover",
        ),
        await measureButton(
          page,
          STOP_BTN,
          BANNER_BACKDROP,
          "access/dark/mobile/button-focus",
          "focus",
        ),
      ];
      assertContrast(accessDarkSamples);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "preview-banner-dark-normal-mobile.png"),
        fullPage: false,
      });

      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      await pool.query(
        `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [managerUserId],
      );
      await pool.end();

      const meAfterRevoke = page.waitForResponse(
        (r) => r.url().includes("/api/auth/me") && r.status() === 200,
        { timeout: 20000 },
      );
      await page.goto("/clients", { waitUntil: "domcontentloaded" });
      await meAfterRevoke;
      await page.waitForSelector(".clients-preview-banner--error", { timeout: 20000 });

      for (const theme of ["light", "dark"] as const) {
        await setTheme(page, theme);
        for (const viewport of viewports) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          const samples = [
            await measurePair(
              page,
              ".clients-preview-banner__text",
              ".clients-preview-banner--error",
              `error/${theme}/${viewport.name}/text`,
            ),
            await measureButton(
              page,
              STOP_BTN,
              ".clients-preview-banner--error",
              `error/${theme}/${viewport.name}/button`,
              "default",
            ),
            await measureButton(
              page,
              STOP_BTN,
              ".clients-preview-banner--error",
              `error/${theme}/${viewport.name}/button-hover`,
              "hover",
            ),
          ];
          assertContrast(samples);
          await page.screenshot({
            path: path.join(
              SCREENSHOT_DIR,
              `preview-banner-error-${theme}-${viewport.name}.png`,
            ),
            fullPage: false,
          });
        }
      }

      const stopResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/admin/access/preview/stop") && response.status() === 200,
      );
      await page.click("#clients-preview-stop-btn");
      await stopResponse;
      await page.waitForURL(/\/admin\/access/, { timeout: 15000 });
      assert.equal(await page.locator(".clients-preview-banner").count(), 0);

      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      );

      fs.mkdirSync(path.dirname(CONTRAST_LOG_PATH), { recursive: true });
      fs.writeFileSync(CONTRAST_LOG_PATH, JSON.stringify(contrastLog, null, 2));
    } finally {
      await context.close();
      await stopServer();
    }
  });
});
