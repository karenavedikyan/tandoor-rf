import assert from "node:assert/strict";
import { before, beforeEach, after, describe, it } from "node:test";
import type { Pool } from "pg";
import request from "supertest";
import { closePool } from "../../src/db/pool";
import { verifyPassword } from "../../src/auth/password";
import { buildSessionCookie } from "../../src/auth/cookie";
import { createSessionIfPasswordUnchanged, resolveSessionUser } from "../../src/auth/session";
import { changePasswordAtomically, setTestFaultBeforePasswordChangeAudit } from "../../src/access/password-change-service";
import { requestPasswordRecovery, loginWithRecoveryCode, type RecoveryChannel, type RecoveryDelivery } from "../../src/access/password-reset-service";
import { prepareRecoveryTest, seedRecoveryTest, codeFromMessage,
  RECOVERY_ORIGIN as ORIGIN, RECOVERY_PASSWORD as PASSWORD, RECOVERY_NEW_PASSWORD as NEW_PASSWORD,
  RECOVERY_ADMIN as ADMIN, RECOVERY_EMPLOYEE as EMPLOYEE, type RecoveryMessage } from "../helpers/password-recovery-fixtures";

let pool: Pool, originalHash: string, fixture: Awaited<ReturnType<typeof seedRecoveryTest>>;
let app: ReturnType<typeof import("../../src/server").createApp>, messages: RecoveryMessage[], sendOk = true;
const delivery: RecoveryDelivery = async msg => { messages.push(msg); return sendOk; };
const proof = () => ({ actorId: fixture.adminId, sessionId: fixture.adminSession.sessionId,
  currentPassword: PASSWORD, confirmed: true, basis: "Synthetic employee request" });
const issue = (channel: RecoveryChannel = "max", admin = true) =>
  requestPasswordRecovery(pool, { email: EMPLOYEE, channel, admin: admin ? proof() : undefined }, delivery);
const cookie = (token: string) => buildSessionCookie(token).split(";")[0]!;
const post = (path: string, body: object, token?: string) => {
  const r = request(app).post(path).set({ Origin: ORIGIN, "Content-Type": "application/json" });
  if (token) r.set("Cookie", cookie(token));
  return r.send(body);
};
describe("bot password recovery", { concurrency: false }, () => {
  before(async () => {
    const setup = await prepareRecoveryTest(); pool = setup.pool; originalHash = setup.hash;
    const { createApp } = await import("../../src/server");
    app = createApp({ recoveryDelivery: delivery });
  });
  beforeEach(async () => { fixture = await seedRecoveryTest(pool, originalHash); messages = []; sendOk = true; });
  after(async () => { await closePool(); await pool?.end(); });

  for (const channel of ["max", "telegram"] as const) {
    it(`labels employee and initiating admin; sends ${channel} code to ADMIN's bot, not employee`, async () => {
      assert.equal(await issue(channel), true);
      const msg = messages[0]!;
      assert.equal(msg.userId, channel === "max" ? "33003" : "11001");
      assert.equal(msg.chatId, msg.userId); assert.equal(msg.channel, channel);
      assert.match(msg.text, /Для кого: Тестовый Сотрудник/);
      assert.ok(msg.text.includes("Логин сотрудника: " + EMPLOYEE));
      assert.ok(msg.text.includes(`Запросил администратор: Тестовый Администратор (${ADMIN})`));
      const code = codeFromMessage(msg);
      const records = (await pool.query("SELECT * FROM password_recovery_challenges")).rows;
      assert.equal(records.length, 1); assert.equal(records[0].recipient_user_id, fixture.adminId);
      assert.equal(JSON.stringify(records).includes(code), false);
      assert.equal(JSON.stringify((await pool.query("SELECT * FROM access_audit_log")).rows).includes(code), false);
      assert.equal((await pool.query("SELECT * FROM tanbot_notification_outbox")).rowCount, 0);
      assert.equal((await pool.query("SELECT password_hash FROM users WHERE id=$1", [fixture.employeeId])).rows[0].password_hash, originalHash);
      assert.ok(await resolveSessionUser(fixture.employeeSession.token));
    });
    it(`self-service sends ${channel} code only to account owner's existing bot and does not assert initiator identity`, async () => {
      await requestPasswordRecovery(pool, { email: ADMIN, channel }, delivery);
      assert.equal(messages[0]!.userId, channel === "max" ? "33003" : "11001");
      assert.match(messages[0]!.text, /Для кого: Тестовый Администратор/);
      assert.match(messages[0]!.text, /без авторизации.*не подтверждена/);
      const login = await loginWithRecoveryCode(pool, ADMIN, codeFromMessage(messages[0]!));
      assert.ok(login);
      assert.equal((await resolveSessionUser(login.token))?.user.role, "admin");
    });
  }
  it("redeems once, revokes old sessions and grants only mandatory password change", async () => {
    await issue(); const code = codeFromMessage(messages[0]!);
    const login = await post("/api/auth/recovery-login", { email: EMPLOYEE, code });
    assert.equal(login.status, 200); assert.equal(login.body.user.mustChangePassword, true);
    assert.match(login.headers["cache-control"], /no-store/);
    const newCookie = login.headers["set-cookie"][0].split(";")[0];
    assert.equal(await resolveSessionUser(fixture.employeeSession.token), null);
    assert.ok(await resolveSessionUser(fixture.adminSession.token));
    assert.equal((await request(app).get("/api/clients").set("Cookie", newCookie)).status, 403);
    assert.equal((await request(app).patch("/api/profile/self")
      .set({ Origin: ORIGIN, Cookie: newCookie }).send({ fullName: "Unauthorized profile mutation", phone: "+79990000000" })).status, 403);
    assert.equal(await loginWithRecoveryCode(pool, EMPLOYEE, code), null);
    assert.equal((await post("/api/auth/login", { email: EMPLOYEE, password: code })).status, 401);
    assert.equal((await post("/api/auth/login", { email: EMPLOYEE, password: PASSWORD })).status, 401);
    assert.equal(await createSessionIfPasswordUnchanged(fixture.employeeId, originalHash), null);
    const changed = await request(app).post("/api/profile/change-password")
      .set({ Origin: ORIGIN, Cookie: newCookie }).send({ currentPassword: code, newPassword: NEW_PASSWORD });
    assert.equal(changed.status, 200); assert.notEqual(changed.body.user.mustChangePassword, true);
    assert.equal((await post("/api/auth/login", { email: EMPLOYEE, password: NEW_PASSWORD })).status, 200);
    const stored = (await pool.query("SELECT password_hash,role FROM users WHERE id=$1", [fixture.employeeId])).rows[0];
    assert.equal(await verifyPassword(NEW_PASSWORD, stored.password_hash), true); assert.equal(stored.role, "manager");
    assert.equal((await pool.query("SELECT code_hash FROM password_recovery_challenges")).rows[0].code_hash, null);
    const audit = (await pool.query("SELECT * FROM access_audit_log WHERE action='user.password_recovery_login'")).rows[0];
    assert.equal(audit.actor_user_id, fixture.employeeId);
    assert.equal(audit.after_json.issued_by_admin_user_id, fixture.adminId);
  });
  it("concurrent redemption yields exactly one session and one audit event", async () => {
    await issue(); const code = codeFromMessage(messages[0]!);
    const results = await Promise.all([loginWithRecoveryCode(pool, EMPLOYEE, code), loginWithRecoveryCode(pool, EMPLOYEE, code)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await pool.query("SELECT * FROM access_audit_log WHERE action='user.password_recovery_login'")).rowCount, 1);
  });
  it("five incorrect codes exhaust challenge, and failures persist", async () => {
    await issue(); const code = codeFromMessage(messages[0]!);
    for (let i = 0; i < 5; i++) assert.equal(await loginWithRecoveryCode(pool, EMPLOYEE, "00000000"), null);
    assert.equal((await pool.query("SELECT attempts FROM password_recovery_challenges")).rows[0].attempts, 5);
    assert.equal(await loginWithRecoveryCode(pool, EMPLOYEE, code), null);
    assert.ok(await resolveSessionUser(fixture.employeeSession.token));
  });
  it("expiry and changed password invalidate the code without altering account data", async () => {
    await issue(); const code = codeFromMessage(messages[0]!);
    await pool.query("UPDATE password_recovery_challenges SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal(await loginWithRecoveryCode(pool, EMPLOYEE, code), null);
    await pool.query("UPDATE password_recovery_challenges SET expires_at=NOW()+INTERVAL '1 minute'");
    await pool.query("UPDATE users SET password_hash='changed' WHERE id=$1", [fixture.employeeId]);
    assert.equal(await loginWithRecoveryCode(pool, EMPLOYEE, code), null);
  });
  it("a new request cancels the old code and cannot bypass the cooldown", async () => {
    await issue(); const old = codeFromMessage(messages[0]!);
    await assert.rejects(issue(), /через минуту/);
    await pool.query("UPDATE password_recovery_challenges SET created_at=NOW()-INTERVAL '61 seconds'");
    await issue("telegram");
    assert.equal(await loginWithRecoveryCode(pool, EMPLOYEE, old), null);
    assert.ok(await loginWithRecoveryCode(pool, EMPLOYEE, codeFromMessage(messages[1]!)));
  });
  it("stopped/rebound bot, disabled recipient, revoked initiator and changed role invalidate issued code", async () => {
    for (const mutation of [
      "UPDATE tanbot_max_accounts SET stopped_at=NOW() WHERE user_id=$1",
      "UPDATE tanbot_max_accounts SET max_user_id=99009 WHERE user_id=$1",
      "UPDATE tanbot_max_accounts SET linked_at=NOW()+INTERVAL '1 second' WHERE user_id=$1",
      "UPDATE users SET status='disabled' WHERE id=$1",
      "UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1",
      "UPDATE users SET role='manager' WHERE id=$1",
    ]) {
      fixture = await seedRecoveryTest(pool, originalHash); messages = [];
      await issue(); await pool.query(mutation, [fixture.adminId]);
      assert.equal(await loginWithRecoveryCode(pool, EMPLOYEE, codeFromMessage(messages[0]!)), null);
    }
  });
  it("admin proof is mandatory and target admin accounts cannot be reset by another admin", async () => {
    for (const extra of [{ currentPassword: "bad" }, { confirmed: false }, { basis: "" },
      { actorId: fixture.employeeId, sessionId: fixture.employeeSession.sessionId }]) {
      await assert.rejects(requestPasswordRecovery(pool, { email: EMPLOYEE, channel: "max", admin: { ...proof(), ...extra } }, delivery));
    }
    await assert.rejects(requestPasswordRecovery(pool, { email: ADMIN, channel: "max", admin: proof() }, delivery));
    assert.equal(messages.length, 0);
  });
  it("missing/opted-out/stopped bot fails closed; public responses never reveal account state", async () => {
    await pool.query("UPDATE tanbot_max_accounts SET notifications_enabled=FALSE");
    await assert.rejects(issue(), /Подключите выбранный бот/);
    const replies = [];
    for (const email of [ADMIN, EMPLOYEE, "missing@example.test"]) {
      const r = await post("/api/auth/recover-password", { email, channel: "max", chatId: "attacker" });
      assert.equal(r.status, 202); replies.push(r.body); assert.match(r.headers["cache-control"], /no-store/);
    }
    assert.deepEqual(replies[0], replies[1]); assert.deepEqual(replies[1], replies[2]); assert.equal(messages.length, 0);
  });
  it("delivery failure rolls back challenge and audit; existing credentials stay valid", async () => {
    sendOk = false;
    await assert.rejects(issue(), /Не удалось отправить/);
    assert.equal((await pool.query("SELECT * FROM password_recovery_challenges")).rowCount, 0);
    assert.equal((await pool.query("SELECT * FROM access_audit_log")).rowCount, 0);
    assert.ok(await resolveSessionUser(fixture.employeeSession.token));
    const r = await post("/api/auth/recover-password", { email: EMPLOYEE, channel: "max" });
    assert.equal(r.status, 202);
  });
  it("audit failure rolls back redemption, does not consume code and does not revoke sessions", async () => {
    await issue(); const code = codeFromMessage(messages[0]!);
    await pool.query(`CREATE FUNCTION fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
      CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON access_audit_log
      FOR EACH ROW EXECUTE FUNCTION fail_recovery_audit()`);
    try {
      await assert.rejects(loginWithRecoveryCode(pool, EMPLOYEE, code));
      assert.ok(await resolveSessionUser(fixture.employeeSession.token));
      assert.equal((await pool.query("SELECT used_at FROM password_recovery_challenges")).rows[0].used_at, null);
    } finally { await pool.query("DROP TRIGGER fail_recovery_audit ON access_audit_log; DROP FUNCTION fail_recovery_audit()"); }
    assert.ok(await loginWithRecoveryCode(pool, EMPLOYEE, code));
  });
  it("password change rollback retains the restricted session and can be retried with the same code", async () => {
    await issue(); const code = codeFromMessage(messages[0]!);
    const login = await loginWithRecoveryCode(pool, EMPLOYEE, code); assert.ok(login);
    const session = await resolveSessionUser(login.token); assert.ok(session);
    setTestFaultBeforePasswordChangeAudit(true);
    try { await assert.rejects(changePasswordAtomically(pool, { userId: fixture.employeeId, sessionId: session.sessionId, currentPassword: code, newPassword: NEW_PASSWORD })); }
    finally { setTestFaultBeforePasswordChangeAudit(false); }
    assert.equal((await resolveSessionUser(login.token))?.user.mustChangePassword, true);
    const changed = await changePasswordAtomically(pool, { userId: fixture.employeeId, sessionId: session.sessionId, currentPassword: code, newPassword: NEW_PASSWORD });
    assert.equal(changed.ok, true);
  });
  it("HTTP admin action requires auth/admin/CSRF, denies preview, ignores arbitrary recipient IDs", async () => {
    const path = "/api/admin/access/users/reset-password";
    const body = { email: EMPLOYEE, channel: "telegram", currentPassword: PASSWORD, basis: "Synthetic request", confirmed: true,
      recipientUserId: fixture.employeeId, chatId: "99999", actorId: fixture.employeeId };
    assert.equal((await post(path, body)).status, 401);
    assert.equal((await post(path, body, fixture.employeeSession.token)).status, 403);
    assert.equal((await request(app).post(path).set("Cookie", cookie(fixture.adminSession.token)).send(body)).status, 403);
    await pool.query("UPDATE sessions SET preview_user_id=$2 WHERE id=$1", [fixture.adminSession.sessionId, fixture.employeeId]);
    assert.equal((await post(path, body, fixture.adminSession.token)).status, 403);
    await pool.query("UPDATE sessions SET preview_user_id=NULL WHERE id=$1", [fixture.adminSession.sessionId]);
    const r = await post(path, body, fixture.adminSession.token);
    assert.equal(r.status, 202); assert.equal(messages[0]!.userId, "11001");
    assert.equal(JSON.stringify(r.body).includes(codeFromMessage(messages[0]!)), false);
  });
  it("rate limits recovery independently of normal password login", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await post("/api/auth/recovery-login", { email: ADMIN, code: "00000000" })).status, 401);
    const r = await post("/api/auth/recovery-login", { email: ADMIN, code: "00000000" });
    assert.equal(r.status, 429); assert.ok(r.headers["retry-after"]);
    assert.equal((await post("/api/auth/login", { email: ADMIN, password: PASSWORD })).status, 200);
  });
});
