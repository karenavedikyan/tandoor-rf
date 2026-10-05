import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertSyntheticRetailOutlets,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const TEST_PASSWORD = "StrongPass123!";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const M_SHARED = "66666666-6666-4666-8666-666666666601";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const T1 = "11111111-1111-4111-8111-111111111112";
const T2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

function branchSnapshot(input: {
  clientRop?: { guid: string; name: string };
  outlets?: Array<{ guidStore: string; rop: { guid: string; name: string } }>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: input.clientRop
      ? { guid: input.clientRop.guid, name: input.clientRop.name, state: "directory_unverified" }
      : { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: false,
      address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
      loading: {},
      managers: {
        manager: { guid: M_SHARED, name: "Shared", state: "directory_unverified" },
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" },
      },
      contacts: {},
      lpr: {},
      additional: {},
      outletGuidStatus: "confirmed",
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      provenance: {
        freshness: "current",
        sourceSha256: "a".repeat(64),
        importedAt: new Date().toISOString(),
      },
      distributionAllowed: false,
    })),
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients ROP outlets browser (real PostgreSQL)", { concurrency: false }, () => {
  let browser: Browser;
  let databaseUrl = "";
  let baseUrl = "";
  let server: http.Server;

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
    setIntegrationEnv(databaseUrl, baseUrl || "http://127.0.0.1:3000");
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop-a@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP Alpha",
      role: "rop",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropUser.id,
      employeeId: ROP_A,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 2)
        ON CONFLICT (id) DO UPDATE SET employee_count = 2
      `,
      ["b".repeat(64)],
    );
    for (const [guid, name] of [
      [ROP_A, "ROP Alpha"],
      [M_SHARED, "Shared Manager"],
    ] as const) {
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, 'Менеджер', '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
        `,
        [guid, name],
      );
    }
    await pool.end();

    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C1,
        name_client: "Client C1",
        guid_manager: M_SHARED,
        name_manager: "Shared Manager",
      },
      {
        guid_client: C2,
        name_client: "Client C2",
        guid_manager: M_SHARED,
        name_manager: "Shared Manager",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        outlets: [{ guidStore: T1, rop: { guid: ROP_A, name: "ROP Alpha" } }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      branchSnapshot({
        outlets: [{ guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" } }],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1 },
      { guid_store: T2, guid_client: C2 },
    ]);
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

  it("ROP session opens outlet list from tree and preserves branch on reload", async () => {
    await seedDatabase();
    await resetPoolForTests();
    const probeApp = (await import("../../src/server")).createApp();
    const probeLogin = await request(probeApp)
      .post("/api/auth/login")
      .set({ Origin: "http://127.0.0.1:3000", "Content-Type": "application/json" })
      .send({ email: "rop-a@example.com", password: TEST_PASSWORD });
    assert.equal(probeLogin.status, 200);
    const probeCookie = probeLogin.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const probeCard = await request(probeApp)
      .get(`/api/clients/${C1}`)
      .set({ Origin: "http://127.0.0.1:3000", Cookie: probeCookie });
    assert.equal(probeCard.status, 200, JSON.stringify(probeCard.body));

    await startServer();

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: baseUrl });
    const page = await context.newPage();

    await page.goto("/login");
    await page.fill("#email", "rop-a@example.com");
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 10000 });

    await page.goto("/clients?view=teams");
    await page.waitForSelector('[data-portfolio="outlets"]');
    await page.click(`[data-portfolio="outlets"][data-rop-employee="${ROP_A}"]`);
    await page.waitForSelector("#clients-table-body tr");
    await page.waitForFunction(
      (expected) => {
        const count = document.querySelector("#result-count")?.textContent ?? "";
        return count.includes(String(expected));
      },
      2,
    );

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "rop-outlets-list-from-tree.png"),
      fullPage: true,
    });

    const tableText = await page.locator("#clients-table-body").textContent();
    assert.match(tableText ?? "", /Client C1/i);
    assert.match(tableText ?? "", /Client C2/i);

    const listUrl = page.url();
    await page.locator("#clients-table-body a.clients-link").first().click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+/i, { timeout: 15000 });
    await page.waitForSelector("#client-detail-root", { timeout: 15000 });

    await page.goto(listUrl);
    await page.waitForSelector("#clients-table-body tr");
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), new RegExp(`ropEmployee=${ROP_A}`));

    await page.reload();
    await page.waitForSelector("#clients-table-body tr");
    assert.match(page.url(), /entity=outlets/);
    assert.match(page.url(), /portfolio=outlets/);

    await context.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
