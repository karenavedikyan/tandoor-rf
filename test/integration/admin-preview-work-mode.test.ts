import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ACCESS_AUDIT_ACTIONS } from "../../src/access/constants";
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

async function startPreview(app: Awaited<ReturnType<typeof loadApp>>, adminCookie: string, userId: string) {
  return request(app)
    .post("/api/admin/access/preview/start")
    .set(authHeaders(adminCookie))
    .send({ userId });
}

async function enableWorkMode(app: Awaited<ReturnType<typeof loadApp>>, adminCookie: string) {
  return request(app)
    .post("/api/admin/access/preview/work/enable")
    .set(authHeaders(adminCookie))
    .send({ confirm: true });
}

async function countNotificationAudit(
  pool: Pool,
  adminUserId: string,
  effectiveUserId: string,
): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM access_audit_log
     WHERE action = ANY($1::text[])
       AND actor_user_id = $2
       AND business_actor_user_id = $3`,
    [
      [
        ACCESS_AUDIT_ACTIONS.ASSIGNMENT_NOTIFICATION_READ,
        ACCESS_AUDIT_ACTIONS.ASSIGNMENT_NOTIFICATION_READ_ALL,
      ],
      adminUserId,
      effectiveUserId,
    ],
  );
  return r.rows[0]!.n as number;
}

describe("admin preview work mode", { concurrency: false }, () => {
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>;
  let databaseUrl: string;
  let pool: Pool;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    users = await seedAssignmentQa(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
  });

  after(async () => {
    await pool.end();
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

  it("blocks admin-only assignment service POSTs during preview (coordinator appoint P0)", async () => {
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();
    assert.equal((await startPreview(app, adminCookie, users.manager!.id)).status, 200);

    const coordBody = {
      userId: users.manager2!.id,
      employeeId: EMP.manager2,
      confirm: true,
      basis: "Must not run in preview",
    };
    for (const path of ["/api/access/assignments/coordinator", "/api/access/assignments/schema"]) {
      const blocked = await request(app).post(path).set(authHeaders(adminCookie)).send(coordBody);
      assert.equal(blocked.status, 403, path + " " + JSON.stringify(blocked.body));
    }

    assert.equal((await enableWorkMode(app, adminCookie)).status, 200);
    const blockedWork = await request(app)
      .post("/api/access/assignments/coordinator")
      .set(authHeaders(adminCookie))
      .send(coordBody);
    assert.equal(blockedWork.status, 403, JSON.stringify(blockedWork.body));

    await request(app).post("/api/admin/access/preview/stop").set(authHeaders(adminCookie)).send({});
    const plainAdmin = await request(app)
      .post("/api/access/assignments/coordinator")
      .set(authHeaders(adminCookie))
      .send(coordBody);
    assert.equal(plainAdmin.status, 200, JSON.stringify(plainAdmin.body));
    assert.equal(plainAdmin.body.changed, true);
    await pool.query("UPDATE users SET role='manager' WHERE id=$1", [users.manager2!.id]);
  });

  it("admin-as-assistant GET /api/work/tasks is forbidden like real assistant (P0)", async () => {
    const app = await loadApp();
    const assistantCookie = await login(users.assistant!.email);
    assert.equal((await request(app).get("/api/work/tasks").set(authHeaders(assistantCookie))).status, 403);

    const adminCookie = await login(users.admin!.email);
    assert.equal((await startPreview(app, adminCookie, users.assistant!.id)).status, 200);
    const previewTasks = await request(app).get("/api/work/tasks").set(authHeaders(adminCookie));
    assert.equal(previewTasks.status, 403, JSON.stringify(previewTasks.body));
  });

  it("admin-as-assistant cannot POST bitrix label — policy blocks before handler (P0)", async () => {
    const app = await loadApp();
    const assistantCookie = await login(users.assistant!.email);
    const realAssistant = await request(app)
      .post(`/api/clients/${LEGAL}/bitrix24/label`)
      .set(authHeaders(assistantCookie))
      .send({});
    assert.equal(realAssistant.status, 403, JSON.stringify(realAssistant.body));

    const adminCookie = await login(users.admin!.email);
    assert.equal((await startPreview(app, adminCookie, users.assistant!.id)).status, 200);
    const previewReadonly = await request(app)
      .post(`/api/clients/${LEGAL}/bitrix24/label`)
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(previewReadonly.status, 403, JSON.stringify(previewReadonly.body));
    assert.notEqual(previewReadonly.body?.error?.message, "Client not found");

    assert.equal((await enableWorkMode(app, adminCookie)).status, 200);
    const previewWork = await request(app)
      .post(`/api/clients/${LEGAL}/bitrix24/label`)
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(previewWork.status, 403, JSON.stringify(previewWork.body));
  });

  it("admin-as-manager cannot approve; coordinator can; proxy review records performedByAdmin (P0)", async () => {
    const managerCookie = await login(users.manager!.email);
    const coordCookie = await login(users.coordinator!.email);
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();

    const create = await request(app)
      .post("/api/access/delegations")
      .set(authHeaders(managerCookie))
      .send({
        assistantUserId: users.assistant!.id,
        startsAt: new Date(Date.now() - 3600000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        clientGuids: [LEGAL],
        basis: "P0 preview approve boundary.",
        submit: true,
      });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    const id = create.body.id as string;

    assert.equal((await startPreview(app, adminCookie, users.manager!.id)).status, 200);
    assert.equal((await enableWorkMode(app, adminCookie)).status, 200);
    const managerApprove = await request(app)
      .post("/api/access/delegations/" + id + "/approve")
      .set(authHeaders(adminCookie))
      .send({ basis: "Must not approve as manager proxy." });
    assert.equal(managerApprove.status, 403, JSON.stringify(managerApprove.body));

    const coordApprove = await request(app)
      .post("/api/access/delegations/" + id + "/approve")
      .set(authHeaders(coordCookie))
      .send({ basis: "Coordinator approval for P0 review test." });
    assert.equal(coordApprove.status, 200, JSON.stringify(coordApprove.body));

    await pool.query(
      `UPDATE delegations SET starts_at=NOW()-INTERVAL '3 hours',approved_at=NOW()-INTERVAL '2 hours',
       ends_at=NOW()-INTERVAL '1 hour' WHERE id=$1`,
      [id],
    );

    const feedback = { score: 4, comment: "Работа выполнена качественно, клиенты возвращены вовремя." };
    const reviewPost = await request(app)
      .post("/api/access/delegations/" + id + "/review")
      .set(authHeaders(adminCookie))
      .send(feedback);
    assert.equal(reviewPost.status, 201, JSON.stringify(reviewPost.body));

    const reviewGet = await request(app)
      .get("/api/access/delegations/" + id + "/review")
      .set(authHeaders(adminCookie));
    assert.equal(reviewGet.status, 200);
    assert.ok(reviewGet.body.review.snapshot.performedByAdmin);
    assert.equal(reviewGet.body.review.snapshot.performedByAdmin.adminUserId, users.admin!.id);
    assert.equal(reviewGet.body.review.snapshot.performedByAdmin.effectiveEmployeeUserId, users.manager!.id);
    assert.ok(reviewGet.body.review.snapshot.performedByAdmin.adminName);
    assert.ok(reviewGet.body.review.snapshot.managerName);
    assert.ok(reviewGet.body.review.snapshot.assistantName);
  });

  it("notification read-all in work mode writes assignment notification audit (P0)", async () => {
    const managerCookie = await login(users.manager!.email);
    const adminCookie = await login(users.admin!.email);
    const app = await loadApp();

    const create = await request(app)
      .post("/api/access/delegations")
      .set(authHeaders(managerCookie))
      .send({
        assistantUserId: users.assistant!.id,
        startsAt: new Date(Date.now() - 3600000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        clientGuids: [LEGAL],
        basis: "Notification audit seed.",
        submit: true,
      });
    assert.equal(create.status, 201);
    const id = create.body.id as string;
    assert.equal(
      (
        await request(app)
          .post("/api/access/delegations/" + id + "/approve")
          .set(authHeaders(await login(users.coordinator!.email)))
          .send({ basis: "ok" })
      ).status,
      200,
    );
    await pool.query(
      `UPDATE delegations SET starts_at=NOW()-INTERVAL '3 hours',approved_at=NOW()-INTERVAL '2 hours',
       ends_at=NOW()-INTERVAL '1 hour' WHERE id=$1`,
      [id],
    );

    const before = await countNotificationAudit(pool, users.admin!.id, users.manager!.id);
    assert.equal(before, 0);

    assert.equal((await startPreview(app, adminCookie, users.manager!.id)).status, 200);
    assert.equal((await enableWorkMode(app, adminCookie)).status, 200);

    const readAll = await request(app)
      .post("/api/access/notifications/read-all")
      .set(authHeaders(adminCookie))
      .send({});
    assert.equal(readAll.status, 200, JSON.stringify(readAll.body));

    const after = await countNotificationAudit(pool, users.admin!.id, users.manager!.id);
    assert.equal(after, 1);
    const row = await pool.query(
      `SELECT action FROM access_audit_log
       WHERE actor_user_id=$1 AND business_actor_user_id=$2
       ORDER BY created_at DESC LIMIT 1`,
      [users.admin!.id, users.manager!.id],
    );
    assert.equal(row.rows[0]!.action, ACCESS_AUDIT_ACTIONS.ASSIGNMENT_NOTIFICATION_READ_ALL);
  });
});
