import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { getPool } from "../../src/db/pool";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const SYNTH_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
const MARKER = "SYNTH_HTTP_TANBOT_TOKEN_MARKER";
const PATH = "/api/admin/tanbot-telegram/diagnostics";

const TANBOT_ENV_KEYS = [
  "TANBOT_TELEGRAM_ENABLED",
  "TANBOT_TELEGRAM_BOT_TOKEN",
  "TANBOT_TELEGRAM_EXPECTED_USERNAME",
] as const;

let databaseUrl = "";
let savedTanbotEnv: Record<string, string | undefined> = {};

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function saveTanbotEnv(): void {
  savedTanbotEnv = {};
  for (const key of TANBOT_ENV_KEYS) {
    savedTanbotEnv[key] = process.env[key];
  }
}

function restoreTanbotEnv(): void {
  for (const key of TANBOT_ENV_KEYS) {
    const value = savedTanbotEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setTanbotEnv(partial: Record<string, string>): void {
  for (const key of TANBOT_ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, partial);
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set(authHeaders())
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("tanbot telegram admin diagnostics HTTP", { concurrency: false }, () => {
  let adminCookie = "";
  let managerCookie = "";
  let managerUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    saveTanbotEnv();

    const admin = await createTestUser({
      databaseUrl,
      email: "tanbot-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Tanbot Admin",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "tanbot-manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Tanbot Manager",
      role: "manager",
    });
    managerUserId = manager.id;
    const employeeId = randomUUID();
    const pool = getPool();
    assert.ok(pool);
    await pool.query(
      `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
       VALUES ($1::uuid, 'Tanbot Manager', 'Manager', '{}')`,
      [employeeId],
    );
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId,
      confirmedByUserId: admin.id,
    });
    adminCookie = await login("tanbot-admin@example.com");
    managerCookie = await login("tanbot-manager@example.com");
  });

  afterEach(() => {
    restoreTanbotEnv();
  });

  after(async () => {
    restoreTanbotEnv();
    await closePool();
    resetPoolForTests();
  });

  it("returns 401 for anonymous requests", async () => {
    setTanbotEnv({ TANBOT_TELEGRAM_ENABLED: "false" });
    const app = await loadApp();
    const res = await request(app).get(PATH).set(authHeaders());
    assert.equal(res.status, 401);
  });

  it("returns 403 for manager", async () => {
    setTanbotEnv({ TANBOT_TELEGRAM_ENABLED: "false" });
    const app = await loadApp();
    const res = await request(app).get(PATH).set(authHeaders(managerCookie));
    assert.equal(res.status, 403);
  });

  it("returns 403 for admin employee preview", async () => {
    setTanbotEnv({ TANBOT_TELEGRAM_ENABLED: "false" });
    const app = await loadApp();
    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ targetUserId: managerUserId });
    assert.equal(start.status, 200);
    const res = await request(app).get(PATH).set(authHeaders(adminCookie));
    assert.equal(res.status, 403);
    await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});
  });

  it("admin local diagnostics returns LOCAL_OK without token leak", async () => {
    setTanbotEnv({
      TANBOT_TELEGRAM_ENABLED: "true",
      TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
      TANBOT_TELEGRAM_EXPECTED_USERNAME: "TANDOOR_IBOT",
    });
    const app = await loadApp();
    const res = await request(app).get(PATH).set(authHeaders(adminCookie));
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.status, "LOCAL_OK");
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(MARKER));
    assert.doesNotMatch(JSON.stringify(res.body), /123456789:/);
  });

  it("admin CONFIG_ERROR does not echo secret in expectedUsername", async () => {
    setTanbotEnv({
      TANBOT_TELEGRAM_ENABLED: "true",
      TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
      TANBOT_TELEGRAM_EXPECTED_USERNAME: SYNTH_TOKEN,
    });
    const app = await loadApp();
    const res = await request(app).get(PATH).set(authHeaders(adminCookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "CONFIG_ERROR");
    assert.equal(res.body.expectedUsername, "TANDOOR_IBOT");
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(MARKER));
  });

  it("admin live=1 with mocked upstream returns API_ERROR for invalid webhook", async () => {
    setTanbotEnv({
      TANBOT_TELEGRAM_ENABLED: "true",
      TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
      TANBOT_TELEGRAM_EXPECTED_USERNAME: "TANDOOR_IBOT",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/getMe")) {
        return new Response(
          JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: "TANDOOR_IBOT" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/getWebhookInfo")) {
        return new Response(JSON.stringify({ ok: true, result: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const app = await loadApp();
      const res = await request(app).get(`${PATH}?live=1`).set(authHeaders(adminCookie));
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "API_ERROR");
      assert.equal(res.body.webhookConfigured, null);
      assert.doesNotMatch(JSON.stringify(res.body), new RegExp(MARKER));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
