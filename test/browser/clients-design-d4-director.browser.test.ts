import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ORG_DIRECTOR_EMPLOYEE_GUID } from "../../src/clients/org/constants";
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
const ORIGIN = "http://127.0.0.1:3000";

const DIRECTOR = ORG_DIRECTOR_EMPLOYEE_GUID;
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const M_NO_ACCOUNT = "66666666-6666-4666-8666-666666666666";
const R1 = "55555555-5555-4555-8555-555555555555";
const MARKETING = "99999999-9999-4999-8999-999999999999";

const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "88888888-8888-4888-8888-888888888888";
const C3_T3 = "88888888-8888-4888-8888-888888888803";
const C_NO_ROP = "66666666-6666-4666-8666-666666666667";
const C_BOTH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STORE_MISSING = "88888888-8888-4888-8888-888888888801";

const DESKTOP = { width: 1440, height: 1100 };
const MOBILE = { width: 390, height: 844 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

function emptyRef() {
  return { guid: null, name: "", state: "not_provided" as const };
}

function branchSnapshot(input: {
  clientRop?: { guid: string; name: string };
  clientManager?: { guid: string; name: string };
  clientRegional?: { guid: string; name: string };
  outlets?: Array<{
    guidStore: string;
    rop?: { guid: string; name: string };
    manager?: { guid: string; name: string };
    regional?: { guid: string; name: string };
  }>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: input.clientRegional
      ? { guid: input.clientRegional.guid, name: input.clientRegional.name, state: "directory_unverified" }
      : emptyRef(),
    hardwareManager: emptyRef(),
    headOfSales: input.clientRop
      ? { guid: input.clientRop.guid, name: input.clientRop.name, state: "directory_unverified" }
      : { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: false,
      outletGuidStatus: "confirmed",
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      address: { storeAddress: "Addr " + outlet.guidStore.slice(0, 8), deliveryAddress: "", routeDirection: "" },
      loading: {
        loadingOnMonday: null,
        loadingOnTuesday: null,
        loadingOnWednesday: null,
        loadingOnThursday: null,
        loadingOnFriday: null,
        loadingOnSaturday: null,
        loadingOnSunday: null,
        loadingTime: null,
      },
      managers: {
        manager: outlet.manager
          ? {
              guid: outlet.manager.guid,
              name: outlet.manager.name || "Manager",
              state: "directory_unverified",
            }
          : { guid: M1, name: "Manager One", state: "directory_unverified" },
        regionalManager: outlet.regional
          ? { guid: outlet.regional.guid, name: "Regional", state: "directory_unverified" }
          : emptyRef(),
        hardwareManager: emptyRef(),
        headOfSales: outlet.rop
          ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
          : emptyRef(),
      },
      contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
      lpr: {
        name: "",
        post: "",
        dateOfBirth: null,
        phone: "",
        email: "",
        bonus: "",
        conditionsBonus: "",
      },
      additional: { statusTandoorClub: "", bonusTandoorClub: "" },
      provenance: {
        freshness: "current",
        sourceSha256: "a".repeat(64),
        importedAt: "2026-01-01T10:00:00.000Z",
      },
      distributionAllowed: false,
    })),
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients design D4 — director screen", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;

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
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    const directorUser = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Гончаренко Дмитрий",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: directorUser.id,
      employeeId: DIRECTOR,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 9)
        ON CONFLICT (id) DO UPDATE SET employee_count = 9
      `,
      ["b".repeat(64)],
    );
    for (const [guid, name, post] of [
      [DIRECTOR, "Гончаренко Дмитрий", "Директор"],
      [ROP_A, "ROP Alpha", "Руководитель отдела продаж"],
      [ROP_B, "ROP Beta", "Руководитель отдела продаж"],
      [M1, "Manager One", "Менеджер"],
      [M2, "Manager Two", "Менеджер"],
      [M3, "Manager Three", "Менеджер"],
      [M_NO_ACCOUNT, "No Account Manager", "Менеджер"],
      [R1, "Regional One", "Региональный менеджер"],
      [MARKETING, "Маркетинг", "Маркетолог"],
    ] as const) {
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, $3, '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post
        `,
        [guid, name, post],
      );
    }
    await pool.end();

    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client C1", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client C2", guid_manager: R1, name_manager: "Regional One" },
      { guid_client: C3, name_client: "Client C3", guid_manager: M2, name_manager: "Manager Two" },
      {
        guid_client: "44444444-4444-4444-8444-444444444444",
        name_client: "No Account Client",
        guid_manager: M_NO_ACCOUNT,
        name_manager: "No Account Manager",
      },
      {
        guid_client: C_NO_ROP,
        name_client: "Client Without ROP",
        guid_manager: M1,
        name_manager: "Manager One",
      },
      {
        guid_client: C_BOTH,
        name_client: "Client Both Missing",
        guid_manager: "00000000-0000-0000-0000-000000000000",
        name_manager: "Missing Manager",
      },
    ]);

    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      branchSnapshot({
        clientRop: { guid: ROP_B, name: "ROP Beta" },
        clientRegional: { guid: R1, name: "Regional One" },
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({
        outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      "44444444-4444-4444-8444-444444444444",
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M_NO_ACCOUNT, name: "No Account Manager" },
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_NO_ROP,
      branchSnapshot({
        clientManager: { guid: M1, name: "Manager One" },
      }),
    );
    await updateClientExtendedSnapshot(databaseUrl, C_BOTH, branchSnapshot({}));
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M1, name: "Manager One" },
        clientRegional: { guid: R1, name: "Regional One" },
        outlets: [
          {
            guidStore: T1,
            rop: { guid: ROP_B, name: "ROP Beta" },
            manager: { guid: M3, name: "Manager Three" },
          },
          {
            guidStore: T2,
            rop: { guid: ROP_A, name: "ROP Alpha" },
            manager: { guid: M3, name: "Manager Three" },
            regional: { guid: R1, name: "Regional One" },
          },
          {
            guidStore: STORE_MISSING,
            rop: { guid: "", name: "" },
            manager: { guid: "", name: "" },
          },
        ],
      }),
    );

    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1 },
      { guid_store: T2, guid_client: C1 },
      { guid_store: C3_T3, guid_client: C3 },
      { guid_store: STORE_MISSING, guid_client: C1 },
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

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async function login(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", "director@example.com");
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  async function newSession(viewport: typeof DESKTOP | typeof MOBILE): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport, baseURL: baseUrl });
    const page = await context.newPage();
    return { context, page };
  }

  async function waitForTeamsOverview(page: Page): Promise<void> {
    await page.waitForSelector("#clients-manager-chrome:not(.clients-hidden)");
    await page.waitForSelector(".clients-director-teams-grid .clients-team-card-shell");
    await page.waitForFunction(
      () => document.querySelectorAll(".clients-director-teams-grid .clients-team-member-row").length >= 2,
      undefined,
      { timeout: 30000 },
    );
  }

  function teamCard(page: Page, ropTitle: string) {
    return page.locator(".clients-team-card-shell").filter({
      has: page.locator(".clients-team-card-shell__title", { hasText: ropTitle }),
    });
  }

  async function readTeamsGridLayout(page: Page) {
    return page.evaluate(() => {
      const gridEl = document.querySelector(".clients-director-teams-grid");
      const cards = Array.from(
        document.querySelectorAll(".clients-director-teams-grid .clients-team-card-shell"),
      );
      const incompleteStrip = document.getElementById("clients-stats-incomplete-strip");
      return {
        gridColumns: gridEl ? getComputedStyle(gridEl).gridTemplateColumns : "",
        incompleteColumns: incompleteStrip ? getComputedStyle(incompleteStrip).gridTemplateColumns : "",
        cardRects: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
        }),
        containerWidth: gridEl?.getBoundingClientRect().width ?? 0,
      };
    });
  }

  function countGridTracks(columnsValue: string): number {
    if (!columnsValue) {
      return 0;
    }
    return columnsValue.split(/\s+/).filter(Boolean).length;
  }

  async function assertTeamsGridLayout(page: Page, viewport: { width: number }): Promise<void> {
    const layout = await readTeamsGridLayout(page);
    const ropACard = teamCard(page, "ROP Alpha");
    const ropBCard = teamCard(page, "ROP Beta");
    assert.equal(layout.cardRects.length, 2, "expected two ROP cards in overview");

    if (viewport.width < 768) {
      assert.equal(
        countGridTracks(layout.gridColumns),
        1,
        "mobile teams grid should have one column: " + layout.gridColumns,
      );
      assert.equal(
        countGridTracks(layout.incompleteColumns),
        1,
        "mobile incomplete stats should have one column: " + layout.incompleteColumns,
      );
      assert.ok(
        layout.cardRects[1].top > layout.cardRects[0].top + layout.cardRects[0].height * 0.4,
        "ROP Beta card should render below ROP Alpha on mobile",
      );
      assert.ok(
        layout.cardRects[0].width >= layout.containerWidth * 0.92,
        "ROP Alpha card should span the teams grid width on mobile",
      );
      assert.ok(
        layout.cardRects[1].width >= layout.containerWidth * 0.92,
        "ROP Beta card should span the teams grid width on mobile",
      );
    } else {
      assert.equal(
        countGridTracks(layout.gridColumns),
        2,
        "desktop teams grid should have two columns: " + layout.gridColumns,
      );
      assert.equal(
        countGridTracks(layout.incompleteColumns),
        2,
        "desktop incomplete stats should have two columns: " + layout.incompleteColumns,
      );
      assert.ok(
        Math.abs(layout.cardRects[0].top - layout.cardRects[1].top) < 24,
        "ROP cards should share a row on desktop",
      );
      assert.ok(
        layout.cardRects[1].left > layout.cardRects[0].left + layout.cardRects[0].width * 0.35,
        "ROP Beta card should render to the right of ROP Alpha on desktop",
      );
    }

    for (const card of [ropACard, ropBCard]) {
      const memberName = card.locator(".clients-team-member-row__name").first();
      const memberCount = card.locator(".clients-team-member-row__count").first();
      assert.equal(await memberName.isVisible(), true);
      assert.equal(await memberCount.isVisible(), true);
      assert.ok((await memberName.textContent())?.trim().length);
    }
  }

  async function waitForListLoaded(page: Page, viewport: { width: number }): Promise<void> {
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) {
          return false;
        }
        return (
          document.querySelectorAll(".clients-card").length > 0 ||
          document.querySelectorAll("#clients-table-body tr").length > 0
        );
      },
      undefined,
      { timeout: 30000 },
    );
    if (viewport.width < 768) {
      await page.waitForSelector(".clients-card", { state: "attached", timeout: 5000 });
    } else {
      await page.waitForSelector("#clients-table-body tr", { state: "visible", timeout: 5000 });
    }
  }

  async function waitForVisibleCompletenessCards(page: Page): Promise<void> {
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) {
          return false;
        }
        return document.querySelectorAll(".clients-card--completeness").length > 0;
      },
      undefined,
      { timeout: 30000 },
    );
  }

  it("director: teams overview, branch isolation, completeness queue, screenshots", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page);

      await page.goto("/clients", { waitUntil: "networkidle" });
      await waitForTeamsOverview(page);

      assert.equal(await page.locator("#clients-page-title").textContent(), "Вся клиентская база");
      assert.match(await page.locator("#clients-page-subtitle").textContent(), /Команды, клиенты и торговые точки/);
      assert.match(await page.locator("#clients-employee-name").textContent(), /Гончаренко Дмитрий/);
      assert.equal(await page.locator("#clients-employee-role").textContent(), "Директор");
      assert.match(
        await page.locator("#clients-employee-scope-value").textContent(),
        /Весь доступный состав отдела ОПТ/,
      );
      assert.match(page.url(), /view=teams/);
      assert.equal(await page.locator(".clients-team-card-shell").count(), 2);
      assert.equal(await page.locator(".clients-team-own-row").count(), 0);
      assert.equal(await page.locator(".clients-workspace-nav.clients-hidden").count(), 1);
      assert.equal(await page.locator("#view-completeness-tab:not(.clients-hidden)").count(), 1);
      assert.equal(await page.locator("#view-review-tab:not(.clients-hidden)").count(), 1);
      assert.equal(await page.locator('#view-review-tab').textContent(), "Ревизии");
      assert.ok(await page.locator(".clients-team-section--undefined").filter({ hasText: "Маркетинг" }).count());

      const overview = await page.evaluate(async () => {
        const [clientsRes, outletsRes, orgRes, completenessRes] = await Promise.all([
          fetch("/api/clients?view=all&entity=clients&page=1&pageSize=1", { credentials: "include" }),
          fetch("/api/clients?view=all&entity=outlets&page=1&pageSize=1", { credentials: "include" }),
          fetch("/api/clients/org-structure", { credentials: "include" }),
          fetch("/api/clients/completeness-queue?page=1&pageSize=1", { credentials: "include" }),
        ]);
        return {
          clientsTotal: (await clientsRes.json()).total,
          outletsTotal: (await outletsRes.json()).total,
          rops: (await orgRes.json()).rops,
          completenessSummary: (await completenessRes.json()).summary,
        };
      });
      assert.equal(await page.locator("#clients-stat-clients").textContent(), String(overview.clientsTotal));
      assert.equal(await page.locator("#clients-stat-outlets").textContent(), String(overview.outletsTotal));
      assert.equal(await page.locator("#clients-stat-no-outlets").textContent(), String(overview.rops.length));
      assert.equal(
        await page.locator("#clients-stat-incomplete-clients").textContent(),
        String(overview.completenessSummary.clients),
      );
      assert.equal(
        await page.locator("#clients-stat-incomplete-outlets").textContent(),
        String(overview.completenessSummary.outlets),
      );
      assert.equal(overview.rops.length, 2);
      assert.ok(overview.completenessSummary.clients >= 1);
      assert.ok(overview.completenessSummary.outlets >= 1);

      await assertTeamsGridLayout(page, viewport);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-design-d4-director-teams-${viewportName}.png`),
        fullPage: true,
      });

      const ropACard = teamCard(page, "ROP Alpha");
      const ropBCard = teamCard(page, "ROP Beta");
      assert.ok(await ropACard.locator(".clients-team-member-row", { hasText: "Manager Three" }).count());
      assert.ok(await ropBCard.locator(".clients-team-member-row", { hasText: "Manager Three" }).count());
      assert.ok(await ropACard.locator(".clients-team-member-row", { hasText: "No Account Manager" }).count());

      const branchAListResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/clients" &&
          url.searchParams.get("ropEmployee") === ROP_A &&
          url.searchParams.get("portfolio") === "clients" &&
          response.status() === 200
        );
      });
      await ropACard.locator('[data-branch-portfolio="clients"]').click();
      await branchAListResponse;
      await waitForListLoaded(page, viewport);
      const branchAList =
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText();
      assert.ok(branchAList.includes("Client C1"));
      assert.ok(!branchAList.includes("Client C2"));

      await page.locator("#clients-breadcrumbs-back").click();
      await waitForTeamsOverview(page);

      const branchBListResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/clients" &&
          url.searchParams.get("ropEmployee") === ROP_B &&
          url.searchParams.get("portfolio") === "clients" &&
          response.status() === 200
        );
      });
      await ropBCard.locator('[data-branch-portfolio="clients"]').click();
      await branchBListResponse;
      await waitForListLoaded(page, viewport);
      const branchBList =
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText();
      assert.ok(branchBList.includes("Client C2") || branchBList.includes("Client C3"));
      assert.ok(!branchBList.includes("Client C1"));

      await page.locator("#clients-breadcrumbs-back").click();
      await waitForTeamsOverview(page);

      const accessChecks = await page.evaluate(async () => {
        const [adminOverview, presentationRes] = await Promise.all([
          fetch("/api/admin/access/overview", { credentials: "include" }),
          fetch("/api/clients/presentation", { credentials: "include" }).then((res) => res.json()),
        ]);
        const presentation = presentationRes.presentation || presentationRes;
        return {
          adminStatus: adminOverview.status,
          reviewReadOnly: presentation.reviewReadOnly,
          businessRole: presentation.businessRole,
        };
      });
      assert.ok(accessChecks.adminStatus === 403 || accessChecks.adminStatus === 401);
      assert.equal(accessChecks.reviewReadOnly, true);
      assert.equal(accessChecks.businessRole, "director");

      await context.close();
    }

    for (const [viewportName, viewport] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      const { context, page } = await newSession(viewport);
      await login(page);

      const queueResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients/completeness-queue") && response.status() === 200,
      );
      await page.goto("/clients?view=completeness", { waitUntil: "networkidle" });
      await queueResponse;
      if (viewport.width < 768) {
        await waitForVisibleCompletenessCards(page);
      } else {
        await page.waitForSelector("#clients-table-body tr");
      }

      const queueBody =
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText();
      assert.ok(queueBody.includes("Client Both Missing"));
      const bothMissingRows = await page.locator(
        viewport.width < 768 ? ".clients-card--completeness" : "#clients-table-body tr",
        { hasText: "Client Both Missing" },
      ).count();
      assert.equal(bothMissingRows, 1);

      const outletsQueueResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients/completeness-queue") &&
          response.url().includes("entity=outlets") &&
          response.status() === 200,
      );
      await page.click('[data-entity="outlets"]');
      await outletsQueueResponse;
      if (viewport.width < 768) {
        await waitForVisibleCompletenessCards(page);
      } else {
        await page.waitForSelector("#clients-table-body tr");
      }
      const outletsBody =
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText();
      assert.match(outletsBody, /Store Missing|Addr 88888888/i);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `clients-design-d4-director-completeness-${viewportName}.png`),
        fullPage: true,
      });

      await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
      await waitForTeamsOverview(page);
      await page.reload({ waitUntil: "networkidle" });
      await waitForTeamsOverview(page);
      assert.match(page.url(), /view=teams/);

      await context.close();
    }

    await stopServer();
  });
});
