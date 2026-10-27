import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { QA_PASSWORD, seedAssignmentQa, LEGAL, EMP } from "../helpers/assistant-assignment-fixtures";
import { getIntegrationDatabaseUrl, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app).post("/api/auth/login").set(authHeaders()).send({ email, password: QA_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("admin preview work mode", { concurrency: false }, () => {
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>;
  let databaseUrl: string;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    users = await seedAssignmentQa(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
  });

  after(async () => {
    await closePool();
  });

  it("readonly preview blocks delegation create; work mode allows manager flow with admin audit", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();
    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: users.manager!.id });
    assert.equal(start.status, 200);
    assert.equal(start.body.preview.readOnly, true);

    const blocked = await request(app)
      .post("/api/access/delegations")
      .set(authHeaders(adminCookie))
      .send({
        assistantUserId: users.assistant!.id,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 3).toISOString(),
        clientGuids: [LEGAL],
        basis: "Тестовое назначение в preview readonly.",
      });
    assert.equal(blocked.status, 403);

    const enable = await request(app)
      .post("/api/admin/access/preview/work/enable")
      .set(authHeaders(adminCookie))
      .send({ confirm: true });
    assert.equal(enable.status, 200);
    assert.equal(enable.body.preview.workMode, true);
    assert.equal(enable.body.preview.readOnly, false);

    const create = await request(app)
      .post("/api/access/delegations")
      .set(authHeaders(adminCookie))
      .send({
        assistantUserId: users.assistant!.id,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 3).toISOString(),
        clientGuids: [LEGAL],
        basis: "Тестовое назначение от администратора за менеджера.",
      });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    const id = create.body.id as string;

    const detail = await request(app)
      .get("/api/access/delegations/" + id)
      .set(authHeaders(adminCookie));
    assert.equal(detail.status, 200);
    const submitEvent = detail.body.delegation.history.find((h: { change_type: string }) => h.change_type === "submit");
    assert.ok(submitEvent);
    assert.equal(submitEvent.actor_role, "admin");
    assert.ok(String(submitEvent.comment).includes("администратором"));

    assert.equal((await request(app).get("/api/admin/access/overview").set(authHeaders(adminCookie))).status, 403);

    await request(app)
      .post("/api/admin/access/preview/stop")
      .set(authHeaders(adminCookie))
      .send({});

    const coordCookie = await login(users.coordinator!.email);
    const approve = await request(app)
      .post("/api/access/delegations/" + id + "/approve")
      .set(authHeaders(coordCookie))
      .send({ basis: "Согласовано для теста work mode." });
    assert.equal(approve.status, 200);

    const assistantList = await request(app)
      .get("/api/clients/v3/list?entity=legal&pageSize=100")
      .set(authHeaders(await login(users.assistant!.email)));
    assert.equal(assistantList.status, 200);
    assert.equal(assistantList.body.total, 1);
  });

  it("non-admin cannot enable work mode", async () => {
    const managerCookie = await login(users.manager!.email);
    const app = await loadApp();
    assert.equal(
      (await request(app)
        .post("/api/admin/access/preview/work/enable")
        .set(authHeaders(managerCookie))
        .send({ confirm: true })).status,
      403,
    );
  });

  it("picker clamps out-of-range page", async () => {
    const managerCookie = await login(users.manager!.email);
    const app = await loadApp();
    const path = "/api/access/delegators/" + users.manager!.id + "/clients?page=99";
    const res = await request(app).get(path).set(authHeaders(managerCookie));
    assert.equal(res.status, 200);
    assert.ok(res.body.totalPages >= 1);
    assert.ok(res.body.page <= res.body.totalPages);
  });
});
