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
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const SCREENSHOT_DIR =
  process.env.CLIENTS_LKTANDOOR_STAGE3_DIR ??
  "/cursor/stores/self/media/clients-lktandoor-x13-teams-pairs/app";

function clientsBytesForStage3Teams() {
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

async function closePageSafely(page: Page) {
  await page.unrouteAll({ behavior: "wait" });
  await page.close();
}

async function seed(databaseUrl: string) {
  const admin = await createTestUser({
    databaseUrl,
    email: "admin-stage3-teams@example.com",
    password: TEST_PASSWORD,
    fullName: "Admin Stage3",
    role: "admin",
  });
  const director = await createTestUser({
    databaseUrl,
    email: "director-stage3-teams@example.com",
    password: TEST_PASSWORD,
    fullName: "Director Stage3",
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
    email: "rop-stage3-teams@example.com",
    password: TEST_PASSWORD,
    fullName: "ROP Stage3",
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
    email: "manager-stage3-teams@example.com",
    password: TEST_PASSWORD,
    fullName: "Manager Stage3",
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
  const dry = await runExchangeV3RegularUpdate({
    env: { ...process.env, DATABASE_URL: databaseUrl },
    argv: ["--dry-run"],
    holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
    clientsBytes: clientsBytesForStage3Teams(),
    retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
    employeesBytes,
  });
  assert.equal(dry.status, "SUCCESS");
  await runExchangeV3RegularUpdate({
    env: { ...process.env, DATABASE_URL: databaseUrl },
    argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
    holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
    clientsBytes: clientsBytesForStage3Teams(),
    retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
    employeesBytes,
  });
}

describe("lktandoor stage3 teams navigation", { concurrency: false }, () => {
  let browser: Browser;
  let appServer: http.Server | null = null;
  let baseUrl = "";

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:0");
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
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/profile" || url.pathname === "/clients", { timeout: 30000 });
  }

  async function waitTeamsDirectoryReady(page: Page) {
    await page.waitForSelector('[data-testid="v3-lktandoor-chrome"]:not(.clients-hidden)', { timeout: 30000 });
    await page.waitForSelector(".clients-x13-directory, .clients-compact-team", { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const back = document.querySelector('[data-testid="v3-lktandoor-back"]');
        const contextNav = document.getElementById("v3-lktandoor-context-nav");
        if (back) return false;
        if (!contextNav || contextNav.classList.contains("clients-hidden")) return false;
        if (!contextNav.textContent?.includes("Мои РОПы")) return false;
        return document.querySelectorAll(".clients-x13-directory, .clients-compact-team").length > 0;
      },
      undefined,
      { timeout: 30000 },
    );
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
    await page.waitForFunction(
      () => {
        const count = document.getElementById("clients-result-count");
        if (!count) return true;
        const text = (count.textContent || "").trim();
        return text.length > 0 && !/Загрузка/i.test(text);
      },
      undefined,
      { timeout: 30000 },
    );
  }

  async function waitForClientRow(page: Page, label: string) {
    await waitListSettled(page);
    const row = page.locator("#clients-table-body tr").filter({ hasText: label });
    await row.first().waitFor({ state: "visible", timeout: 30000 });
    assert.ok((await row.count()) > 0);
  }

  it("director teams directory shows lktandoor chrome and ROP roster navigation", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "director-stage3-teams@example.com");
    await page.goto(baseUrl + "/clients?v3mode=1&v3view=teams&view=teams");
    await waitTeamsDirectoryReady(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "app-director-teams-1440.png") });

    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/responsibles") && res.status() === 200,
        { timeout: 30000 },
      ),
      page.locator('[data-open-rop-team="' + ROP + '"]').click(),
    ]);
    await page.waitForURL((url) => url.search.includes("ropEmployee=" + ROP), { timeout: 30000 });
    await page.waitForSelector('.x13-person[data-manager="' + HW + '"]', { timeout: 15000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "app-director-staff-1440.png") });
    const hwRow = page.locator('.x13-person[data-manager="' + HW + '"]');
    await hwRow.first().waitFor({ state: "visible" });
    const hwSubtitle = (await hwRow.first().locator("small").textContent()) ?? "";
    assert.match(hwSubtitle, /продажи|фурнитура/i);
    assert.match(hwSubtitle, /фурнитура/i);

    const hardwareRow = page.locator('.x13-person[data-manager="' + HW + '"]');
    await hardwareRow.first().click();
    await page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await waitListSettled(page);
    assert.ok(page.url().includes("responsibleGuid=" + HW));
    assert.equal(await page.locator('[data-testid="clients-team-member-switcher"]').count(), 0);
    assert.equal(await page.locator(".x13-person").count(), 0);
    await page.waitForFunction(
      () => {
        const title = document.getElementById("v3-lktandoor-scope-title");
        const nav = document.getElementById("v3-lktandoor-context-nav");
        if (!title || !nav) return false;
        const titleText = title.textContent || "";
        return titleText.includes("Территория:") && titleText.includes("Бойко") && !titleText.includes("Вся база");
      },
      undefined,
      { timeout: 30000 },
    );
    const territoryReturnUrl = page.url();
    await page.locator("#clients-table-body tr a").first().click();
    await page.waitForURL((url) => /^\/clients\/[^/?#]+/.test(url.pathname), { timeout: 30000 });
    await page.locator('[data-testid="v3-back-to-list"]').click();
    await page.waitForURL((url) => url.pathname === "/clients" && url.search.includes("responsibleGuid=" + HW), {
      timeout: 30000,
    });
    await waitListSettled(page);
    await page.waitForFunction(
      () => {
        const title = document.getElementById("v3-lktandoor-scope-title");
        const nav = document.getElementById("v3-lktandoor-context-nav");
        if (!title || !nav) return false;
        const titleText = title.textContent || "";
        const navText = nav.textContent || "";
        return (
          titleText.includes("Территория:") &&
          titleText.includes("Бойко") &&
          navText.includes("Бойко") &&
          !titleText.includes("Вся база")
        );
      },
      undefined,
      { timeout: 30000 },
    );
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "teams-territory-after-card-back-1440.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "teams-territory-after-card-back-390.png"),
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(territoryReturnUrl);
    await waitListSettled(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "teams-territory-desktop-1440.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await waitListSettled(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "teams-territory-mobile-390.png") });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-testid="v3-lktandoor-back"]').click();
    await page.waitForSelector('.x13-person[data-manager="' + HW + '"]', { timeout: 15000 });
    assert.ok(!page.url().includes("responsibleGuid="));
    assert.ok(page.url().includes("ropEmployee="));

    await page.locator('[data-testid="v3-lktandoor-back"]').click();
    await waitTeamsDirectoryReady(page);
    assert.ok(!page.url().includes("ropEmployee="));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await waitTeamsDirectoryReady(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "app-director-teams-390.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-open-rop-team="' + ROP + '"]').click();
    await page.waitForSelector('.x13-person[data-manager="' + HW + '"]', { timeout: 15000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "app-director-staff-390.png") });
    await closePageSafely(page);
  });

  it("direct load and reload preserve territory vs roster modes", async () => {
    const territoryUrl =
      baseUrl +
      "/clients?view=teams&teamExpand=" +
      ROP +
      "&v3mode=1&v3entity=legal_grouped&v3view=teams&page=1&ropEmployee=" +
      ROP +
      "&responsibleGuid=" +
      HW +
      "&responsibleKind=hardware&teamKind=hardware";
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "director-stage3-teams@example.com");
    await page.goto(territoryUrl);
    await waitListSettled(page);
    assert.equal(await page.locator(".x13-person").count(), 0);
    await page.waitForFunction(
      () => {
        const title = document.getElementById("v3-lktandoor-scope-title");
        return Boolean(title && (title.textContent || "").includes("Территория:"));
      },
      undefined,
      { timeout: 30000 },
    );
    await page.reload();
    await waitListSettled(page);
    assert.equal(await page.locator(".x13-person").count(), 0);
    await page.waitForFunction(
      () => {
        const title = document.getElementById("v3-lktandoor-scope-title");
        return Boolean(title && (title.textContent || "").includes("Территория:"));
      },
      undefined,
      { timeout: 30000 },
    );

    await page.goto(
      baseUrl +
        "/clients?v3mode=1&v3view=teams&view=teams&ropEmployee=" +
        ROP +
        "&teamExpand=" +
        ROP,
    );
    await page.waitForSelector('.x13-person[data-manager="' + HW + '"]', { timeout: 15000 });
    assert.ok(!page.url().includes("responsibleGuid="));
    await page.reload();
    await page.waitForSelector('.x13-person[data-manager="' + HW + '"]', { timeout: 15000 });
    await closePageSafely(page);
  });

  it("rop enters own team roster and opens scoped manager clients", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "rop-stage3-teams@example.com");
    const orgOverview = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/clients/v3/org-structure") && res.status() === 200,
        { timeout: 30000 },
      ),
      page.goto(baseUrl + "/clients?view=teams"),
    ]).then(([res]) => res);
    await page.waitForURL((url) => url.search.includes("view=teams"), { timeout: 30000 });
    const overviewBody = (await orgOverview.json()) as {
      rops: { employeeGuid: string }[];
      selfRopEmployeeGuid?: string;
    };
    assert.equal(overviewBody.rops[0]?.employeeGuid, ROP_FOREIGN, "foreign ROP must stay first in API roster");
    assert.equal(overviewBody.selfRopEmployeeGuid, ROP);
    await page.waitForResponse(
      (res) => res.url().includes("/responsibles") && res.status() === 200,
      { timeout: 30000 },
    );
    assert.ok(page.url().includes("ropEmployee=" + ROP));
    assert.ok(!page.url().includes("ropEmployee=" + ROP_FOREIGN));
    await page.waitForSelector('.x13-person[data-manager="' + M2 + '"]', { timeout: 30000 });
    assert.equal(await page.locator("[data-open-rop-team]").count(), 0);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "teams-rop-own-roster-desktop-1440.png") });

    const managerRow = page.locator('.x13-person[data-manager="' + M2 + '"][data-responsible-kind="manager"]');
    await managerRow.first().click();
    await page.waitForResponse(
      (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
      { timeout: 30000 },
    );
    await waitForClientRow(page, LEGAL_TWO_LABEL);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "teams-rop-territory-desktop-1440.png") });

    await page.locator("#clients-table-body tr a").first().click();
    await page.waitForURL((url) => /^\/clients\/[^/?#]+/.test(url.pathname), { timeout: 30000 });
    const cardBack = page.locator('[data-testid="v3-back-to-list"]');
    await cardBack.waitFor({ state: "visible", timeout: 15000 });
    await cardBack.click();
    await page.waitForURL((url) => url.pathname === "/clients" && url.search.includes("responsibleGuid=" + M2), {
      timeout: 30000,
    });
    await waitForClientRow(page, LEGAL_TWO_LABEL);

    await page.locator('[data-testid="v3-lktandoor-back"]').click();
    await page.waitForSelector('.x13-person[data-manager="' + M2 + '"]', { timeout: 15000 });
    assert.ok(page.url().includes("ropEmployee=" + ROP));
    assert.ok(!page.url().includes("responsibleGuid="));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForSelector('.x13-person[data-manager="' + M2 + '"]', { timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "app-rop-staff-390.png") });
    await closePageSafely(page);
  });

  it("rop territory deep link hides foreign roster block", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "rop-stage3-teams@example.com");
    const territoryUrl =
      baseUrl +
      "/clients?view=teams&v3mode=1&v3entity=legal_grouped&v3view=teams&page=1&ropEmployee=" +
      ROP +
      "&responsibleGuid=" +
      HW +
      "&responsibleKind=hardware&teamKind=hardware";
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/clients/v3/list") && res.status() === 200,
        { timeout: 30000 },
      ),
      page.goto(territoryUrl),
    ]);
    await waitListSettled(page);
    assert.equal(await page.locator(".x13-person").count(), 0);
    assert.equal(await page.locator('[data-testid="clients-team-member-switcher"]').count(), 0);
    await page.locator('[data-testid="v3-lktandoor-back"]').click();
    await page.waitForSelector('.x13-person[data-manager="' + HW + '"]', { timeout: 15000 });
    assert.ok(page.url().includes("ropEmployee=" + ROP));
    await closePageSafely(page);
  });

  it("rop missing self identity shows controlled empty state without roster requests", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    const responsiblesUrls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/responsibles")) {
        responsiblesUrls.push(req.url());
      }
    });
    await page.route("**/api/clients/presentation", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { presentation?: { selfRopEmployeeGuid?: string | null } };
      if (body.presentation) {
        body.presentation.selfRopEmployeeGuid = null;
      }
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.route("**/api/clients/v3/org-structure", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { selfRopEmployeeGuid?: string | null };
      body.selfRopEmployeeGuid = null;
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await login(page, "rop-stage3-teams@example.com");
    await page.goto(baseUrl + "/clients?view=teams");
    await page.waitForURL((url) => url.search.includes("view=teams"), { timeout: 30000 });
    await page.waitForFunction(
      () =>
        document.querySelector(".clients-compact-team--empty") !== null ||
        /нет подтверждённой привязки/i.test(document.body.textContent || ""),
      undefined,
      { timeout: 15000 },
    );
    assert.ok(!page.url().includes("ropEmployee="));
    assert.equal(responsiblesUrls.length, 0);
    assert.equal(await page.locator(".clients-compact-team__members--loading").count(), 0);
    assert.equal(pageErrors.length, 0, pageErrors.join("; "));
    await closePageSafely(page);
  });
});
