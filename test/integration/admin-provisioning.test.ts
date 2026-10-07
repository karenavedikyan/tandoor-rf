import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ACCESS_AUDIT_ACTIONS } from "../../src/access/constants";
import {
  grantAdminAccess,
  inspectUserByEmail,
} from "../../src/access/user-provisioning";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const TARGET_EMAIL = "a.zaychenko@tandoors.ru";
const TARGET_NAME = "Артём Зайченко";

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

describe("admin provisioning", { concurrency: false }, () => {
  let databaseUrl = "";
  let pool!: Pool;
  let actorAdminId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    const actor = await createTestUser({
      databaseUrl,
      email: "provisioning-actor@example.com",
      password: TEST_PASSWORD,
      fullName: "Provisioning Actor",
      role: "admin",
    });
    actorAdminId = actor.id;
  });

  after(async () => {
    await pool.end();
    await closePool();
  });

  it("inspect reports missing user without employee links", async () => {
    const client = await pool.connect();
    try {
      const inspect = await inspectUserByEmail(client, TARGET_EMAIL);
      assert.equal(inspect.exists, false);
      assert.equal(inspect.employeeLinks.length, 0);
    } finally {
      client.release();
    }
  });

  it("refuses grant without audit confirmation", async () => {
    const client = await pool.connect();
    try {
      const result = await grantAdminAccess(client, {
        email: TARGET_EMAIL,
        fullName: TARGET_NAME,
        actorUserId: actorAdminId,
        basis: "Тестовое основание для выдачи admin",
        auditReviewConfirmed: false,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "AUDIT_NOT_CONFIRMED");
      }
    } finally {
      client.release();
    }
  });

  it("creates admin with audit and refuses duplicate without password reset", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: TARGET_EMAIL,
        fullName: TARGET_NAME,
        actorUserId: actorAdminId,
        basis: "Согласование выдачи admin программисту 1С (staging test)",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!XY",
      });
      assert.equal(created.ok, true);
      if (created.ok) {
        assert.equal(created.mode, "created");
      }
      await client.query("COMMIT");

      const duplicate = await grantAdminAccess(client, {
        email: TARGET_EMAIL,
        fullName: TARGET_NAME,
        actorUserId: actorAdminId,
        basis: "Повторная попытка",
        auditReviewConfirmed: true,
      });
      assert.equal(duplicate.ok, false);
      if (!duplicate.ok) {
        assert.equal(duplicate.code, "USER_ALREADY_ADMIN");
      }

      const audit = await pool.query<{ action: string }>(
        `
          SELECT action
          FROM access_audit_log
          WHERE entity_id = (
            SELECT id FROM users WHERE email = $1 LIMIT 1
          )
          ORDER BY created_at
        `,
        [TARGET_EMAIL],
      );
      assert.deepEqual(
        audit.rows.map((row) => row.action),
        [
          ACCESS_AUDIT_ACTIONS.USER_CREATE,
          ACCESS_AUDIT_ACTIONS.USER_PASSWORD_SET,
        ],
      );

      const linkCount = await pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM user_onec_employee_links
          WHERE user_id = (SELECT id FROM users WHERE email = $1 LIMIT 1)
        `,
        [TARGET_EMAIL],
      );
      assert.equal(linkCount.rows[0]?.count, "0");
    } finally {
      client.release();
    }
  });

  it("assigns admin role to existing user without changing password", async () => {
    await createTestUser({
      databaseUrl,
      email: "existing-manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Existing Manager",
      role: "manager",
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await grantAdminAccess(client, {
        email: "existing-manager@example.com",
        fullName: "Existing Manager",
        actorUserId: actorAdminId,
        basis: "Повышение до admin без сброса пароля (staging test)",
        auditReviewConfirmed: true,
        assignAdminRoleOnly: true,
      });
      assert.equal(result.ok, true);
      await client.query("COMMIT");

      const app = await loadApp();
      const login = await request(app)
        .post("/api/auth/login")
        .set({ Origin: ORIGIN, "Content-Type": "application/json" })
        .send({ email: "existing-manager@example.com", password: TEST_PASSWORD });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.role, "admin");
    } finally {
      client.release();
    }
  });

  it("requires password change before admin API and allows self-service change", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "temp-password-user@example.com",
        fullName: "Temp Password User",
        actorUserId: actorAdminId,
        basis: "Проверка обязательной смены временного пароля",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!AB",
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const app = await loadApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "temp-password-user@example.com", password: "TempPass123!AB" });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.mustChangePassword, true);
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const blocked = await request(app)
      .get("/api/admin/access/overview")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, "PASSWORD_CHANGE_REQUIRED");

    const changed = await request(app)
      .post("/api/profile/change-password")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        currentPassword: "TempPass123!AB",
        newPassword: "NewStrongPass123!",
      });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.user.mustChangePassword, false);

    const overview = await request(app)
      .get("/api/admin/access/overview")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(overview.status, 200);
  });
});
