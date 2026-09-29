import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const SCREENSHOT_DIR =
  process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(process.cwd(), "test-results", "screenshots");

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_THREE = "66666666-6666-4666-8666-666666666666";

let databaseUrl = "";
let baseUrl = "";
let managerAUserId = "";
let ropUserId = "";
let assistantUserId = "";
let coordinatorUserId = "";

async function loginViaServer(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  assert.equal(res.status, 200, `login failed for ${email}: ${await res.text()}`);
  const cookieHeader = res.headers.get("set-cookie") ?? "";
  return cookieHeader.split(";")[0] ?? "";
}

async function apiPost(path: string, body: unknown, cookie: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Accept: "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function apiGet(path: string, cookie: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Origin: baseUrl, Accept: "application/json", Cookie: cookie },
  });
  return { status: res.status };
}

describe("access workspace e2e (real PostgreSQL)", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  async function seedDatabase() {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);

    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    managerAUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-a@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager A",
        role: "manager",
      })
    ).id;
    ropUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP",
        role: "rop",
      })
    ).id;
    assistantUserId = (
      await createTestUser({
        databaseUrl,
        email: "assistant@example.com",
        password: TEST_PASSWORD,
        fullName: "Assistant",
        role: "assistant",
      })
    ).id;
    coordinatorUserId = (
      await createTestUser({
        databaseUrl,
        email: "coordinator@example.com",
        password: TEST_PASSWORD,
        fullName: "Coordinator",
        role: "coordinator",
      })
    ).id;

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Альфа Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
        address: "Москва",
        telephone: [],
      },
      {
        guid_client: CLIENT_THREE,
        name_client: "Gamma",
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
        address: "СПб",
        telephone: [],
      },
    ]);
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 2 });

    setIntegrationEnv(databaseUrl, ORIGIN);
    const app = await loadApp();
    const adminCookie = (
      await request(app)
        .post("/api/auth/login")
        .set(authHeaders())
        .send({ email: "admin@example.com", password: TEST_PASSWORD })
    ).headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    for (const [userId, employeeId] of [
      [managerAUserId, MANAGER_A],
      [ropUserId, "77777777-7777-4777-8777-777777777777"],
      [assistantUserId, "99999999-9999-4999-8999-999999999999"],
    ] as const) {
      await request(app)
        .post("/api/admin/access/employee-links")
        .set(authHeaders(adminCookie))
        .send({ userId, employeeId, basis: "e2e" });
    }
    await request(app)
      .post("/api/admin/access/rop-teams")
      .set(authHeaders(adminCookie))
      .send({ ropUserId, memberUserId: managerAUserId, basis: "e2e team" });
    await request(app)
      .post("/api/admin/access/coordinator-teams")
      .set(authHeaders(adminCookie))
      .send({ coordinatorUserId, ropUserId, basis: "e2e coord" });
  }

  async function startTestServer() {
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp()).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => {
      server.on("listening", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        process.env.APP_ORIGIN = baseUrl;
        resolve();
      });
    });
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  after(async () => {
    await browser.close();
    await closePool();
  });

  async function contextWithCookie(cookie: string) {
    const [nameValue] = cookie.split(";");
    const [name, value] = nameValue.split("=");
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      baseURL: baseUrl,
    });
    await context.addCookies([
      {
        name,
        value: decodeURIComponent(value),
        url: baseUrl,
      },
    ]);
    return context;
  }

  it("full delegation flow: manager → ROP approve → assistant access → change → revoke", async () => {
    await seedDatabase();
    await startTestServer();
    const managerCookie = await loginViaServer("manager-a@example.com");
    const ropCookie = await loginViaServer("rop@example.com");
    const assistantCookie = await loginViaServer("assistant@example.com");

    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await apiPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "e2e flow",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const managerCtx = await contextWithCookie(managerCookie);
    const managerPage = await managerCtx.newPage();
    await managerPage.goto("/access", { waitUntil: "networkidle" });
    await managerPage.waitForSelector("button:has-text('Состав')");
    assert.equal(await managerPage.locator("text=<button").count(), 0);
    await managerPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "r13-e2e-manager-list.png"),
      fullPage: true,
    });
    await managerCtx.close();

    const pendingAssistant = await apiGet(`/api/clients/${CLIENT_ONE}`, assistantCookie);
    assert.equal(pendingAssistant.status, 404);

    const ropCtx = await contextWithCookie(ropCookie);
    const ropPage = await ropCtx.newPage();
    await ropPage.goto("/access", { waitUntil: "networkidle" });
    await ropPage.locator("button", { hasText: "Согласовать" }).first().click();
    await ropPage.waitForSelector("#section-delegation-detail:not(.clients-hidden)");
    await ropPage.locator("button", { hasText: "Подтвердить согласование" }).click();
    await ropPage.locator("#access-workspace-status").filter({ hasText: "согласовано" }).waitFor({
      timeout: 5000,
    });
    await ropPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "r13-e2e-rop-detail.png"),
      fullPage: true,
    });
    await ropCtx.close();

    const activeAssistant = await apiGet(`/api/clients/${CLIENT_ONE}`, assistantCookie);
    assert.equal(activeAssistant.status, 200);

    const change = await apiPost(
      `/api/access/delegations/${delegationId}/change-requests`,
      {
        clientGuids: [CLIENT_ONE, CLIENT_THREE],
        startsAt,
        endsAt,
        basis: "e2e expand",
      },
      managerCookie,
    );
    assert.equal(change.status, 201);

    const blockedExpand = await apiGet(`/api/clients/${CLIENT_THREE}`, assistantCookie);
    assert.equal(blockedExpand.status, 404);

    await apiPost(
      `/api/access/delegations/change-requests/${change.body.id}/approve`,
      { basis: "e2e approve change" },
      ropCookie,
    );

    const expanded = await apiGet(`/api/clients/${CLIENT_THREE}`, assistantCookie);
    assert.equal(expanded.status, 200);

    await apiPost(
      `/api/access/delegations/${delegationId}/revoke`,
      { basis: "e2e revoke", reason: "done" },
      ropCookie,
    );

    const afterRevoke = await apiGet(`/api/clients/${CLIENT_ONE}`, assistantCookie);
    assert.equal(afterRevoke.status, 404);
  });

  it("coordinator scoped create uses team managers only", async () => {
    await seedDatabase();
    await startTestServer();
    const coordinatorCookie = await loginViaServer("coordinator@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await apiPost(
      "/api/access/delegations",
      {
        delegatorUserId: managerAUserId,
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "coord e2e",
      },
      coordinatorCookie,
    );
    assert.equal(create.status, 201);

    const ctx = await contextWithCookie(coordinatorCookie);
    const page = await ctx.newPage();
    await page.goto("/access", { waitUntil: "networkidle" });
    await page.waitForSelector("#section-coordinator:not(.clients-hidden)");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "r13-e2e-coordinator.png"),
      fullPage: true,
    });
    await ctx.close();
  });
});
