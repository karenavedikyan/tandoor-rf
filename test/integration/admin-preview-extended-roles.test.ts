import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { QA_PASSWORD, seedAssignmentQa } from "../helpers/assistant-assignment-fixtures";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
  createTestUser,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, password = QA_PASSWORD): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set(authHeaders())
    .send({ email, password });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("admin preview: coordinator, assistant and candidate eligibility", { concurrency: false }, () => {
  let databaseUrl = "";
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    users = await seedAssignmentQa(databaseUrl, ORIGIN);
  });

  after(async () => {
    await closePool();
  });

  it("lists coordinator in preview and opens assignments workspace read-only", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: users.coordinator!.id });
    assert.equal(start.status, 200);

    const assignments = await request(app)
      .get("/api/access/assignments?page=1")
      .set(authHeaders(adminCookie));
    assert.equal(assignments.status, 200);

    const write = await request(app)
      .post("/api/access/delegations")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(write.status, 403);

    await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});
  });

  it("marks unlinkable managers in candidate search without allowing start", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const orphan = await createTestUser({
      databaseUrl,
      email: "orphan-manager@example.test",
      password: QA_PASSWORD,
      fullName: "Тест: Без связи",
      role: "manager",
    });
    await pool.end();

    const list = await request(app)
      .get("/api/admin/access/preview/candidates?q=Без%20связи")
      .set(authHeaders(adminCookie));
    assert.equal(list.status, 200);
    const row = list.body.items.find((item: { id: string }) => item.id === orphan.id);
    assert.ok(row);
    assert.equal(row.canSelect, false);
    assert.match(row.blockReason, /связ/i);

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: orphan.id });
    assert.equal(start.status, 400);

    const me = await request(app).get("/api/auth/me").set(authHeaders(adminCookie));
    assert.equal(me.body.preview.active, false);
  });

  it("scopes assistant preview to assigned clients only", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: users.assistant!.id });
    assert.equal(start.status, 200);

    const clients = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(clients.status, 200);
    assert.ok(clients.body.total >= 0);

    const notifications = await request(app)
      .get("/api/access/notifications?page=1")
      .set(authHeaders(adminCookie));
    assert.equal(notifications.status, 200);

    const markRead = await request(app)
      .post("/api/access/notifications/read-all")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(markRead.status, 403);
  });
});
