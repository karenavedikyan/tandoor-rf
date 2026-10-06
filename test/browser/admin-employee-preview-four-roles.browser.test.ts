import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ORG_DIRECTOR_EMPLOYEE_GUID } from "../../src/clients/org/constants";
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
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
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join("/opt/cursor/artifacts/screenshots");

const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1B = "11111111-1111-4111-8111-111111111113";
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";

type RoleKey = "manager" | "regional" | "rop" | "director";

type RoleSpec = {
  search: string;
  fullName: string;
  roleLabel: RegExp;
  pageTitle: RegExp | string;
  chromeVisible: string;
  employeeEmail: string;
};

const ROLE_SPECS: Record<RoleKey, RoleSpec> = {
  manager: {
    search: "manager-a",
    fullName: "Иванов Иван Иванович",
    roleLabel: /Менеджер/,
    pageTitle: "Мои клиенты",
    chromeVisible: "#clients-manager-chrome:not(.clients-hidden)",
    employeeEmail: "manager-a@example.com",
  },
  regional: {
    search: "regional",
    fullName: "Петрова Анна Сергеевна",
    roleLabel: /Региональный менеджер/,
    pageTitle: "Мои торговые точки",
    chromeVisible: "#clients-manager-chrome:not(.clients-hidden)",
    employeeEmail: "regional@example.com",
  },
  rop: {
    search: "rop-a-nav",
    fullName: "Сидоров Пётр Николаевич",
    roleLabel: /^РОП$/,
    pageTitle: "Клиенты моей команды",
    chromeVisible: "#clients-manager-chrome:not(.clients-hidden)",
    employeeEmail: "rop-a-nav@example.com",
  },
  director: {
    search: "director",
    fullName: "Гончаренко Дмитрий",
    roleLabel: /Директор/,
    pageTitle: "Вся клиентская база",
    chromeVisible: "#clients-manager-chrome:not(.clients-hidden)",
    employeeEmail: "director@example.com",
  },
};

function emptyRef() {
  return { guid: null, name: "", state: "not_provided" as const };
}

describe("admin employee preview four-role acceptance", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl: string;
  const userIds: Partial<Record<RoleKey, string>> = {};

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

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

  async function login(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/profile/, { timeout: 15000 });
  }

  async function newSession(viewport: typeof DESKTOP | typeof MOBILE): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport, baseURL: baseUrl });
    return { context, page: await context.newPage() };
  }

  async function seedAllRoles(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl || ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });

    const MANAGER_A = "22222222-2222-4222-8222-222222222222";
    const REGIONAL_EMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
    const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
    const M1 = "11111111-1111-4111-8111-111111111111";
    const M2 = "22222222-2222-4222-8222-222222222222";
    const M3 = "33333333-3333-4333-8333-333333333333";
    const M_NO_ACCOUNT = "66666666-6666-4666-8666-666666666666";
    const R1 = "55555555-5555-4555-8555-555555555555";
    const DIRECTOR = ORG_DIRECTOR_EMPLOYEE_GUID;

    const D1_C1 = "11111111-1111-4111-8111-111111111111";
    const D1_T1 = "11111111-1111-4111-8111-111111111112";
    const C_REGIONAL = "12121212-1212-4121-8121-121212121212";
    const T_REGIONAL = "13131313-1313-4131-8131-131313131313";
    const T1B = "11111111-1111-4111-8111-111111111113";
    const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C3 = "88888888-8888-4888-8888-888888888888";
    const C3_T3 = "88888888-8888-4888-8888-888888888803";
    const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const C_BOTH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";

    userIds.manager = (
      await createTestUser({
        databaseUrl,
        email: "manager-a@example.com",
        password: TEST_PASSWORD,
        fullName: "Иванов Иван Иванович",
        role: "manager",
      })
    ).id;
    userIds.regional = (
      await createTestUser({
        databaseUrl,
        email: "regional@example.com",
        password: TEST_PASSWORD,
        fullName: "Петрова Анна Сергеевна",
        role: "regional_manager",
      })
    ).id;
    userIds.rop = (
      await createTestUser({
        databaseUrl,
        email: "rop-a-nav@example.com",
        password: TEST_PASSWORD,
        fullName: "Сидоров Пётр Николаевич",
        role: "rop",
      })
    ).id;
    userIds.director = (
      await createTestUser({
        databaseUrl,
        email: "director@example.com",
        password: TEST_PASSWORD,
        fullName: "Гончаренко Дмитрий",
        role: "director",
      })
    ).id;

    await linkUserToEmployee({
      databaseUrl,
      userId: userIds.manager!,
      employeeId: MANAGER_A,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: userIds.regional!,
      employeeId: REGIONAL_EMP,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: userIds.rop!,
      employeeId: ROP_A,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: userIds.director!,
      employeeId: DIRECTOR,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
       VALUES (1, $1, 10) ON CONFLICT (id) DO UPDATE SET employee_count = 10`,
      ["b".repeat(64)],
    );
    for (const [guid, name, post] of [
      [MANAGER_A, "Manager A", "Менеджер"],
      [REGIONAL_EMP, "Regional Mgr", "Региональный менеджер"],
      [ROP_A, "ROP Alpha", "Руководитель отдела продаж"],
      [ROP_B, "ROP Beta", "Руководитель отдела продаж"],
      [M1, "Manager One", "Менеджер"],
      [M2, "Manager Two", "Менеджер"],
      [M3, "Manager Three", "Менеджер"],
      [M_NO_ACCOUNT, "No Account Manager", "Менеджер"],
      [R1, "Regional One", "Региональный менеджер"],
      [DIRECTOR, "Гончаренко Дмитрий", "Директор"],
    ] as const) {
      await pool.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, $2, $3, '{}'::jsonb)
         ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post`,
        [guid, name, post],
      );
    }
    await pool.end();

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
          : { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
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
              ? { guid: outlet.manager.guid, name: "Manager", state: "directory_unverified" }
              : { guid: MANAGER_A, name: "Manager A", state: "directory_unverified" },
            regionalManager: outlet.regional
              ? { guid: outlet.regional.guid, name: "Regional", state: "directory_unverified" }
              : emptyRef(),
            hardwareManager: emptyRef(),
            headOfSales: outlet.rop
              ? { guid: outlet.rop.guid, name: outlet.rop.name, state: "directory_unverified" }
              : { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
          },
          contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
          lpr: { name: "", post: "", dateOfBirth: null, phone: "", email: "", bonus: "", conditionsBonus: "" },
          additional: { statusTandoorClub: "", bonusTandoorClub: "" },
          provenance: { freshness: "current", sourceSha256: "a".repeat(64), importedAt: "2026-01-01T10:00:00.000Z" },
          distributionAllowed: false,
        })),
        retailOutletHistory: [],
        blocks: { clientExtendedReady: true, outletNormalizedReady: true },
      };
    }

    await insertSuccessfulImportRun(databaseUrl, { recordCount: 8 });
    await insertSyntheticClients(databaseUrl, [
      { guid_client: D1_C1, name_client: "Alpha Client", guid_manager: MANAGER_A, name_manager: "Manager A" },
      { guid_client: C_REGIONAL, name_client: "Regional Only Client", guid_manager: M2, name_manager: "Manager B" },
      { guid_client: C1, name_client: "Client C1", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client C2", guid_manager: R1, name_manager: "Regional One" },
      { guid_client: C3, name_client: "Client C3", guid_manager: M2, name_manager: "Manager Two" },
      { guid_client: C_BOTH, name_client: "Client Both Missing", guid_manager: "00000000-0000-0000-0000-000000000000", name_manager: "Missing" },
    ]);

    await updateClientExtendedSnapshot(
      databaseUrl,
      D1_C1,
      branchSnapshot({
        outlets: [
          { guidStore: D1_T1, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: MANAGER_A, name: "Manager A" }, regional: { guid: REGIONAL_EMP, name: "Regional" } },
          { guidStore: T1B, rop: { guid: ROP_B, name: "ROP Beta" }, regional: { guid: M2, name: "Other" } },
        ],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_REGIONAL,
      branchSnapshot({
        outlets: [{ guidStore: T_REGIONAL, manager: { guid: M2, name: "Manager Two" }, regional: { guid: REGIONAL_EMP, name: "Regional" } }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M1, name: "Manager One" },
        clientRegional: { guid: R1, name: "Regional One" },
        outlets: [
          { guidStore: T1, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M3, name: "Manager Three" } },
          { guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" }, regional: { guid: R1, name: "Regional One" } },
        ],
      }),
    );
    await updateClientExtendedSnapshot(databaseUrl, C2, branchSnapshot({ clientRop: { guid: ROP_B, name: "ROP Beta" }, clientRegional: { guid: R1, name: "Regional One" } }));
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({ outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }] }),
    );
    await updateClientExtendedSnapshot(databaseUrl, C_BOTH, branchSnapshot({}));

    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: D1_T1, guid_client: D1_C1 },
      { guid_store: T1B, guid_client: D1_C1 },
      { guid_store: T_REGIONAL, guid_client: C_REGIONAL },
      { guid_store: T1, guid_client: C1 },
      { guid_store: T2, guid_client: C1 },
      { guid_store: C3_T3, guid_client: C3 },
    ]);

    await grantClientAccess({ databaseUrl, userId: userIds.regional!, objectId: D1_C1, grantedByUserId: admin.id });
    await grantClientAccess({ databaseUrl, userId: userIds.regional!, objectId: C_REGIONAL, grantedByUserId: admin.id });
  }

  async function waitForListLoaded(page: Page, viewport: { width: number }): Promise<void> {
    await page.waitForFunction(
      () => {
        const content = document.getElementById("results-content");
        if (!content || content.classList.contains("clients-hidden")) return false;
        return document.querySelectorAll(".clients-card").length > 0 || document.querySelectorAll("#clients-table-body tr").length > 0;
      },
      undefined,
      { timeout: 30000 },
    );
    if (viewport.width < 768) {
      await page.waitForSelector(".clients-card", { state: "attached", timeout: 5000 });
    } else {
      await page.waitForSelector("#clients-table-body tr", { state: "visible", timeout: 5000 }).catch(() => undefined);
    }
  }

  async function waitForRoleReady(page: Page, role: RoleKey): Promise<void> {
    await page.waitForSelector(".clients-preview-banner");
    await page.waitForSelector(ROLE_SPECS[role].chromeVisible);
    if (role === "director") {
      await page.goto("/clients?view=teams", { waitUntil: "networkidle" });
      await page.waitForSelector(".clients-compact-team-list .clients-compact-team", { timeout: 30000 });
      return;
    }
    if (role === "rop") {
      await page.goto("/clients?view=teams&ropEmployee=" + ROP_A, { waitUntil: "networkidle" });
      await page.waitForSelector(".clients-compact-team-list--single .clients-compact-team__member", { timeout: 30000 });
      return;
    }
    await waitForListLoaded(page, { width: page.viewportSize()?.width ?? 1440 });
  }

  async function collectListGuids(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const fromLinks = Array.from(document.querySelectorAll('a.clients-link[href*="/clients/"]'))
        .map((el) => {
          const match = el.getAttribute("href")?.match(/\/clients\/([0-9a-f-]+)/i);
          return match ? match[1]!.toLowerCase() : null;
        })
        .filter(Boolean) as string[];
      return [...new Set(fromLinks)].sort();
    });
  }

  async function fetchApiGuids(page: Page, entity: "clients" | "outlets" = "clients"): Promise<string[]> {
    return page.evaluate(async (entityMode) => {
      const url = new URL("/api/clients", window.location.origin);
      url.searchParams.set("view", "all");
      url.searchParams.set("entity", entityMode);
      url.searchParams.set("page", "1");
      url.searchParams.set("pageSize", "100");
      const res = await fetch(url.toString(), { credentials: "include" });
      const body = await res.json();
      const key = entityMode === "outlets" ? "guidStore" : "guid";
      return (body.items ?? []).map((item: Record<string, string>) => String(item[key]).toLowerCase()).sort();
    }, entity);
  }

  async function startPreviewViaApi(page: Page, role: RoleKey): Promise<void> {
    const status = await page.evaluate(async (userId) => {
      const response = await fetch("/api/admin/access/preview/start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      return response.status;
    }, userIds[role]!);
    assert.equal(status, 200);
    await page.goto("/clients", { waitUntil: "networkidle" });
  }

  async function assertPreviewBanner(page: Page, spec: RoleSpec): Promise<void> {
    const banner = page.locator(".clients-preview-banner");
    assert.match(await banner.innerText(), new RegExp(spec.fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(await banner.innerText(), /Изменения запрещены/);
    assert.ok(await page.locator("#clients-preview-stop-btn").isVisible());
  }

  async function assertRoleChrome(page: Page, role: RoleKey): Promise<void> {
    const spec = ROLE_SPECS[role];
    assert.match(await page.locator("#clients-employee-name").textContent(), new RegExp(spec.fullName));
    assert.match(await page.locator("#clients-employee-role").textContent(), spec.roleLabel);
    if (typeof spec.pageTitle === "string") {
      assert.equal(await page.locator("#clients-page-title").textContent(), spec.pageTitle);
    } else {
      assert.match(await page.locator("#clients-page-title").textContent(), spec.pageTitle);
    }
    assert.equal(await page.locator("#workspace-sidebar a[href='/admin/access']").count(), 0);
  }

  async function collectBaselineGuids(page: Page, role: RoleKey): Promise<string[]> {
    await login(page, ROLE_SPECS[role].employeeEmail);
    await page.goto("/clients", { waitUntil: "networkidle" });
    if (role === "director") {
      await page.waitForSelector(".clients-compact-team-list .clients-compact-team");
      return [];
    }
    if (role === "rop") {
      await page.waitForSelector(".clients-compact-team-list--single .clients-compact-team__member");
      return [];
    }
    const entity = role === "regional" ? "outlets" : "clients";
    await waitForListLoaded(page, { width: page.viewportSize()?.width ?? 1440 });
    return fetchApiGuids(page, entity);
  }

  async function runRoleScenario(role: RoleKey, viewportName: "desktop" | "mobile", viewport: typeof DESKTOP | typeof MOBILE): Promise<void> {
    const spec = ROLE_SPECS[role];
    const { context: baselineCtx, page: baselinePage } = await newSession(viewport);
    const baselineGuids = await collectBaselineGuids(baselinePage, role);
    await baselineCtx.close();

    const { context, page } = await newSession(viewport);
    await login(page, "admin@example.com");
    await startPreviewViaApi(page, role);
    await waitForRoleReady(page, role);
    await assertPreviewBanner(page, spec);
    await assertRoleChrome(page, role);

    if (role === "manager") {
      await page.fill("#search-input", "Alpha");
      await page.waitForResponse((r) => r.url().includes("q=Alpha") && r.status() === 200);
      await waitForListLoaded(page, viewport);
      const previewGuids = await fetchApiGuids(page, "clients");
      assert.deepEqual(previewGuids, baselineGuids);
      const managerListText =
        viewport.width < 768
          ? await page.locator("#clients-cards").innerText()
          : await page.locator("#clients-table-body").innerText();
      assert.ok(!managerListText.includes("Client C2"));
      await page.goto("/clients/" + baselineGuids[0], { waitUntil: "networkidle" });
      await page.waitForSelector("#client-detail:not(.clients-hidden)");
      await page.goBack({ waitUntil: "networkidle" });
      await waitForListLoaded(page, viewport);
    }

    if (role === "regional") {
      const bodyText = viewport.width < 768 ? await page.locator("#clients-cards").innerText() : await page.locator("#clients-table-body").innerText();
      assert.ok(bodyText.includes("Alpha") || bodyText.includes("Regional"));
      assert.ok(!bodyText.includes("ROP Beta"));
      assert.ok(!bodyText.includes(T1B));
      const previewGuids = await fetchApiGuids(page, "outlets");
      assert.deepEqual(previewGuids, baselineGuids);
    }

    if (role === "rop") {
      assert.ok(await page.locator(".clients-compact-team__member-name", { hasText: "Manager One" }).count());
      assert.equal(await page.locator(".clients-compact-team-list--single").count(), 1);
      assert.equal(await page.locator(".clients-compact-team-list:not(.clients-compact-team-list--single)").count(), 0);
      const managerRow = page.locator(".clients-compact-team__member", { hasText: "Manager One" });
      await managerRow.locator('.clients-compact-team__count:has-text("клиентов")').first().click();
      await waitForListLoaded(page, viewport);
      const listText = viewport.width < 768 ? await page.locator("#clients-cards").innerText() : await page.locator("#clients-table-body").innerText();
      assert.ok(listText.includes("Client C1"));
      assert.ok(!listText.includes("Client C2"));
    }

    if (role === "director") {
      assert.ok((await page.locator(".clients-compact-team-list .clients-compact-team").count()) >= 2);
      assert.equal(await page.locator(".clients-workspace-nav:not(.clients-hidden)").count(), 0);
      assert.equal(await page.locator("#view-completeness-tab:not(.clients-hidden)").count(), 1);
      const completenessResponse = page.waitForResponse(
        (r) => r.url().includes("/api/clients/completeness-queue") && r.status() === 200,
      );
      await page.locator("#view-completeness-tab").click();
      await completenessResponse;
    }

    await page.reload({ waitUntil: "networkidle" });
    await waitForRoleReady(page, role);
    await assertPreviewBanner(page, spec);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `admin-employee-preview-${role}-${viewportName}.png`),
      fullPage: true,
    });

    await page.click("#clients-preview-stop-btn");
    await page.waitForURL(/\/admin\/access/, { timeout: 15000 });
    assert.equal(await page.locator(".clients-preview-banner").count(), 0);
    await page.goto("/clients", { waitUntil: "networkidle" });
    assert.ok((await fetchApiGuids(page, "clients")).length >= baselineGuids.length || role === "director");

    await context.close();
  }

  for (const role of ["manager", "regional", "rop", "director"] as RoleKey[]) {
    it("preview acceptance: " + role, async () => {
      await seedAllRoles();
      await startServer();

      for (const [viewportName, viewport] of [
        ["desktop", DESKTOP],
        ["mobile", MOBILE],
      ] as const) {
        await runRoleScenario(role, viewportName, viewport);
      }

      await stopServer();
    });
  }

  it("preview switch clears previous employee rows", async () => {
    await seedAllRoles();
    await startServer();

    const { context, page } = await newSession(DESKTOP);
    await login(page, "admin@example.com");
    await startPreviewViaApi(page, "rop");
    await waitForRoleReady(page, "rop");
    assert.ok(await page.locator(".clients-compact-team__member-name", { hasText: "Manager One" }).count());

    await startPreviewViaApi(page, "manager");
    await waitForRoleReady(page, "manager");
    assert.equal(await page.locator("#clients-page-title").textContent(), "Мои клиенты");
    assert.match(await page.locator(".clients-preview-banner").innerText(), /Иванов/);
    assert.equal(await page.locator(".clients-compact-team-list--single").count(), 0);
    const managerGuids = await fetchApiGuids(page, "clients");
    assert.ok(managerGuids.length >= 1);
    assert.ok(!managerGuids.includes(C2));

    await page.click("#clients-preview-stop-btn");
    await page.waitForURL(/\/admin\/access/, { timeout: 15000 });
    await context.close();
    await stopServer();
  });
});
