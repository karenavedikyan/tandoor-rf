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

async function installRevokeFault(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(`
    CREATE OR REPLACE FUNCTION block_session_revoke()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'revoke blocked for test';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER block_session_revoke_trg
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
    EXECUTE FUNCTION block_session_revoke();
  `);
  await pool.end();
}

async function removeRevokeFault(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query("DROP TRIGGER IF EXISTS block_session_revoke_trg ON sessions");
  await pool.query("DROP FUNCTION IF EXISTS block_session_revoke()");
  await pool.end();
}

describe("logout failure handling", { concurrency: false }, () => {
  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await removeRevokeFault().catch(() => undefined);
    await closePool();
  });

  it("returns 503 and keeps session active when revoke fails", async () => {
    await createTestUser({
      databaseUrl,
      email: "logout-fail@example.com",
      password: TEST_PASSWORD,
      fullName: "Logout Fail User",
    });

    const app = await loadApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "logout-fail@example.com", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    await installRevokeFault();
    resetPoolForTests();

    const logout = await request(await loadApp())
      .post("/api/auth/logout")
      .set(authHeaders(cookie))
      .send({});
    assert.equal(logout.status, 503);
    assert.equal(logout.headers["cache-control"], "no-store");
    assert.match(logout.body.error.message, /Не удалось завершить выход/i);
    assert.equal(logout.headers["set-cookie"], undefined);

    const me = await request(await loadApp())
      .get("/api/auth/me")
      .set("Cookie", cookie);
    assert.equal(me.status, 200);
  });
});
