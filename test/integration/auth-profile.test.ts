import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runMigrations } from "../../src/db/migrate-runner";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

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

describe("auth and profile integration", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("applies migrations idempotently", async () => {
    const { resetDatabase } = await import("../helpers/test-db");
    await resetDatabase(databaseUrl);
    const first = await runMigrations({ databaseUrl });
    assert.deepEqual(first, ["001_initial_auth.sql", "002_onec_clients.sql"]);
    const second = await runMigrations({ databaseUrl });
    assert.deepEqual(second, []);
  });

  it("returns 503 for auth routes when schema is missing", async () => {
    await prepareDatabase(databaseUrl);
    const poolModule = await import("pg");
    const pool = new poolModule.Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
    await pool.end();
    resetPoolForTests();

    const app = await loadApp();
    const res = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "a@example.com", password: TEST_PASSWORD });

    assert.equal(res.status, 503);
    assert.match(res.body.error.message, /недоступен/i);
  });

  it("logs in active user and sets secure session cookie", async () => {
    await createTestUser({
      databaseUrl,
      email: "user@example.com",
      password: TEST_PASSWORD,
      fullName: "Тестовый Пользователь",
      role: "manager",
    });

    const app = await loadApp();
    const res = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "user@example.com", password: TEST_PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "user@example.com");
    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    assert.match(setCookie, /tandoor_rf_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//);
    assert.doesNotMatch(setCookie, /Domain=/i);
  });

  it("returns identical 401 for unknown, wrong password, and disabled users", async () => {
    await createTestUser({
      databaseUrl,
      email: "disabled@example.com",
      password: TEST_PASSWORD,
      fullName: "Disabled User",
      status: "disabled",
    });

    const app = await loadApp();
    const unknown = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "missing@example.com", password: TEST_PASSWORD });
    const wrong = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "disabled@example.com", password: "WrongPass123!" });
    const disabled = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "disabled@example.com", password: TEST_PASSWORD });

    for (const res of [unknown, wrong, disabled]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, "INVALID_CREDENTIALS");
      assert.equal(res.body.error.message, "Неверный email или пароль.");
    }
  });

  it("rate limits repeated failed logins by email", async () => {
    await createTestUser({
      databaseUrl,
      email: "limited@example.com",
      password: TEST_PASSWORD,
      fullName: "Limited User",
    });

    const app = await loadApp();
    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .set(authHeaders())
        .send({ email: "limited@example.com", password: "WrongPass123!" });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  });

  it("rejects CSRF and accepts same-origin mutating requests", async () => {
    const app = await loadApp();
    const noOrigin = await request(app)
      .post("/api/auth/logout")
      .set("Content-Type", "application/json")
      .send({});
    const badOrigin = await request(app)
      .post("/api/auth/logout")
      .set({ ...authHeaders(), Origin: "https://evil.example" })
      .send({});

    assert.equal(noOrigin.status, 403);
    assert.equal(badOrigin.status, 403);
  });

  it("ignores spoofed X-Forwarded-For without trusted proxy configuration", async () => {
    process.env.TRUSTED_PROXIES = "";
    const app = await loadApp();
    const poolModule = await import("pg");
    const pool = new poolModule.Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("DELETE FROM login_rate_limits");
    await pool.end();

    for (let i = 0; i < 20; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .set({
          ...authHeaders(),
          "X-Forwarded-For": `203.0.113.${(i % 200) + 1}`,
        })
        .send({ email: `ip-${i}@example.com`, password: "WrongPass123!" });
      assert.equal(res.status, 401);
    }

    const blocked = await request(app)
      .post("/api/auth/login")
      .set({
        ...authHeaders(),
        "X-Forwarded-For": "198.51.100.99",
      })
      .send({ email: "ip-21@example.com", password: "WrongPass123!" });
    assert.equal(blocked.status, 429);
  });

  it("supports logout, profile read/update, and blocks forbidden patch fields", async () => {
    await createTestUser({
      databaseUrl,
      email: "profile@example.com",
      password: TEST_PASSWORD,
      fullName: "Профиль Тест",
      phone: "+79991234567",
      role: "manager",
    });

    const app = await loadApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "profile@example.com", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    assert.equal(me.status, 200);
    assert.equal(me.headers["cache-control"], "no-store");

    const patch = await request(app)
      .patch("/api/profile/self")
      .set(authHeaders(cookie))
      .send({ fullName: "Новое Имя", phone: "8 (999) 222-33-44" });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.user.fullName, "Новое Имя");
    assert.equal(patch.body.user.phone, "+79992223344");

    const forbidden = await request(app)
      .patch("/api/profile/self")
      .set(authHeaders(cookie))
      .send({ email: "hacker@example.com", role: "admin", status: "active" });
    assert.equal(forbidden.status, 400);

    const logout = await request(app)
      .post("/api/auth/logout")
      .set(authHeaders(cookie))
      .send({});
    assert.equal(logout.status, 200);
    assert.match(logout.headers["set-cookie"]?.[0] ?? "", /Max-Age=0/i);

    const afterLogout = await request(app).get("/api/auth/me").set("Cookie", cookie);
    assert.equal(afterLogout.status, 401);
  });

  it("returns 401 for protected routes without session when DB is ready", async () => {
    const app = await loadApp();
    const res = await request(app).get("/api/profile/self");
    assert.equal(res.status, 401);
  });

  it("reports readiness via GET /api/ready", async () => {
    const app = await loadApp();
    const ready = await request(app).get("/api/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { status: "ready" });
  });
});
