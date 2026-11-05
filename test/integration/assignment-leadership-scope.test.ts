import assert from "node:assert/strict";
import { before, after, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { createApp } from "../../src/server";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { getIntegrationDatabaseUrl } from "../helpers/test-db";
import { seedAssignmentQa, QA_PASSWORD, LEGAL, FOREIGN_LEGAL, EMP } from "../helpers/assistant-assignment-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const ROP_EMPLOYEE = "77777777-7777-4777-8777-777777777777";
const TEAM = "88888888-8888-4888-8888-888888888888";
describe("assignment leadership: director global, ROP current team", { concurrency: false }, () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>;
  const cookies: Record<string, string> = {};
  before(async () => {
    const url = getIntegrationDatabaseUrl();
    users = await seedAssignmentQa(url);
    await linkUserToEmployee({
      databaseUrl: url, userId: users.rop!.id, employeeId: ROP_EMPLOYEE,
      confirmedByUserId: users.admin!.id,
    });
    await resetPoolForTests();
    pool = new Pool({ connectionString: url });
    app = createApp();
    for (const [key, user] of Object.entries(users)) {
      const login = await request(app).post("/api/auth/login").set({ Origin: ORIGIN })
        .send({ email: user.email, password: QA_PASSWORD });
      assert.equal(login.status, 200, key);
      cookies[key] = login.headers["set-cookie"]![0]!.split(";")[0]!;
    }
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM delegations");
    await pool.query("DELETE FROM access_denials");
    await pool.query("DELETE FROM rop_team_members WHERE rop_user_id=$1", [users.rop!.id]);
    await pool.query("DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_team=$1", [TEAM]);
    await pool.query("DELETE FROM onec_wholesale_team_groups WHERE guid_team=$1", [TEAM]);
    await pool.query(
      `INSERT INTO rop_team_members(rop_user_id,member_user_id,basis,created_by_user_id)
       VALUES($1,$2,'Leadership QA',$3)`, [users.rop!.id, users.manager!.id, users.admin!.id],
    );
    await pool.query("UPDATE user_onec_employee_links SET revoked_at=NULL WHERE user_id=$1", [users.rop!.id]);
  });
  after(async () => { await pool?.end(); await closePool(); });
  const get = (who: string, path: string) =>
    request(app).get("/api/access" + path).set({ Origin: ORIGIN, Cookie: cookies[who]! });
  const post = (who: string, path: string, body: unknown, origin = ORIGIN) =>
    request(app).post("/api/access" + path).set({ Origin: origin, Cookie: cookies[who]! }).send(body);
  const terms = (manager = "manager", extra: Record<string, unknown> = {}) => ({
    delegatorUserId: users[manager]!.id, assistantUserId: users.assistant!.id,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 86400000 * 3).toISOString(),
    clientGuids: [manager === "manager" ? LEGAL : FOREIGN_LEGAL],
    basis: "Leadership assignment QA", ...extra,
  });
  async function create(who = "manager", manager = "manager", extra: Record<string, unknown> = {}) {
    const r = await post(who, "/delegations", terms(manager, extra));
    assert.equal(r.status, 201, r.text);
    return r.body.id as string;
  }
  const decide = (who: string, id: string, action: string, extra: Record<string, unknown> = {}) =>
    post(who, `/delegations/${id}/${action === "propose_change" ? "change-requests" : action.replace(/_/g, "-")}`,
      { basis: "Leadership decision QA", ...extra });
  async function assistantCount() {
    const r = await request(app).get("/api/clients/v3/list?entity=legal&pageSize=100")
      .set({ Origin: ORIGIN, Cookie: cookies.assistant! });
    assert.equal(r.status, 200, r.text);
    return r.body.total;
  }

  it("director creates, edits, submits, approves, changes and revokes across teams with real audit identity", async () => {
    const id = await create("director", "manager2", { submit: false });
    assert.equal((await decide("director", id, "edit", terms("manager2"))).status, 200);
    assert.equal((await decide("director", id, "submit")).status, 200);
    assert.equal(await assistantCount(), 0);
    assert.equal((await decide("director", id, "approve")).status, 200);
    assert.equal(await assistantCount(), 1);
    assert.equal((await decide("director", id, "propose_change", terms("manager2"))).status, 200);
    assert.equal(await assistantCount(), 0);
    assert.equal((await decide("director", id, "approve_change")).status, 200);
    assert.equal(await assistantCount(), 1);
    assert.equal((await decide("director", id, "revoke")).status, 200);
    assert.equal(await assistantCount(), 0);
    const detail = (await get("director", "/delegations/" + id)).body.delegation;
    assert.equal(detail.created_by_user_id, users.director!.id);
    assert.equal(detail.delegator_user_id, users.manager2!.id);
    assert.ok(detail.history.every((h: any) => h.actor_role === "director"));
    assert.ok((await get("director", "/assignments/activity")).body.items.some((h: any) => h.delegation_id === id));
  });

  it("ROP picks only current team managers, sees own clients and cannot forge foreign requests", async () => {
    const managers = await get("rop", "/coordinator-managers");
    assert.equal(managers.status, 200, managers.text);
    assert.ok(managers.body.managers.some((m: any) => m.id === users.manager!.id));
    assert.ok(!managers.body.managers.some((m: any) => m.id === users.manager2!.id));
    assert.equal((await get("rop", `/delegators/${users.manager!.id}/clients?page=1`)).status, 200);
    assert.equal((await get("rop", `/delegators/${users.manager2!.id}/clients?page=1`)).status, 403);
    assert.equal((await post("rop", "/delegations", terms("manager2"))).status, 403);
    assert.equal((await post("rop", "/delegations", terms("manager", { clientGuids: [FOREIGN_LEGAL] }))).status, 403);
    assert.equal((await get("rop", "/assignments/assistants")).status, 200);
    assert.equal((await get("director", "/assignments/assistants")).status, 200);
  });

  it("ROP has full operational lifecycle for own team, including self-authored requests", async () => {
    const id = await create("rop", "manager", { submit: false });
    assert.equal((await decide("rop", id, "edit", terms())).status, 200);
    assert.equal((await decide("rop", id, "submit")).status, 200);
    const detail = await get("rop", "/delegations/" + id);
    assert.equal(detail.body.delegation.canAuthor, true);
    assert.equal(detail.body.delegation.canReview, true);
    assert.equal((await decide("rop", id, "return")).status, 200);
    assert.equal((await decide("rop", id, "submit")).status, 200);
    assert.equal((await decide("rop", id, "approve")).status, 200);
    assert.equal(await assistantCount(), 1);
    assert.equal((await decide("rop", id, "propose_change", terms())).status, 200);
    assert.equal(await assistantCount(), 0);
    assert.equal((await decide("rop", id, "reject_change")).status, 200);
    assert.equal(await assistantCount(), 1);
    assert.equal((await decide("rop", id, "revoke")).status, 200);
    assert.equal(await assistantCount(), 0);
  });

  it("ROP cannot read, edit, cancel or decide any foreign-team assignment by direct URL", async () => {
    const id = await create("director", "manager2");
    assert.equal((await get("rop", "/delegations/" + id)).status, 404);
    assert.equal((await get("rop", "/assignments")).body.total, 0);
    for (const action of ["edit", "submit", "approve", "reject", "return", "cancel", "propose_change",
      "approve_change", "reject_change", "return_change", "cancel_change", "revoke"]) {
      assert.equal((await decide("rop", id, action, terms("manager2"))).status, 403, action);
    }
    const history = await get("rop", "/assignments/activity?q=Leadership");
    assert.equal(history.status, 200);
    assert.equal(history.body.total, 0);
    const audit = await pool.query("SELECT 1 FROM delegation_change_history WHERE delegation_id=$1 AND changed_by_user_id=$2", [id, users.rop!.id]);
    assert.equal(audit.rowCount, 0);
  });

  it("revoking team membership closes reads, actions, client picker, history and old notifications", async () => {
    const id = await create();
    const before = await get("rop", "/notifications");
    assert.ok(before.body.items.some((n: any) => n.delegation_id === id));
    await pool.query("UPDATE rop_team_members SET revoked_at=NOW() WHERE rop_user_id=$1", [users.rop!.id]);
    assert.equal((await get("rop", "/delegations/" + id)).status, 404);
    assert.equal((await get("rop", "/assignments")).body.total, 0);
    assert.equal((await decide("rop", id, "approve")).status, 403);
    assert.equal((await get("rop", `/delegators/${users.manager!.id}/clients`)).status, 403);
    assert.equal((await get("rop", "/assignments/activity")).body.total, 0);
    assert.ok(!(await get("rop", "/notifications")).body.items.some((n: any) => n.delegation_id === id));
    assert.equal((await decide("director", id, "approve")).status, 200);
  });

  it("uses authoritative 1C team membership even without manual ROP links and rechecks its removal", async () => {
    await pool.query("DELETE FROM rop_team_members WHERE rop_user_id=$1", [users.rop!.id]);
    await pool.query(
      "INSERT INTO onec_wholesale_team_groups(guid_team,name_team,guid_team_leader) VALUES($1,'QA Team',$2)",
      [TEAM, ROP_EMPLOYEE],
    );
    await pool.query(
      "INSERT INTO onec_wholesale_employee_team_memberships(guid_manager,guid_team) VALUES($1,$2)",
      [EMP.manager, TEAM],
    );
    const id = await create("rop");
    assert.equal((await decide("rop", id, "approve")).status, 200);
    assert.equal((await get("rop", "/assignments")).body.total, 1);
    await pool.query("DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_team=$1", [TEAM]);
    assert.equal((await decide("rop", id, "revoke")).status, 403);
    assert.equal((await get("rop", "/assignments")).body.total, 0);
  });

  it("current employee-link loss closes ROP access even when a legacy team link remains", async () => {
    const id = await create();
    await pool.query("UPDATE user_onec_employee_links SET revoked_at=NOW() WHERE user_id=$1", [users.rop!.id]);
    assert.equal((await decide("rop", id, "approve")).status, 403);
    assert.equal((await get("rop", "/coordinator-managers")).body.managers.length, 0);
    assert.equal((await get("rop", "/assignments")).body.total, 0);
    assert.equal((await get("rop", "/delegations/" + id)).status, 404);
  });

  it("explicit client denials constrain new leadership pickers and writes", async () => {
    for (const who of ["director", "rop"]) {
      await pool.query(
        `INSERT INTO access_denials(user_id,scope_type,object_id,reason,basis,created_by_user_id)
         VALUES($1,'client',$2,'QA denial','Leadership QA',$3)`,
        [users[who]!.id, LEGAL, users.admin!.id],
      );
      const picker = await get(who, `/delegators/${users.manager!.id}/clients`);
      assert.equal(picker.status, 200);
      assert.ok(!picker.body.items.some((g: any) => g.guids.includes(LEGAL)));
      assert.equal((await post(who, "/delegations", terms())).status, 403);
    }
  });

  it("manager/assistant boundaries, required review authorship and CSRF remain unchanged", async () => {
    assert.equal((await post("manager", "/delegations", terms("manager2"))).status, 403);
    assert.equal((await post("assistant", "/delegations", terms())).status, 403);
    assert.equal((await post("director", "/delegations", terms(), "https://untrusted.example")).status, 403);
    const id = await create();
    for (const who of ["director", "rop"]) {
      assert.equal((await post(who, `/delegations/${id}/review`, { score: 5, comment: "Leadership cannot rate for manager" })).status, 403);
    }
    assert.equal((await get("rop", "/assignments/reviews")).status, 403);
    assert.equal((await decide("manager", id, "approve")).status, 403);
  });

  it("business director does not gain technical admin access or role-management privileges", async () => {
    for (const who of ["director", "rop"]) {
      assert.equal((await post(who, "/assignments/schema", { confirm: true })).status, 403);
      assert.equal((await post(who, "/assignments/coordinator", {
        confirm: true, userId: users.manager!.id, employeeId: EMP.manager, basis: "Not authorized",
      })).status, 403);
      assert.equal((await post(who, "/assignments/reviews/schema", { confirm: true })).status, 403);
    }
  });

  it("admin preview of leadership remains read-only", async () => {
    const r = await request(app).post("/api/admin/access/preview/start")
      .set({ Origin: ORIGIN, Cookie: cookies.admin! }).send({ userId: users.director!.id });
    assert.equal(r.status, 200, r.text);
    const preview = r.headers["set-cookie"]?.map((c: string) => c.split(";")[0]).join("; ") ?? cookies.admin!;
    const write = await request(app).post("/api/access/delegations")
      .set({ Origin: ORIGIN, Cookie: preview }).send(terms());
    assert.equal(write.status, 403, write.text);
    await request(app).post("/api/admin/access/preview/stop")
      .set({ Origin: ORIGIN, Cookie: preview }).send({});
  });
});
