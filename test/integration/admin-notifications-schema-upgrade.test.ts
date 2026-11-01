import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { after, before, describe, it } from "node:test";
import { checkReadiness } from "../../src/db/readiness";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensureAdminNotificationsSchema } from "../../src/tan-tracker/admin-notifications-schema";
import { loadAdminOverview } from "../../src/tan-tracker/admin-overview";
import { createTransferInTransaction } from "../../src/tan-tracker/create-transfer-service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import type { AccessContext } from "../../src/access/types";
import type { UserDto } from "../../src/shared/user";

const databaseUrl = getIntegrationDatabaseUrl();
const PASSWORD = "OnlyLocal-Upgrade-2026!";
const ORIGIN = "http://127.0.0.1:34881";

describe("production upgrade from the deployed pre-078 schema", { concurrency: false }, () => {
  let admin = "", manager = "", beforeTrack: unknown, child: ChildProcess | undefined;
  const db = () => getPool()!;
  function start(): { process: ChildProcess; output: () => string } {
    // Deliberately no inherited integration credentials or enabled worker flags.
    const process = spawn(global.process.execPath, ["dist/server.js"], {
      cwd: global.process.cwd(),
      env: {
        PATH: global.process.env.PATH, HOME: global.process.env.HOME,
        NODE_ENV: "test", DATABASE_URL: databaseUrl, PGSSLMODE: "disable",
        PORT: "34881", APP_ORIGIN: ORIGIN, TT_PHONE_VERIFICATION_PROVIDER: "test",
        TT_OTP_PEPPER: "local-schema-upgrade-test-only",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    process.stdout!.on("data", chunk => { output += String(chunk); });
    process.stderr!.on("data", chunk => { output += String(chunk); });
    child = process;
    return { process, output: () => output };
  }
  async function stop(): Promise<void> {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    child = undefined;
  }
  before(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    admin = (await createTestUser({
      databaseUrl, email: "upgrade-admin@test.local", password: PASSWORD,
      fullName: "Тестовый администратор", role: "admin",
    })).id;
    manager = (await createTestUser({
      databaseUrl, email: "upgrade-manager@test.local", password: PASSWORD,
      fullName: "Тестовый сотрудник", role: "manager", phone: "+79995550111",
    })).id;
    const client = await db().connect();
    try {
      const party = await ensurePartyForUserOnWrite(client, manager, "Тестовый сотрудник", "+79995550111");
      await client.query(`INSERT INTO tt_transfers(
        id,public_code,item_title,status,creator_party_id,holder_party_id)
        VALUES ('TT-UPGRADE-0001','TT-UPGRADE-0001','Существующий тестовый трек','active',$1,$1)`, [party.id]);
    } finally { client.release(); }
    beforeTrack = (await db().query("SELECT * FROM tt_transfers ORDER BY id")).rows;
    // Disposable guarded TEST_DATABASE_URL only. Simulate the old deployed schema;
    // retain the receipt to verify recovery also handles a stale migration marker.
    await db().query("DROP TABLE tt_admin_track_notification_preferences");
    await db().query("DELETE FROM schema_migrations WHERE filename='077_internal_catalog.sql'");
  });
  after(async () => { await stop(); await closePool(); });

  it("detects a missing required schema instead of claiming readiness or an empty register", async () => {
    assert.deepEqual(await checkReadiness(), { ready: false, reason: "schema_missing" });
    await assert.rejects(loadAdminOverview(db(), admin), { code: "42P01" });
  });

  it("the exact Docker entry point prepares schema before serving authenticated registry and creation", async () => {
    const run = start();
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt++) {
      assert.equal(run.process.exitCode, null, run.output());
      try {
        const response = await fetch(`${ORIGIN}/api/ready`);
        if (response.status === 200) { ready = true; break; }
      } catch { /* socket is not open before schema initialization completes */ }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(ready, true, run.output());
    assert.match(run.output(), /schema ready; applied=true/);
    assert.ok(run.output().indexOf("schema ready") < run.output().indexOf("Server listening"));
    assert.deepEqual((await db().query("SELECT * FROM tt_transfers ORDER BY id")).rows, beforeTrack);
    const login = await fetch(`${ORIGIN}/api/auth/login`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "upgrade-admin@test.local", password: PASSWORD }),
    });
    assert.equal(login.status, 200, await login.text());
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(`${ORIGIN}/api/tan-tracker/bootstrap`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const bootstrap = await response.json() as {
      adminOverview: { notificationMode: string; summary: { total: number } };
      orders: { id: string }[];
    };
    assert.equal(bootstrap.adminOverview.notificationMode, "off");
    assert.equal(bootstrap.adminOverview.summary.total, 1);
    assert.ok(bootstrap.orders.some(row => row.id === "TT-UPGRADE-0001"));
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      const user: UserDto = { id: manager, role: "manager", fullName: "Тестовый сотрудник",
        email: "upgrade-manager@test.local", phone: "+79995550111", mustChangePassword: false };
      const access = { userId: manager, role: "manager", status: "active", employeeId: null,
        hasEmployeeLink: false, hasScopedClientAccess: true, fullClientBase: false,
        explicitlyDeniedAll: false, employeeLinkConflict: false } as AccessContext;
      await createTransferInTransaction(client, { user, access }, {
        item: "Новый тестовый трек после обновления",
        finalRecipientExternal: { name: "Тестовый получатель", phone: "+79995550122" },
      });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    assert.equal((await db().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n, 2);
    assert.equal((await db().query(
      "SELECT COUNT(*)::int AS n FROM tt_lk_notifications WHERE event_type='tan_tracker.admin_created'",
    )).rows[0].n, 0);
    await stop();
  });

  it("parallel and repeated initialization preserves preferences and never runs unrelated migrations", async () => {
    assert.equal((await db().query(
      "SELECT COUNT(*)::int AS n FROM tt_admin_track_notification_preferences",
    )).rows[0].n, 0);
    await db().query("DROP TABLE tt_admin_track_notification_preferences");
    const concurrent = await Promise.all([
      ensureAdminNotificationsSchema(db()), ensureAdminNotificationsSchema(db()),
    ]);
    assert.equal(concurrent.filter(result => result.applied).length, 1);
    await db().query(`INSERT INTO tt_admin_track_notification_preferences(user_id,mode)
      VALUES ($1,'external')`, [admin]);
    const before = (await db().query("SELECT * FROM tt_admin_track_notification_preferences")).rows;
    const results = await Promise.all([
      ensureAdminNotificationsSchema(db()), ensureAdminNotificationsSchema(db()),
    ]);
    assert.deepEqual(results, [{ applied: false }, { applied: false }]);
    assert.deepEqual((await db().query("SELECT * FROM tt_admin_track_notification_preferences")).rows, before);
    assert.equal((await db().query(
      "SELECT COUNT(*)::int AS n FROM schema_migrations WHERE filename='077_internal_catalog.sql'",
    )).rows[0].n, 0);
  });

  it("schema contract failure prevents HTTP startup instead of advertising a healthy broken release", async () => {
    await db().query("ALTER TABLE tt_admin_track_notification_preferences RENAME COLUMN mode TO broken_mode");
    try {
      const run = start();
      const [code] = await once(run.process, "exit");
      assert.equal(code, 1);
      assert.match(run.output(), /schema initialization failed; code=42703/);
      assert.doesNotMatch(run.output(), /Server listening/);
    } finally {
      child = undefined;
      await db().query("ALTER TABLE tt_admin_track_notification_preferences RENAME COLUMN broken_mode TO mode");
    }
  });
});
