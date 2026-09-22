import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

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

describe("session lifecycle", { concurrency: false }, () => {
  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("rejects expired and revoked sessions", async () => {
    await createTestUser({
      databaseUrl,
      email: "expired@example.com",
      password: TEST_PASSWORD,
      fullName: "Expired User",
    });

    const app = await loadApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "expired@example.com", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      "UPDATE sessions SET expires_at = NOW() - interval '1 minute' WHERE revoked_at IS NULL",
    );
    await pool.end();
    resetPoolForTests();

    const expired = await request(await loadApp())
      .get("/api/auth/me")
      .set("Cookie", cookie);
    assert.equal(expired.status, 401);

    const login2 = await request(await loadApp())
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "expired@example.com", password: TEST_PASSWORD });
    const cookie2 = login2.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const pool2 = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool2.query(
      "UPDATE sessions SET revoked_at = NOW() WHERE revoked_at IS NULL",
    );
    await pool2.end();
    resetPoolForTests();

    const revoked = await request(await loadApp())
      .get("/api/auth/me")
      .set("Cookie", cookie2);
    assert.equal(revoked.status, 401);
  });

  it("rejects sessions after user is disabled", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "disable-me@example.com",
      password: TEST_PASSWORD,
      fullName: "Disable Me",
    });

    const app = await loadApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "disable-me@example.com", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]);
    await pool.end();
    resetPoolForTests();

    const me = await request(await loadApp()).get("/api/auth/me").set("Cookie", cookie);
    assert.equal(me.status, 401);
  });

  it("keeps session after app restart and isolates two users", async () => {
    await createTestUser({
      databaseUrl,
      email: "user-a@example.com",
      password: TEST_PASSWORD,
      fullName: "User A",
    });
    await createTestUser({
      databaseUrl,
      email: "user-b@example.com",
      password: TEST_PASSWORD,
      fullName: "User B",
    });

    const app1 = await loadApp();
    const loginA = await request(app1)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "user-a@example.com", password: TEST_PASSWORD });
    const cookieA = loginA.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    await closePool();
    resetPoolForTests();

    const app2 = await loadApp();
    const meA = await request(app2).get("/api/auth/me").set("Cookie", cookieA);
    assert.equal(meA.status, 200);
    assert.equal(meA.body.user.email, "user-a@example.com");

    const loginB = await request(app2)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "user-b@example.com", password: TEST_PASSWORD });
    const cookieB = loginB.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const profileB = await request(app2)
      .get("/api/profile/self")
      .set("Cookie", cookieB);
    assert.equal(profileB.body.user.email, "user-b@example.com");
    assert.notEqual(profileB.body.user.email, meA.body.user.email);
  });

  it("sets Secure attribute on session cookie in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { buildSessionCookie } = await import("../../src/auth/cookie");
    assert.match(buildSessionCookie("token"), /Secure/i);
    process.env.NODE_ENV = previous;
  });

  it("returns safe auth/profile errors for malformed JSON", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .set("Content-Type", "application/json")
      .send("{");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.doesNotMatch(JSON.stringify(res.body), /postgres|stack|DATABASE_URL/i);
  });
});
