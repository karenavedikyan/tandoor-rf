import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { USER_ROLES } from "../../src/shared/user";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import {
  insertFailedImportRun,
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertValidationFailedImportRun,
} from "../helpers/clients-db-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

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
  resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set(authHeaders())
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  const cookie = res.headers["set-cookie"]?.[0] ?? "";
  assert.match(cookie, /tandoor_rf_session=/);
  return cookie.split(";")[0] ?? "";
}

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const HOLDING_A = "44444444-4444-4444-8444-444444444444";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const CLIENT_THREE = "66666666-6666-4666-8666-666666666666";

describe("clients workspace integration", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Альфа Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "Москва, ул. Пример 1",
        telephone: ["+7 (999) 000-11-22", "+7 999 000 11 33"],
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Альфа Клиент",
        guid_holding: HOLDING_A,
        name_holding: "Холдинг Восток",
        guid_manager: MANAGER_B,
        name_manager: "Менеджер Петров",
        address: "Казань, проспект 10",
        telephone: [],
      },
      {
        guid_client: CLIENT_THREE,
        name_client: "Бета %_\"Клиент\"",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "Санкт-Петербург",
        telephone: ["8-800-555-35-35"],
      },
    ]);
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 3 });
  });

  after(async () => {
    await closePool();
  });

  it("denies unauthenticated and non-admin access on all clients APIs", async () => {
    const app = await loadApp();
    const paths = [
      "/api/clients",
      "/api/clients/options",
      "/api/clients/sync-status",
      `/api/clients/${CLIENT_ONE}`,
    ];

    for (const path of paths) {
      const anon = await request(app).get(path).set({ Origin: ORIGIN });
      assert.equal(anon.status, 401);
      assert.equal(anon.headers["cache-control"], "no-store");
    }

    const managerCookie = await login("manager@example.com");
    for (const path of paths) {
      const forbidden = await request(app).get(path).set(authHeaders(managerCookie));
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.headers["cache-control"], "no-store");
    }
  });

  it("lists clients with search, filters, total and stable pagination", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");

    const cyrillic = await request(app)
      .get("/api/clients?q=" + encodeURIComponent("альфа"))
      .set(authHeaders(adminCookie));
    assert.equal(cyrillic.status, 200);
    assert.equal(cyrillic.body.total, 2);
    assert.equal(cyrillic.headers["cache-control"], "no-store");

    const phone = await request(app)
      .get("/api/clients?q=" + encodeURIComponent("9990001122"))
      .set(authHeaders(adminCookie));
    assert.equal(phone.status, 200);
    assert.equal(phone.body.total, 1);
    assert.equal(phone.body.items[0].guid, CLIENT_ONE);

    const noPhone = await request(app)
      .get("/api/clients?phone=no")
      .set(authHeaders(adminCookie));
    assert.equal(noPhone.status, 200);
    assert.equal(noPhone.body.total, 1);
    assert.equal(noPhone.body.items[0].phonePreview.primary, null);

    const managerFilter = await request(app)
      .get(`/api/clients?manager=${MANAGER_A}`)
      .set(authHeaders(adminCookie));
    assert.equal(managerFilter.status, 200);
    assert.equal(managerFilter.body.total, 2);

    const pageOne = await request(app)
      .get("/api/clients?page=1&pageSize=2")
      .set(authHeaders(adminCookie));
    const pageTwo = await request(app)
      .get("/api/clients?page=2&pageSize=2")
      .set(authHeaders(adminCookie));
    assert.equal(pageOne.body.items.length, 2);
    assert.equal(pageTwo.body.items.length, 1);
    assert.notDeepEqual(pageOne.body.items[0].guid, pageTwo.body.items[0].guid);
  });

  it("returns one option per UUID with deterministic label", async () => {
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: "77777777-7777-4777-8777-777777777777",
        name_client: "Дубликат UUID",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов B",
        address: "Екатеринбург",
      },
    ]);

    const app = await loadApp();
    const adminCookie = await login("admin@example.com");
    const res = await request(app).get("/api/clients/options").set(authHeaders(adminCookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.managers.length, 2);
    assert.equal(res.body.holdings.length, 1);
    assert.ok(res.body.managers.every((item: { shortId: string }) => item.shortId.length === 8));
    const managerAOptions = res.body.managers.filter(
      (item: { id: string }) => item.id === MANAGER_A,
    );
    assert.equal(managerAOptions.length, 1);
    assert.equal(managerAOptions[0].name, "Менеджер Иванов");
  });

  it("returns client detail and validates UUID parameter", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");

    const invalid = await request(app)
      .get("/api/clients/not-a-uuid")
      .set(authHeaders(adminCookie));
    assert.equal(invalid.status, 400);

    const missing = await request(app)
      .get("/api/clients/77777777-7777-4777-8777-777777777777")
      .set(authHeaders(adminCookie));
    assert.equal(missing.status, 404);

    const detail = await request(app)
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(adminCookie));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.client.phones.length, 2);
    assert.equal(detail.body.client.phones[0].telHref, "+79990001122");
    assert.equal(detail.body.client.phones[1].telHref, "+79990001133");
  });

  it("reports sync status with last success and warning after failed import", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");

    const initial = await request(app)
      .get("/api/clients/sync-status")
      .set(authHeaders(adminCookie));
    assert.equal(initial.status, 200);
    assert.ok(initial.body.lastSuccessfulImportAt);
    assert.equal(initial.body.runningImport, false);
    assert.equal(initial.body.warning, null);

    await insertFailedImportRun(databaseUrl);
    resetPoolForTests();
    const appAfterFail = await loadApp();
    const afterFail = await request(appAfterFail)
      .get("/api/clients/sync-status")
      .set(authHeaders(adminCookie));
    assert.equal(afterFail.status, 200);
    assert.ok(afterFail.body.warning);
    assert.ok(afterFail.body.lastSuccessfulImportAt);
  });

  it("reports warning after validation_failed import", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");
    await insertValidationFailedImportRun(databaseUrl);
    resetPoolForTests();
    const res = await request(await loadApp())
      .get("/api/clients/sync-status")
      .set(authHeaders(adminCookie));
    assert.equal(res.status, 200);
    assert.ok(res.body.warning);
    assert.ok(res.body.lastSuccessfulImportAt);
  });

  it("rejects malformed list query parameters with 400", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");
    const invalidPage = await request(app)
      .get("/api/clients?page=1e308")
      .set(authHeaders(adminCookie));
    assert.equal(invalidPage.status, 400);
    assert.equal(invalidPage.headers["cache-control"], "no-store");

    const arrayQ = await request(app)
      .get("/api/clients?q%5B%5D=" + encodeURIComponent("альфа"))
      .set(authHeaders(adminCookie));
    assert.equal(arrayQ.status, 400);
  });

  it("denies every non-admin role on clients APIs", async () => {
    const app = await loadApp();
    const paths = [
      "/api/clients",
      "/api/clients/options",
      "/api/clients/sync-status",
      `/api/clients/${CLIENT_ONE}`,
    ];

    for (const role of USER_ROLES) {
      if (role === "admin") {
        continue;
      }
      await createTestUser({
        databaseUrl,
        email: `${role}-clients@example.com`,
        password: TEST_PASSWORD,
        fullName: role,
        role,
      });
      const cookie = await login(`${role}-clients@example.com`);
      for (const path of paths) {
        const res = await request(app).get(path).set(authHeaders(cookie));
        assert.equal(res.status, 403, `${role} should be forbidden on ${path}`);
        assert.equal(res.headers["cache-control"], "no-store");
      }
    }
  });

  it("denies disabled users and expired sessions on clients APIs", async () => {
    await createTestUser({
      databaseUrl,
      email: "disabled@example.com",
      password: TEST_PASSWORD,
      fullName: "Disabled User",
      role: "admin",
      status: "disabled",
    });

    const app = await loadApp();
    const disabledLogin = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "disabled@example.com", password: TEST_PASSWORD });
    assert.equal(disabledLogin.status, 401);

    const activeAdmin = await login("admin@example.com");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      "UPDATE sessions SET expires_at = NOW() - interval '1 minute' WHERE revoked_at IS NULL",
    );
    await pool.end();
    resetPoolForTests();

    const expired = await request(await loadApp())
      .get("/api/clients")
      .set(authHeaders(activeAdmin));
    assert.equal(expired.status, 401);
    assert.equal(expired.headers["cache-control"], "no-store");
  });

  it("returns 503 without leaking details when database is unavailable", async () => {
    const adminCookie = await login("admin@example.com");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("DROP TABLE IF EXISTS onec_clients CASCADE");
    await pool.end();
    resetPoolForTests();

    const app = await loadApp();
    const res = await request(app).get("/api/clients").set(authHeaders(adminCookie));
    assert.equal(res.status, 503);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.match(res.body.error.message, /недоступен|внутренняя ошибка сервера/i);
    assert.equal(typeof res.body.error.message, "string");
    assert.doesNotMatch(JSON.stringify(res.body), /password|secret|postgres|onec_clients|22P02|syntax error/i);
  });

  it("serves clients pages with no-store and keeps auth/profile health working", async () => {
    const app = await loadApp();
    const listPage = await request(app).get("/clients");
    assert.equal(listPage.status, 200);
    assert.match(listPage.text, /Клиенты/);
    assert.equal(listPage.headers["cache-control"], "no-store");

    const detailPage = await request(app).get(`/clients/${CLIENT_ONE}`);
    assert.equal(detailPage.status, 200);
    assert.match(detailPage.text, /client-detail.js/);

    const health = await request(app).get("/api/health");
    assert.equal(health.status, 200);
  });
});
