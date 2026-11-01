import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { createTransferInTransaction } from "../../src/tan-tracker/create-transfer-service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { ADMIN_CREATED_EVENT, canDeliverAdminCreated, loadAdminOverview, notifyAdminsOfNewTrack } from "../../src/tan-tracker/admin-overview";
import { canDeliverTanTrackerOutboxNotification } from "../../src/tanbot-telegram/tan-tracker-access";
import { confirmNativeExternalToExternalDraft } from "../../src/tanbot/native-create/confirm-native";
import { confirmExternalRequestDraft } from "../../src/tan-tracker/external-request/confirm";
import { buildTanTrackerBootstrap } from "../../src/tan-tracker/service";
import type { AccessContext } from "../../src/access/types";
import type { UserDto } from "../../src/shared/user";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000", PASSWORD = "StrongPass123!";
function actor(id: string, role = "admin"): UserDto {
  return { id, role: role as UserDto["role"], fullName: "Проверочный автор", email: `${id}@test.local`, phone: "+79995550111", mustChangePassword: false };
}
function access(id: string, role = "admin"): AccessContext {
  return { userId: id, role, status: "active", employeeId: null, employeeLinkConflict: false,
    hasEmployeeLink: false, hasScopedClientAccess: true, fullClientBase: false, explicitlyDeniedAll: false } as AccessContext;
}
describe("admin registry, creation analytics and opt-in alerts", { concurrency: false }, () => {
  let app: ReturnType<typeof import("../../src/server").createApp>;
  let admin = "", second = "", manager = "", adminCookie = "", managerCookie = "";
  const db = () => getPool()!;
  async function cookie(email: string) {
    const result = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email, password: PASSWORD });
    assert.equal(result.status, 200, result.text);
    return result.headers["set-cookie"][0].split(";")[0];
  }
  async function preference(mode: string, owner = adminCookie, extra = {}) {
    return request(app).patch("/api/tan-tracker/admin/track-notifications")
      .set({ Cookie: owner, Origin: ORIGIN }).send({ mode, ...extra });
  }
  async function createStaff(rollback = false) {
    const c = await db().connect();
    try {
      await c.query("BEGIN");
      const code = await createTransferInTransaction(c, { user: actor(manager, "manager"), access: access(manager, "manager") }, {
        item: "Документы для проверки реестра", finalRecipientExternal: { name: "Внешний получатель", phone: "+79995550122" },
      });
      await c.query(rollback ? "ROLLBACK" : "COMMIT");
      return code;
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  async function createExternal(kind: "web" | "native", recipientPhone = "+79995550133") {
    const c = await db().connect();
    try {
      await c.query("BEGIN");
      const pid = randomUUID(), personId = randomUUID(), draftId = randomUUID();
      const phone = "+7999" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
      await c.query(`INSERT INTO tt_parties(id,kind,display_name,phone_e164) VALUES($1,'external','Внешний автор',$2)`, [pid, phone]);
      await c.query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,'Внешний автор',$3)`, [personId, pid, phone]);
      const payload = kind === "web" ? { item: "Внешняя веб-заявка", recipientUserId: manager }
        : { item: "Внешняя передача из бота", draftOrigin: "native_bot", actor: "external",
          externalRecipientPhone: recipientPhone, externalRecipientDisplayName: "Получатель" };
      await c.query(`INSERT INTO tt_external_request_drafts(id,person_id,channel,messenger_chat_id,step,payload)
        VALUES($1,$2,'telegram',$3,'summary',$4)`, [draftId, personId, draftId, JSON.stringify(payload)]);
      const input = { personId, externalPartyId: pid, draftId };
      const first = kind === "web" ? await confirmExternalRequestDraft(c, { ...input, idempotencyKey: draftId })
        : await confirmNativeExternalToExternalDraft(c, { ...input, channel: "telegram", messengerChatKey: draftId });
      const replay = kind === "web" ? await confirmExternalRequestDraft(c, { ...input, idempotencyKey: draftId })
        : await confirmNativeExternalToExternalDraft(c, { ...input, channel: "telegram", messengerChatKey: draftId });
      assert.equal(replay.publicCode, first.publicCode);
      await c.query("COMMIT");
      return first.publicCode;
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  async function counts(code: string) {
    const lk = await db().query(`SELECT user_id::text FROM tt_lk_notifications WHERE transfer_id=$1 AND event_type=$2`, [code, ADMIN_CREATED_EVENT]);
    const outbox = await db().query(`SELECT user_id::text,channel FROM tanbot_notification_outbox WHERE payload->>'transferId'=$1 AND event_type=$2`, [code, ADMIN_CREATED_EVENT]);
    return { users: lk.rows.map(r => r.user_id).sort(), messengers: outbox.rows };
  }
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TT_OTP_PEPPER = "admin-overview-isolated-test-pepper";
    await prepareDatabase(databaseUrl); await resetPoolForTests();
    admin = (await createTestUser({ databaseUrl, email: "overview-admin@test.local", password: PASSWORD, fullName: "Администратор реестра", role: "admin" })).id;
    second = (await createTestUser({ databaseUrl, email: "overview-second@test.local", password: PASSWORD, fullName: "Другой администратор", role: "admin" })).id;
    manager = (await createTestUser({ databaseUrl, email: "overview-manager@test.local", password: PASSWORD, fullName: "Сотрудник", role: "manager", phone: "+79995550111" })).id;
    await db().query(`UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1`, [manager]);
    const c = await db().connect();
    try { await ensurePartyForUserOnWrite(c, manager, "Сотрудник", "+79995550111"); } finally { c.release(); }
    const { createApp } = await import("../../src/server"); app = createApp();
    adminCookie = await cookie("overview-admin@test.local"); managerCookie = await cookie("overview-manager@test.local");
  });
  after(async () => { await closePool(); });
  it("defaults off, no alert for past tracks, admin without party sees all; manager has no overview", async () => {
    const old = await createStaff();
    assert.deepEqual((await counts(old)).users, []);
    const a = await request(app).get("/api/tan-tracker/bootstrap").set("Cookie", adminCookie);
    assert.equal(a.status, 200); assert.equal(a.body.actorPartyId, null);
    assert.equal(a.body.adminOverview.notificationMode, "off");
    assert.ok(a.body.orders.some((o: { id: string }) => o.id === old));
    assert.ok(a.body.orders[0].createdAt > 0);
    const m = await request(app).get("/api/tan-tracker/bootstrap").set("Cookie", managerCookie);
    assert.equal(m.status, 200); assert.equal(m.body.adminOverview, undefined);
    assert.equal((await preference("all", managerCookie)).status, 403);
    assert.equal((await preference("bogus")).status, 400);
    assert.equal((await preference("all", adminCookie, { userId: second })).status, 400);
    assert.equal((await request(app).patch("/api/tan-tracker/admin/track-notifications").set("Cookie", adminCookie).set("Origin", "https://untrusted.invalid").send({ mode: "all" })).status, 403);
    assert.equal((await preference("all")).status, 200);
    assert.deepEqual((await counts(old)).users, [], "enabling must not replay historical tracks");
  });
  it("staff creation is transactional, deduped per admin/channel; other admin preference stays off", async () => {
    const code = await createStaff();
    assert.deepEqual((await counts(code)).users, [admin]);
    assert.equal((await counts(code)).messengers.length, 2);
    const c = await db().connect();
    try { await notifyAdminsOfNewTrack(c, code); } finally { c.release(); }
    assert.equal((await counts(code)).messengers.length, 2);
    const rolled = await createStaff(true);
    assert.deepEqual((await counts(rolled)).users, []);
    assert.equal((await db().query(`SELECT id FROM tt_transfers WHERE id=$1`, [rolled])).rowCount, 0);
  });
  it("staff-only and external-only modes classify creator, not recipient, across both external paths and replay", async () => {
    assert.equal((await preference("external")).status, 200);
    const staffToExternal = await createStaff();
    assert.deepEqual((await counts(staffToExternal)).users, []);
    for (const kind of ["web", "native"] as const) {
      const code = await createExternal(kind);
      assert.deepEqual((await counts(code)).users, [admin]);
      assert.equal((await counts(code)).messengers.length, 2, "confirm replay never emits another creation alert");
    }
    const externalToStaff = await createExternal("native", "+79995550111");
    assert.deepEqual((await counts(externalToStaff)).users, [admin]);
    assert.equal((await preference("staff")).status, 200);
    assert.deepEqual((await counts(await createExternal("web"))).users, []);
    assert.deepEqual((await counts(await createStaff())).users, [admin]);
  });
  it("delivery rechecks opt-out, role and deletion, but does not require participation or current handoff", async () => {
    assert.equal((await preference("all")).status, 200);
    const code = await createStaff(), c = await db().connect();
    try {
      assert.equal(await canDeliverTanTrackerOutboxNotification(c, admin, code, 1, ADMIN_CREATED_EVENT), true);
      await c.query(`UPDATE tt_transfers SET status='completed',handoff_version=9,general_archived_at=NOW() WHERE id=$1`, [code]);
      assert.equal(await canDeliverAdminCreated(c, admin, code), true);
      await c.query(`UPDATE users SET role='manager' WHERE id=$1`, [admin]);
      assert.equal(await canDeliverAdminCreated(c, admin, code), false);
      await c.query(`UPDATE users SET role='admin',status='disabled' WHERE id=$1`, [admin]);
      assert.equal(await canDeliverAdminCreated(c, admin, code), false);
      await c.query(`UPDATE users SET status='active' WHERE id=$1`, [admin]);
      await c.query(`UPDATE tt_transfers SET deleted_at=NOW() WHERE id=$1`, [code]);
      assert.equal(await canDeliverAdminCreated(c, admin, code), false);
    } finally { c.release(); }
    assert.equal((await preference("off")).status, 200);
    const pending = await db().query(`SELECT id FROM tanbot_notification_outbox WHERE user_id=$1 AND event_type=$2 AND status='pending'`, [admin, ADMIN_CREATED_EVENT]);
    assert.equal(pending.rowCount, 0);
    assert.equal((await preference("all")).status, 200);
    const c2 = await db().connect();
    try { assert.equal(await canDeliverAdminCreated(c2, admin, code), false, "reenabling does not resurrect queued old events"); } finally { c2.release(); }
  });
  it("counts creation, not handoffs, preserves historical/deleted statistics and Moscow date boundaries", async () => {
    const code = await createStaff();
    const overview = await loadAdminOverview(db(), admin);
    const totals = (await db().query(`SELECT count(*)::int n FROM tt_transfers`)).rows[0].n;
    assert.equal(overview.summary.total, totals);
    assert.equal(overview.summary.staff + overview.summary.external, totals);
    assert.equal(overview.daily.length, 30);
    assert.equal(overview.daily.reduce((n, d) => n + d.staff + d.external, 0), overview.summary.recent);
    await db().query(`UPDATE tt_transfers SET created_at=
      (date_trunc('day',NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow') - interval '1 second' WHERE id=$1`, [code]);
    const edge = await loadAdminOverview(db(), admin);
    assert.equal(edge.daily.at(-1)!.staff, overview.daily.at(-1)!.staff - 1);
    assert.equal(edge.daily.at(-2)!.staff, overview.daily.at(-2)!.staff + 1);
    await db().query(`UPDATE tt_transfers SET created_at=
      date_trunc('day',NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' WHERE id=$1`, [code]);
    assert.equal((await loadAdminOverview(db(), admin)).daily.at(-1)!.staff, overview.daily.at(-1)!.staff);
    await db().query(`UPDATE tt_transfers SET created_at='2020-01-01T21:30:00Z',handoff_version=10 WHERE id=$1`, [code]);
    const after = await loadAdminOverview(db(), admin);
    assert.equal(after.summary.total, totals);
    assert.equal(after.summary.recent, overview.summary.recent - 1);
    const boot = await buildTanTrackerBootstrap(actor(admin), access(admin));
    assert.ok(boot.adminOverview);
    const preview = access(admin);
    preview.preview = { active: true, readOnly: true, targetUser: actor(manager, "manager") } as NonNullable<AccessContext["preview"]>;
    const scoped = await buildTanTrackerBootstrap(actor(admin), preview);
    assert.equal(scoped.adminOverview, undefined);
  });
});
