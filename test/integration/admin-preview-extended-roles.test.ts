import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { QA_PASSWORD, seedAssignmentQa, LEGAL, EMP } from "../helpers/assistant-assignment-fixtures";
import {
  getIntegrationDatabaseUrl,
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

async function startPreview(adminCookie: string, userId: string) {
  const app = await loadApp();
  return request(app)
    .post("/api/admin/access/preview/start")
    .set(authHeaders(adminCookie))
    .send({ userId });
}

describe("admin preview: coordinator, assistant and candidate eligibility", { concurrency: false }, () => {
  let databaseUrl = "";
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>;
  let pool: Pool;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    setIntegrationEnv(databaseUrl, ORIGIN);
    users = await seedAssignmentQa(databaseUrl, ORIGIN);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await pool.query("DELETE FROM delegations");
    await pool.query("DELETE FROM assistant_assignment_notifications");
    await pool.query("DELETE FROM director_base_access_grants WHERE basis LIKE 'Explicit synthetic%'");
  });

  after(async () => {
    await pool?.end();
    await closePool();
  });

  async function createApprovedDelegation(clientGuids: string[]) {
    const app = await loadApp();
    const createRes = await request(app)
      .post("/api/access/delegations")
      .set(authHeaders(await login(users.manager!.email)))
      .send({
        assistantUserId: users.assistant!.id,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000 * 5).toISOString(),
        clientGuids,
        basis: "Тестовое назначение для preview.",
      });
    assert.equal(createRes.status, 201);
    const id = createRes.body.id as string;
    const decide = await request(app)
      .post("/api/access/delegations/" + id + "/approve")
      .set(authHeaders(await login(users.coordinator!.email)))
      .send({ basis: "Согласовано для теста preview." });
    assert.equal(decide.status, 200);
    return id;
  }

  it("lists coordinator in preview and opens assignments workspace read-only", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();

    assert.equal((await startPreview(adminCookie, users.coordinator!.id)).status, 200);

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
    const orphan = await createTestUser({
      databaseUrl,
      email: "orphan-manager@example.test",
      password: QA_PASSWORD,
      fullName: "Тест: Без связи",
      role: "manager",
    });

    const list = await request(app)
      .get("/api/admin/access/preview/candidates?q=Без%20связи")
      .set(authHeaders(adminCookie));
    assert.equal(list.status, 200);
    const row = list.body.items.find((item: { id: string }) => item.id === orphan.id);
    assert.ok(row);
    assert.equal(row.canSelect, false);
    assert.match(row.blockReason, /связ/i);

    const start = await startPreview(adminCookie, orphan.id);
    assert.equal(start.status, 400);

    const me = await request(app).get("/api/auth/me").set(authHeaders(adminCookie));
    assert.equal(me.body.preview.active, false);
  });

  it("scopes assistant preview to assigned legal entities only", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();

    assert.equal((await startPreview(adminCookie, users.assistant!.id)).status, 200);
    const noDelegation = await request(app)
      .get("/api/clients/v3/list?entity=legal&pageSize=100")
      .set(authHeaders(adminCookie));
    assert.equal(noDelegation.status, 200);
    assert.equal(noDelegation.body.total, 0);

    await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});

    await createApprovedDelegation([LEGAL]);
    assert.equal((await startPreview(adminCookie, users.assistant!.id)).status, 200);
    const scoped = await request(app)
      .get("/api/clients/v3/list?entity=legal&pageSize=100")
      .set(authHeaders(adminCookie));
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.total, 1);
    assert.equal(scoped.body.items[0].guid, LEGAL);

    const managerDirect = await request(app)
      .get("/api/clients/v3/list?entity=legal&pageSize=100")
      .set(authHeaders(await login(users.manager!.email)));
    assert.ok(managerDirect.body.total > scoped.body.total);

    const markRead = await request(app)
      .post("/api/access/notifications/read-all")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(markRead.status, 403);
  });

  it("director without 1C link uses explicit grant and fails closed when grant revoked", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();
    const director = await createTestUser({
      databaseUrl,
      email: "director-grant-only@example.test",
      password: QA_PASSWORD,
      fullName: "Тест: Директор без 1С",
      role: "director",
    });
    await pool.query(
      "INSERT INTO director_base_access_grants (user_id, granted_by_user_id, basis) VALUES ($1::uuid, $2::uuid, $3)",
      [director.id, users.admin!.id, "Explicit synthetic director scope"],
    );

    assert.equal((await startPreview(adminCookie, director.id)).status, 200);
    const list = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=5")
      .set(authHeaders(adminCookie));
    assert.equal(list.status, 200);
    assert.ok(list.body.total > 0);

    await pool.query(
      "UPDATE director_base_access_grants SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [director.id],
    );

    const blocked = await request(app)
      .get("/api/clients?view=all&entity=clients&page=1&pageSize=5")
      .set(authHeaders(adminCookie));
    assert.equal(blocked.status, 403);

    const me = await request(app).get("/api/auth/me").set(authHeaders(adminCookie));
    assert.equal(me.body.preview.active, true);
    assert.equal(me.body.preview.error?.code, "NO_LINK");
  });

  it("GET notifications in preview does not insert rows or mark read", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();
    await createApprovedDelegation([LEGAL]);

    const before = (
      await pool.query(
        "SELECT COUNT(*)::int AS c FROM assistant_assignment_notifications WHERE user_id = $1::uuid",
        [users.manager!.id],
      )
    ).rows[0]!.c;

    assert.equal((await startPreview(adminCookie, users.manager!.id)).status, 200);

    const notifications = await request(app)
      .get("/api/access/notifications?page=1")
      .set(authHeaders(adminCookie));
    assert.equal(notifications.status, 200);

    const after = (
      await pool.query(
        "SELECT COUNT(*)::int AS c FROM assistant_assignment_notifications WHERE user_id = $1::uuid",
        [users.manager!.id],
      )
    ).rows[0]!.c;
    assert.equal(after, before);

    const postReview = await request(app)
      .post("/api/access/delegations/00000000-0000-4000-8000-000000000001/review")
      .set(authHeaders(adminCookie))
      .send({ score: 5, comment: "blocked" });
    assert.equal(postReview.status, 403);
  });
});
