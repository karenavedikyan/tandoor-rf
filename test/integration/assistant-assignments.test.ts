import assert from "node:assert/strict";
import { before, after, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl } from "../helpers/test-db";
import { seedAssignmentQa, QA_PASSWORD, LEGAL, FOREIGN_LEGAL, EMP } from "../helpers/assistant-assignment-fixtures";
import { createApp } from "../../src/server";

const ORIGIN = "http://127.0.0.1:3000";
describe("assistant assignments: coordinator-only decisions and scoped access", { concurrency: false }, () => {
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>, cookies: Record<string, string>, pool: Pool, app: ReturnType<typeof createApp>;
  before(async () => {
    const url = getIntegrationDatabaseUrl();
    users = await seedAssignmentQa(url);
    await resetPoolForTests();
    pool = new Pool({ connectionString: url }); app = createApp(); cookies = {};
    for (const [key, user] of Object.entries(users)) {
      const r = await request(app).post("/api/auth/login").set({ Origin: ORIGIN }).send({ email: user.email, password: QA_PASSWORD });
      assert.equal(r.status, 200, key + JSON.stringify(r.body));
      cookies[key] = r.headers["set-cookie"]![0]!.split(";")[0]!;
    }
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM delegations");
    await pool.query("DELETE FROM access_denials");
    await pool.query("UPDATE onec_clients SET guid_manager=$2 WHERE guid_client=$1", [LEGAL, EMP.manager]);
    await pool.query(`UPDATE onec_v3_legal_entities SET managers=jsonb_set(managers,'{guidManager}',to_jsonb($2::text)) WHERE guid_client=$1`, [LEGAL, EMP.manager]);
  });
  after(async () => { await pool?.end(); await closePool(); });
  function get(who: string, path: string) { return request(app).get(path).set({ Origin: ORIGIN, Cookie: cookies[who]! }); }
  function post(who: string, path: string, body: unknown) { return request(app).post("/api/access" + path).set({ Origin: ORIGIN, Cookie: cookies[who]! }).send(body); }
  function terms(extra: Record<string, unknown> = {}) {
    return { assistantUserId: users.assistant!.id, startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 86400000 * 3).toISOString(), clientGuids: [LEGAL], basis: "Тестовое временное назначение.", ...extra };
  }
  async function create(extra: Record<string, unknown> = {}, who = "manager") {
    const r = await post(who, "/delegations", terms(extra)); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string;
  }
  async function decide(id: string, action: string, who = "coordinator", extra: Record<string, unknown> = {}) {
    return post(who, "/delegations/" + id + "/" + action, { basis: "Тестовое решение координатора.", ...extra });
  }
  async function total(who = "assistant") {
    const r = await get(who, "/api/clients/v3/list?entity=legal&pageSize=100");
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.total as number;
  }
  it("only coordinator approves; director, ROP, technical admin cannot approve through legacy URLs", async () => {
    const id = await create(); assert.equal(await total(), 0);
    for (const role of ["director", "rop", "admin", "manager", "assistant"]) assert.equal((await decide(id, "approve", role)).status, 403, role);
    const admin = await request(app).post("/api/admin/access/delegations/" + id + "/record-approval")
      .set({ Origin: ORIGIN, Cookie: cookies.admin! }).send({ basis: "Попытка обхода." });
    assert.equal(admin.status, 403);
    assert.equal((await decide(id, "approve")).status, 200);
    assert.equal(await total(), 1);
    assert.equal((await decide(id, "approve")).status, 409);
  });
  it("foreign manager IDs and foreign client IDs cannot grant or reveal data", async () => {
    assert.equal((await post("manager", "/delegations", terms({ delegatorUserId: users.manager2!.id }))).status, 403);
    assert.equal((await post("manager", "/delegations", terms({ clientGuids: [FOREIGN_LEGAL] }))).status, 403);
    assert.equal((await get("manager", "/api/access/delegators/" + users.manager2!.id + "/clients")).status, 404);
    const id = await create();
    assert.equal((await get("manager2", "/api/access/delegations/" + id)).status, 404);
    assert.equal((await get("assistant", "/api/access/delegations/" + id)).status, 404);
    assert.equal((await get("assistant", "/api/work/tasks")).status, 403);
  });
  it("return, edit, resubmit, reject and cancellation retain the audit trail", async () => {
    const id = await create();
    assert.equal((await decide(id, "return")).status, 200);
    const detail = await get("manager", "/api/access/delegations/" + id);
    assert.equal(detail.body.delegation.workflow_state, "returned");
    assert.equal((await post("manager", "/delegations/" + id + "/edit", terms())).status, 200);
    assert.equal((await decide(id, "submit", "manager")).status, 200);
    assert.equal((await decide(id, "reject")).status, 200);
    assert.equal(await total(), 0);
    const history = await get("director", "/api/access/assignments/activity");
    assert.equal(history.status, 200); assert.ok(history.body.items.some((r: any) => r.change_type === "reject"));
    const draft = await create({ submit: false });
    assert.equal((await decide(draft, "cancel", "manager")).status, 200);
    assert.equal((await decide(draft, "submit", "manager")).status, 409);
  });
  it("pending changes pause access, rejection restores it, approval can switch assistant, revoke closes it", async () => {
    const id = await create(); assert.equal((await decide(id, "approve")).status, 200);
    const body = terms({ assistantUserId: users.assistant2!.id });
    assert.equal((await post("manager", "/delegations/" + id + "/change-requests", body)).status, 200);
    assert.equal(await total(), 0); assert.equal(await total("assistant2"), 0);
    assert.equal((await decide(id, "reject-change")).status, 200); assert.equal(await total(), 1);
    assert.equal((await post("manager", "/delegations/" + id + "/change-requests", body)).status, 200);
    assert.equal((await decide(id, "approve-change")).status, 200);
    assert.equal(await total(), 0); assert.equal(await total("assistant2"), 1);
    assert.equal((await decide(id, "revoke")).status, 200); assert.equal(await total("assistant2"), 0);
  });
  it("coordinator works across territories, without coordinator_team_assignments", async () => {
    const id = await create({ delegatorUserId: users.manager2!.id, clientGuids: [FOREIGN_LEGAL] }, "coordinator");
    assert.equal((await decide(id, "approve")).status, 200); assert.equal(await total(), 1);
    assert.equal((await get("coordinator", "/api/access/coordinator-managers")).status, 200);
    assert.equal((await get("director", "/api/access/delegations/" + id)).body.delegation.canReview, false);
    assert.equal((await get("assistant", "/api/clients/v3/legal/" + LEGAL)).status, 404);
  });
  it("overlapping approvals are serialized across different assistants", async () => {
    const id1 = await create(), id2 = await create({ assistantUserId: users.assistant2!.id });
    const results = await Promise.all([decide(id1, "approve"), decide(id2, "approve")]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(await total() + await total("assistant2"), 1);
  });
  it("scheduled, expired, drifted ownership and denied clients never leak through v3", async () => {
    const id = await create({ startsAt: new Date(Date.now() + 60000).toISOString() });
    assert.equal((await decide(id, "approve")).status, 200); assert.equal(await total(), 0);
    await pool.query("UPDATE delegations SET starts_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [id]);
    assert.equal(await total(), 1);
    await pool.query("UPDATE onec_v3_legal_entities SET managers=jsonb_set(managers,'{guidManager}',to_jsonb($2::text)) WHERE guid_client=$1", [LEGAL, EMP.manager2]);
    assert.equal(await total(), 0);
    await pool.query("UPDATE onec_v3_legal_entities SET managers=jsonb_set(managers,'{guidManager}',to_jsonb($2::text)) WHERE guid_client=$1", [LEGAL, EMP.manager]);
    await pool.query(`INSERT INTO access_denials(user_id,scope_type,object_id,reason,basis,created_by_user_id)
      VALUES($1,'client',$2,'Тестовый запрет','Тестовое основание',$3)`, [users.assistant!.id, LEGAL, users.admin!.id]);
    assert.equal(await total(), 0); await pool.query("DELETE FROM access_denials");
    await pool.query("UPDATE delegations SET ends_at=NOW() WHERE id=$1", [id]); assert.equal(await total(), 0);
  });
  it("notifications are personal, read markers cannot affect a different user, director gets coordinator events", async () => {
    const id = await create();
    const c = await get("coordinator", "/api/access/notifications"); assert.equal(c.status, 200);
    assert.ok(c.body.items.some((r: any) => r.kind === "submit"));
    assert.equal((await get("assistant", "/api/access/notifications")).body.total, 0);
    assert.equal((await decide(id, "approve")).status, 200);
    const a = await get("assistant", "/api/access/notifications"); assert.ok(a.body.unread > 0);
    const n = a.body.items[0];
    assert.equal((await post("manager", "/notifications/" + n.id + "/read", {})).status, 404);
    assert.equal((await post("assistant", "/notifications/" + n.id + "/read", {})).status, 200);
    assert.equal((await post("assistant", "/notifications/read-all", {})).status, 200);
    assert.equal((await get("assistant", "/api/access/notifications")).body.unread, 0);
    const dir = await get("director", "/api/access/notifications");
    assert.ok(dir.body.items.some((r: any) => r.kind === "approve"));
    assert.ok(!JSON.stringify(a.body).includes(LEGAL));
  });
  it("picker supports pagination, filtering and sales sorting; missing sales are not zero", async () => {
    const path = "/api/access/delegators/" + users.manager!.id + "/clients";
    const r = await get("manager", path); assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.total > 50); assert.equal(r.body.items.length, 50);
    const sale = await get("manager", path + "?min=0&sort=sales_desc&month=2026-09");
    assert.equal(sale.status, 200, JSON.stringify(sale.body));
    assert.ok(sale.body.items.length > 0); assert.ok(sale.body.items.every((r: any) => r.sales !== null));
    const city = await get("manager", path + "?city=Сочи&category=Опт");
    assert.equal(city.status, 200); assert.ok(city.body.items.every((r: any) => r.city.includes("Сочи") && r.category.includes("Опт")));
    assert.equal((await get("manager", path + "?min=10&max=1")).status, 400);
    assert.equal((await post("manager", "/delegations", terms({ assistantUserId: null }))).status, 400);
  });
  it("stale versions and foreign origins are refused", async () => {
    const id = await create();
    assert.equal((await decide(id, "approve", "coordinator", { rowVersion: 500 })).status, 409);
    const r = await request(app).post("/api/access/delegations/" + id + "/approve")
      .set({ Origin: "https://foreign.invalid", Cookie: cookies.coordinator! }).send({ basis: "Тестовое основание." });
    assert.equal(r.status, 403); assert.equal(await total(), 0);
  });
  it("assigned client grants only scoped TT and first-stage write operations remain forbidden", async () => {
    const id = await create(); assert.equal((await decide(id, "approve")).status, 200);
    const tt = await get("assistant", "/api/clients/v3/list?entity=retail&pageSize=100");
    const mgrTt = await get("manager", "/api/clients/v3/list?entity=retail&pageSize=100");
    assert.equal(tt.status, 200); assert.ok(tt.body.total > 0);
    const managerIds = new Set(mgrTt.body.items.map((r: any) => r.guid));
    assert.ok(tt.body.items.every((r: any) => managerIds.has(r.guid)));
    const write = await request(app).put("/api/clients/" + LEGAL + "/review")
      .set({ Origin: ORIGIN, Cookie: cookies.assistant! }).send({ status: "reviewed" });
    assert.equal(write.status, 403);
    await pool.query("UPDATE onec_v3_legal_entities SET managers=jsonb_set(managers,'{guidManager}',to_jsonb($2::text)) WHERE guid_client=$1", [LEGAL, EMP.manager2]);
    assert.equal((await get("assistant", "/api/clients/v3/list?entity=retail")).body.total, 0);
  });
  it("time notices are idempotent and expiry closes access regardless of notification read status", async () => {
    const id = await create(); assert.equal((await decide(id, "approve")).status, 200);
    await pool.query("UPDATE delegations SET starts_at=NOW()-INTERVAL '2 hours',ends_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [id]);
    const first = await get("assistant", "/api/access/notifications");
    const second = await get("assistant", "/api/access/notifications");
    assert.equal(first.status, 200); assert.equal(first.body.total, second.body.total);
    assert.equal(first.body.items.filter((n: any) => n.kind === "expired").length, 1);
    assert.equal(await total(), 0);
  });
  it("time-notice batches do not starve assignments beyond the first hundred", async () => {
    const id = await create(); assert.equal((await decide(id, "approve")).status, 200);
    await pool.query("UPDATE delegations SET starts_at=NOW()-INTERVAL '2 hours',ends_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [id]);
    // Synthetic batch: cloning does not create client grants or change real records.
    await pool.query(`INSERT INTO delegations SELECT
      (jsonb_populate_record(NULL::delegations,to_jsonb(d)||jsonb_build_object('id',gen_random_uuid()))).*
      FROM delegations d CROSS JOIN generate_series(1,100) WHERE d.id=$1`, [id]);
    for (let i = 0; i < 3; i++) assert.equal((await get("assistant", "/api/access/notifications")).status, 200);
    const notices = await pool.query(`SELECT COUNT(*)::int AS n FROM assistant_assignment_notifications
      WHERE user_id=$1 AND kind='expired'`, [users.assistant!.id]);
    assert.equal(notices.rows[0]!.n, 101);
  });
  it("returned changes preserve the proposal for correction and audit ordering is stable", async () => {
    const id = await create(); assert.equal((await decide(id, "approve")).status, 200);
    const body = terms({ assistantUserId: users.assistant2!.id, basis: "Возвращённые условия для исправления." });
    assert.equal((await post("manager", "/delegations/" + id + "/change-requests", body)).status, 200);
    assert.equal((await decide(id, "return-change")).status, 200);
    const detail = (await get("manager", "/api/access/delegations/" + id)).body.delegation;
    assert.equal(detail.returnedProposal.assistant_user_id, users.assistant2!.id);
    assert.equal(detail.returnedProposal.basis, body.basis);
    assert.ok(detail.history.every((h: any) => !("before_json" in h)));
    assert.deepEqual(detail.history.slice(0, 2).map((h: any) => h.change_type), ["create", "submit"]);
    assert.equal(await total(), 1);
    assert.equal((await post("manager", "/delegations/" + id + "/change-requests", body)).status, 200);
    assert.equal((await get("manager", "/api/access/delegations/" + id)).body.delegation.returnedProposal, undefined);
  });
  it("schema preparation is explicit, admin-only, additive, counted and limited to migration 050", async () => {
    assert.equal((await post("admin", "/assignments/schema", { confirm: false })).status, 400);
    assert.equal((await post("coordinator", "/assignments/schema", { confirm: true })).status, 403);
    await pool.query("DELETE FROM schema_migrations WHERE filename='050_assistant_assignments.sql'");
    const r = await post("admin", "/assignments/schema", { confirm: true });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.applied, true);
    assert.deepEqual(r.body.before, r.body.after);
    assert.equal((await post("admin", "/assignments/schema", { confirm: true })).body.applied, false);
    await pool.query("DELETE FROM schema_migrations WHERE filename IN('049_employee_access_rollouts.sql','050_assistant_assignments.sql')");
    assert.equal((await post("admin", "/assignments/schema", { confirm: true })).status, 409);
    await pool.query("INSERT INTO schema_migrations(filename) VALUES('049_employee_access_rollouts.sql'),('050_assistant_assignments.sql')");
  });
  it("appoints ROA admin-only, idempotently, preserving credentials, account fields and the employee link", async () => {
    const target = users.manager2!.id;
    const body = { userId: target, employeeId: EMP.manager2, confirm: true, basis: "Explicit owner approval: head of assistants" };
    const before = (await pool.query("SELECT to_jsonb(u)-'role'-'updated_at' AS data FROM users u WHERE id=$1", [target])).rows[0]!.data;
    try {
      for (const role of ["manager", "director", "coordinator", "assistant"]) {
        assert.equal((await post(role, "/assignments/coordinator", body)).status, 403);
      }
      assert.equal((await post("admin", "/assignments/coordinator", { ...body, confirm: false })).status, 400);
      assert.equal((await post("admin", "/assignments/coordinator", { ...body, employeeId: EMP.manager })).status, 409);
      const changed = await post("admin", "/assignments/coordinator", body);
      assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.equal(changed.body.changed, true);
      assert.equal((await post("admin", "/assignments/coordinator", body)).body.changed, false);
      assert.deepEqual((await pool.query("SELECT to_jsonb(u)-'role'-'updated_at' AS data FROM users u WHERE id=$1", [target])).rows[0]!.data, before);
      assert.equal((await get("manager2", "/api/access/assignments/activity")).status, 200);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM access_audit_log WHERE action='ASSIGNMENT_COORDINATOR_APPOINTED' AND entity_id=$1", [target])).rows[0]!.n, 1);
      assert.equal((await pool.query("SELECT employee_id::text FROM user_onec_employee_links WHERE user_id=$1 AND revoked_at IS NULL", [target])).rows[0]!.employee_id, EMP.manager2);
    } finally { await pool.query("UPDATE users SET role='manager' WHERE id=$1", [target]); }
  });
});
