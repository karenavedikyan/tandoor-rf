import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { loadAccessContext } from "../../src/access/context";
import { buildClientScopeSql } from "../../src/access/scope-sql";
import { v3EntityAssignmentScope } from "../../src/clients/v3/access-scope";
import { parseRollout } from "../../src/access/employee-rollout";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv, createTestUser } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000", PASSWORD = "SyntheticOnlyPassword123!";
const PREFIX = "/api/admin/access/users/rollouts";
let db: Pool, app: ReturnType<typeof import("../../src/server").createApp>;
let cookie = "", adminId = "", oldUserId = "", oldCookie = "";
const employeeId = randomUUID();
function post(path: string, body: unknown, auth = cookie) {
  return request(app).post(path).set("Origin", ORIGIN).set("Cookie", auth).send(body);
}
function plan(entries: unknown[]) {
  return { id: randomUUID(), basis: "Synthetic test: explicitly approved access rollout", entries, confirmResetExisting: true };
}
function director(email = randomUUID() + "@example.test") {
  return { email, fullName: "Synthetic director", role: "director" };
}
async function stage(p: ReturnType<typeof plan>) {
  const r = await post(PREFIX, p); assert.equal(r.status, 200); return r.body;
}
describe("employee access rollout: authorized, atomic, receipt-gated", () => {
  before(async () => {
    const url = getIntegrationDatabaseUrl(); setIntegrationEnv(url); await prepareDatabase(url);
    await resetPoolForTests(); db = new Pool({ connectionString: url, max: 1 });
    adminId = (await createTestUser({ databaseUrl: url, email: "rollout-admin@example.test", fullName: "Admin", role: "admin", password: PASSWORD })).id;
    oldUserId = (await createTestUser({ databaseUrl: url, email: "old-local@example.test", fullName: "Existing manager", role: "manager", password: PASSWORD })).id;
    await db.query(`INSERT INTO onec_wholesale_employee_roster
      (guid_manager,name_manager,raw_json) VALUES ($1,'Existing manager','{}')`, [employeeId]);
    await db.query(`INSERT INTO user_onec_employee_links
      (user_id,employee_id,basis,confirmed_by_user_id) VALUES ($1,$2,'Synthetic existing link',$3)`,
    [oldUserId, employeeId, adminId]);
    const { createApp } = await import("../../src/server"); app = createApp();
    const login = async (email: string) => {
      const r = await post("/api/auth/login", { email, password: PASSWORD }, "");
      assert.equal(r.status, 200); return r.headers["set-cookie"][0].split(";")[0] as string;
    };
    cookie = await login("rollout-admin@example.test"); oldCookie = await login("old-local@example.test");
  });
  after(async () => { await db?.end(); await closePool(); });

  it("rejects anonymous, non-admin, foreign origin, admin role and missing reset confirmation", async () => {
    const p = plan([director()]);
    assert.equal((await post(PREFIX, p, "")).status, 401);
    assert.equal((await post(PREFIX, p, oldCookie)).status, 403);
    assert.equal((await request(app).post(PREFIX).set("Cookie", cookie).set("Origin", "https://foreign.test").send(p)).status, 403);
    assert.equal((await post(PREFIX, { ...p, entries: [{ ...director(), role: "admin" }] })).status, 400);
    assert.equal((await post(PREFIX, { ...p, confirmResetExisting: false })).status, 400);
  });
  it("rejects duplicate identities, unknown employee and modifying an admin", async () => {
    const d = director();
    assert.throws(() => parseRollout(plan([d, d])), /Повтор/);
    assert.equal((await post(PREFIX, plan([{ email: "missing@example.test", fullName: "Missing", role: "manager", employeeId: randomUUID() }]))).status, 409);
    assert.equal((await post(PREFIX, plan([{ ...director("rollout-admin@example.test"), userId: adminId }]))).status, 403);
  });
  it("staging changes no account, stores no plaintext, and a wrong receipt cannot activate", async () => {
    const d = director(), p = plan([d]), r = await stage(p);
    assert.equal((await db.query("SELECT 1 FROM users WHERE email=$1", [d.email])).rowCount, 0);
    const stored = (await db.query("SELECT entries_json,receipt_hash FROM employee_access_rollouts WHERE id=$1", [p.id])).rows[0];
    const password = r.markdown.split("|").at(-2)!.trim();
    assert.ok(!JSON.stringify(stored).includes(password));
    assert.ok(!JSON.stringify(stored).includes(r.receipt));
    assert.equal((await post(PREFIX + "/" + p.id + "/activate", { receipt: "incorrect" })).status, 403);
    assert.equal((await post(PREFIX, p)).status, 409);
    const a = await post(PREFIX + "/" + p.id + "/activate", { receipt: r.receipt });
    assert.equal(a.status, 200);
    const u = (await db.query("SELECT id,role,password_must_change FROM users WHERE email=$1", [d.email])).rows[0];
    assert.equal(u.role, "director"); assert.equal(u.password_must_change, true);
    const context = await loadAccessContext(u.id);
    assert.equal(context.hasEmployeeLink, false); assert.equal(context.fullClientBase, true);
    assert.equal(v3EntityAssignmentScope(context, "le").clause.includes("TRUE"), true);
    assert.notEqual(buildClientScopeSql(context).whereSql, "WHERE FALSE");
    const login = await post("/api/auth/login", { email: d.email, password }, "");
    assert.equal(login.status, 200);
    const issuedCookie = login.headers["set-cookie"][0].split(";")[0];
    const denied = await request(app).get("/api/clients/v3/list").set("Cookie", issuedCookie);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, "PASSWORD_CHANGE_REQUIRED");
    assert.equal((await post(PREFIX + "/" + p.id + "/activate", { receipt: r.receipt })).status, 200);
    assert.equal((await db.query("SELECT password_must_change FROM users WHERE id=$1", [u.id])).rows[0].password_must_change, true);
  });
  it("a director with no source link and no explicit grant remains denied; denials override the explicit grant", async () => {
    const id = (await createTestUser({ databaseUrl: getIntegrationDatabaseUrl(), email: "no-grant@example.test", fullName: "No grant", role: "director", password: PASSWORD })).id;
    assert.equal((await loadAccessContext(id)).fullClientBase, false);
    await db.query("INSERT INTO director_base_access_grants(user_id,granted_by_user_id,basis) VALUES($1,$2,'Explicit synthetic director scope')", [id, adminId]);
    assert.equal((await loadAccessContext(id)).fullClientBase, true);
    await db.query("INSERT INTO access_denials(user_id,scope_type,reason,basis,created_by_user_id) VALUES($1,'all_clients','Synthetic denial','Synthetic denial test',$2)", [id, adminId]);
    assert.equal((await loadAccessContext(id)).fullClientBase, false);
    await db.query("UPDATE director_base_access_grants SET revoked_at=NOW() WHERE user_id=$1", [id]);
    assert.equal((await loadAccessContext(id)).fullClientBase, false);
  });
  it("cancel and expiry never create or change accounts", async () => {
    const d = director(), p = plan([d]), r = await stage(p);
    assert.equal((await post(PREFIX + "/" + p.id + "/cancel", {})).status, 200);
    assert.equal((await post(PREFIX + "/" + p.id + "/activate", { receipt: r.receipt })).status, 409);
    assert.equal((await db.query("SELECT 1 FROM users WHERE email=$1", [d.email])).rowCount, 0);
    const p2 = plan([director()]), r2 = await stage(p2);
    await db.query("UPDATE employee_access_rollouts SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [p2.id]);
    assert.equal((await post(PREFIX + "/" + p2.id + "/activate", { receipt: r2.receipt })).status, 409);
  });
  it("a concurrent profile change aborts the whole batch without creating the other user", async () => {
    const d = director(), p = plan([{ email: "renamed@example.test", fullName: "Existing manager", role: "manager", employeeId, userId: oldUserId }, d]);
    const r = await stage(p);
    await db.query("UPDATE users SET updated_at=NOW() WHERE id=$1", [oldUserId]);
    assert.equal((await post(PREFIX + "/" + p.id + "/activate", { receipt: r.receipt })).status, 409);
    assert.equal((await db.query("SELECT email FROM users WHERE id=$1", [oldUserId])).rows[0].email, "old-local@example.test");
    assert.equal((await db.query("SELECT 1 FROM users WHERE email=$1", [d.email])).rowCount, 0);
  });
  it("reissue preserves the existing ID/link and revokes old sessions without touching other admins", async () => {
    const p = plan([{ email: "renamed@example.test", fullName: "Existing manager", role: "manager", employeeId, userId: oldUserId }]);
    const r = await stage(p);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status, 200);
    assert.equal((await post(PREFIX + "/" + p.id + "/activate", { receipt: r.receipt })).status, 200);
    const u = (await db.query("SELECT id,email,password_must_change FROM users WHERE id=$1", [oldUserId])).rows[0];
    assert.equal(u.email, "renamed@example.test"); assert.equal(u.password_must_change, true);
    assert.equal((await db.query("SELECT employee_id::text FROM user_onec_employee_links WHERE user_id=$1 AND revoked_at IS NULL", [oldUserId])).rows[0].employee_id, employeeId);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status, 401);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie)).status, 200);
    const audit = await db.query("SELECT after_json FROM access_audit_log WHERE entity_id=$1", [oldUserId]);
    assert.ok(!JSON.stringify(audit.rows).includes(r.receipt));
    assert.ok(!JSON.stringify(audit.rows).includes("passwordHash"));
  });
  it("applies 43 synthetic users in the approved role distribution and assistants remain empty", async () => {
    const roles = [...Array(25).fill("manager"), ...Array(2).fill("assistant"),
      ...Array(4).fill("regional_manager"), ...Array(7).fill("rop"), ...Array(5).fill("director")];
    const entries = [];
    for (let i = 0; i < roles.length; i++) {
      const e = { email: `batch43-${i}@example.test`, fullName: `Synthetic employee ${i}`, role: roles[i], employeeId: i < 40 ? randomUUID() : null };
      if (e.employeeId) await db.query("INSERT INTO onec_wholesale_employee_roster(guid_manager,name_manager,raw_json) VALUES($1,$2,'{}')", [e.employeeId, e.fullName]);
      entries.push(e);
    }
    const teamId = randomUUID();
    await db.query(`INSERT INTO onec_wholesale_team_groups
      (guid_team,name_team,guid_team_leader,name_team_leader) VALUES($1,'Synthetic team',$2,'Synthetic ROP')`,
    [teamId, entries[31]!.employeeId]);
    await db.query(`INSERT INTO onec_wholesale_employee_team_memberships(guid_team,guid_manager)
      VALUES($1,$2),($1,$3)`, [teamId, entries[0]!.employeeId, entries[25]!.employeeId]);
    const p = plan(entries), r = await stage(p);
    assert.equal(r.count, 43); assert.equal(r.existing, 0);
    assert.equal((await post(PREFIX + "/" + p.id + "/activate", { receipt: r.receipt })).status, 200);
    const result = await db.query("SELECT id,role FROM users WHERE email LIKE 'batch43-%'");
    assert.equal(result.rowCount, 43);
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM rop_team_members r
      JOIN users u ON u.id=r.member_user_id WHERE u.email LIKE 'batch43-%' AND r.revoked_at IS NULL`)).rows[0].n, 1);
    for (const a of result.rows.filter(u => u.role === "assistant")) {
      const context = await loadAccessContext(a.id);
      assert.equal(context.fullClientBase, false);
      const sql = v3EntityAssignmentScope(context, "le");
      assert.match(sql.clause, /delegations/); assert.match(sql.clause, /ends_at > NOW/);
      assert.equal((await db.query("SELECT 1 FROM delegations WHERE assistant_user_id=$1", [a.id])).rowCount, 0);
    }
    const hashes = (await db.query("SELECT entries_json::text AS data,receipt_hash FROM employee_access_rollouts WHERE id=$1", [p.id])).rows[0];
    assert.equal(hashes.receipt_hash, null); assert.ok(!hashes.data.includes("passwordHash"));
    const status = await request(app).get(PREFIX + "/" + p.id).set("Cookie", cookie);
    assert.equal(status.body.verification.account_count, 43);
    assert.equal(status.body.verification.must_change_password_count, 43);
    assert.equal(status.body.verification.explicit_director_grants, 3);
    const assistantId = (await db.query("SELECT id FROM users WHERE email='batch43-25@example.test'")).rows[0].id;
    const delegator = (await db.query("SELECT id FROM users WHERE email='batch43-0@example.test'")).rows[0].id;
    const approver = (await db.query("SELECT id FROM users WHERE email='batch43-40@example.test'")).rows[0].id;
    // This synthetic fixture has completed the mandatory password change.
    await db.query("UPDATE users SET password_must_change=FALSE WHERE id=$1", [assistantId]);
    const pwd = r.markdown.split("\n").find((line: string) => line.includes("batch43-25@example.test"))!.split("|").at(-2)!.trim();
    const login = await post("/api/auth/login", { email: "batch43-25@example.test", password: pwd }, "");
    assert.equal(login.status, 200);
    const assistantCookie = login.headers["set-cookie"][0].split(";")[0];
    const visible = async () => {
      const response = await request(app).get("/api/clients/v3/list?entity=legal&view=all").set("Cookie", assistantCookie);
      assert.equal(response.status, 200); return JSON.stringify(response.body).includes("Period controlled client");
    };
    await db.query("UPDATE onec_v3_exchange_state SET last_bundle_fingerprint=$1 WHERE id=1", ["d".repeat(64)]);
    const clientGuid = randomUUID(), delegationId = randomUUID();
    await db.query(`INSERT INTO onec_v3_legal_entities
      (guid_client,name_client,type_category,managers,other_fields,last_source_sha256)
      VALUES($1,'Period controlled client','{}',$2::jsonb,'{}','synthetic')`,
    [clientGuid, JSON.stringify({ guidManager: entries[0]!.employeeId })]);
    assert.equal(await visible(), false);
    await db.query(`INSERT INTO delegations
      (id,delegator_user_id,assistant_user_id,status,starts_at,ends_at,approved_by_user_id,approved_at)
      VALUES($1,$2,$3,'active',
        NOW()+INTERVAL '10 minutes',NOW()+INTERVAL '20 minutes',$4,NOW())`,
    [delegationId, delegator, assistantId, approver]);
    await db.query("INSERT INTO delegation_clients(delegation_id,guid_client) VALUES($1,$2)", [delegationId, clientGuid]);
    assert.equal(await visible(), false);
    await db.query("UPDATE delegations SET starts_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [delegationId]);
    assert.equal(await visible(), true);
    await db.query("UPDATE delegations SET ends_at=NOW()-INTERVAL '1 second' WHERE id=$1", [delegationId]);
    assert.equal(await visible(), false);
    await db.query("UPDATE delegations SET ends_at=NOW()+INTERVAL '20 minutes',status='revoked',revoked_at=NOW() WHERE id=$1", [delegationId]);
    assert.equal(await visible(), false);
  });
  it("explicit schema preparation applies only migration 049 and leaves account counts unchanged", async () => {
    // Synthetic local test database only: simulate production before additive 049.
    const before = (await db.query("SELECT COUNT(*)::int AS n FROM users")).rows[0].n;
    await db.query("DROP TABLE employee_access_rollouts, director_base_access_grants");
    await db.query("DELETE FROM schema_migrations WHERE filename='049_employee_access_rollouts.sql'");
    assert.equal((await post(PREFIX + "/schema", { confirm: false })).status, 400);
    const old = (await db.query("SELECT filename FROM schema_migrations WHERE filename LIKE '038%'")).rows[0].filename;
    await db.query("DELETE FROM schema_migrations WHERE filename=$1", [old]);
    assert.equal((await post(PREFIX + "/schema", { confirm: true })).status, 409);
    await db.query("INSERT INTO schema_migrations(filename) VALUES($1)", [old]);
    const ready = await post(PREFIX + "/schema", { confirm: true });
    assert.equal(ready.status, 200); assert.equal(ready.body.applied, true);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM users")).rows[0].n, before);
    assert.equal((await post(PREFIX + "/schema", { confirm: true })).body.applied, false);
  });
});
