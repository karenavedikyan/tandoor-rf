import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ACCESS_AUDIT_ACTIONS } from "../../src/access/constants";
import { runAdminGrant } from "../../src/access/grant-orchestration";
import {
  changePasswordAtomically,
  setTestFaultBeforePasswordChangeAudit,
} from "../../src/access/password-change-service";
import { queryEmployeeAuditReport } from "../../src/access/employee-audit";
import {
  deliverTemporaryPasswordToChannel,
  verifyPasswordDeliveryChannel,
} from "../../src/access/password-delivery";
import {
  confirmAdminProvisionDelivery,
  findPendingProvisionOperation,
  getProvisionStateForUser,
  grantAdminAccess,
  inspectUserByEmail,
  lookupUserByEmail,
  markAdminProvisionIncomplete,
  setTestFaultBeforeProvisionIncompleteAudit,
  setTestFaultOnOperationVerify,
  setTestSimulateCommitAckLost,
  setTestSimulateCommitFailure,
} from "../../src/access/user-provisioning";
import { buildSessionCookie } from "../../src/auth/cookie";
import { createSession } from "../../src/auth/session";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
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
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, password: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function confirmProvision(
  pool: Pool,
  userId: string,
  actorUserId: string,
  basis: string,
  operationId?: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    const pending =
      operationId ?? (await findPendingProvisionOperation(client, userId))?.operationId;
    assert.ok(pending, "expected pending provision operationId");
    await client.query("BEGIN");
    await confirmAdminProvisionDelivery(client, {
      userId,
      actorUserId,
      basis,
      operationId: pending,
    });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

async function seedPendingDelivery(
  pool: Pool,
  input: {
    email: string;
    fullName: string;
    actorUserId: string;
    basis: string;
    temporaryPassword: string;
  },
): Promise<{ userId: string; operationId: string }> {
  const operationId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await grantAdminAccess(client, {
      email: input.email,
      fullName: input.fullName,
      actorUserId: input.actorUserId,
        operationId: randomUUID(),
      basis: input.basis,
      operationId,
      auditReviewConfirmed: true,
      temporaryPassword: input.temporaryPassword,
    });
    assert.equal(created.ok, true);
    await client.query("COMMIT");
    if (!created.ok || created.mode !== "created") {
      throw new Error("expected created grant");
    }
    return { userId: created.userId, operationId: created.operationId };
  } finally {
    client.release();
  }
}

describe("admin provisioning", { concurrency: false }, () => {
  let databaseUrl = "";
  let pool!: Pool;
  let actorAdminId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    if (pool) {
      await pool.end();
    }
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
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
      assert.equal(inspect.provisionState, "none");
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
        operationId: randomUUID(),
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

  it("creates admin with audit and refuses duplicate after delivery confirmed", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: TARGET_EMAIL,
        fullName: TARGET_NAME,
        actorUserId: actorAdminId,
        operationId: randomUUID(),
        basis: "Согласование выдачи admin программисту 1С (staging test)",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!XY",
      });
      assert.equal(created.ok, true);
      if (created.ok) {
        assert.equal(created.mode, "created");
      }
      await client.query("COMMIT");
      if (!created.ok || created.mode !== "created") {
        return;
      }

      const row = await lookupUserByEmail(client, TARGET_EMAIL);
      assert.equal(row?.status, "disabled");
      await confirmProvision(pool, created.userId, actorAdminId, "Согласование выдачи admin");

      const duplicate = await grantAdminAccess(client, {
        email: TARGET_EMAIL,
        fullName: TARGET_NAME,
        actorUserId: actorAdminId,
        operationId: randomUUID(),
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
      assert.ok(
        audit.rows.some((row) => row.action === ACCESS_AUDIT_ACTIONS.USER_CREATE),
      );
      assert.ok(
        audit.rows.some((row) => row.action === ACCESS_AUDIT_ACTIONS.USER_PASSWORD_SET),
      );
      assert.ok(
        audit.rows.some(
          (row) => row.action === ACCESS_AUDIT_ACTIONS.USER_PROVISION_DELIVERY_CONFIRMED,
        ),
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
        operationId: randomUUID(),
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
    let userId = "";
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "temp-password-user@example.com",
        fullName: "Temp Password User",
        actorUserId: actorAdminId,
        operationId: randomUUID(),
        basis: "Проверка обязательной смены временного пароля",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!AB",
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
      if (!created.ok || created.mode !== "created") {
        return;
      }
      userId = created.userId;
      await confirmProvision(pool, userId, actorAdminId, "Проверка обязательной смены");
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
    assert.equal(changed.body.user.mustChangePassword, undefined);

    const overview = await request(app)
      .get("/api/admin/access/overview")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(overview.status, 200);
  });

  it("rejects new password identical to current password", async () => {
    const app = await loadApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "provisioning-actor@example.com", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const changed = await request(app)
      .post("/api/profile/change-password")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    assert.equal(changed.status, 400);
    assert.equal(changed.body.error.code, "SAME_PASSWORD");
  });

  it("revokes parallel sessions atomically on password change", async () => {
    const client = await pool.connect();
    let userId = "";
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "parallel-session-user@example.com",
        fullName: "Parallel Session User",
        actorUserId: actorAdminId,
        operationId: randomUUID(),
        basis: "Проверка отзыва параллельных сессий",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!CD",
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
      if (!created.ok || created.mode !== "created") {
        return;
      }
      userId = created.userId;
      await confirmProvision(pool, userId, actorAdminId, "Проверка отзыва параллельных сессий");
    } finally {
      client.release();
    }

    const sessionA = await createSession(userId);
    const sessionB = await createSession(userId);
    const app = await loadApp();
    const change = await changePasswordAtomically(pool, {
      userId,
      sessionId: sessionA.sessionId,
      currentPassword: "TempPass123!CD",
      newPassword: "NewStrongPass123!",
    });
    assert.equal(change.ok, true);

    const stale = await request(app)
      .get("/api/auth/me")
      .set({ Origin: ORIGIN, Cookie: buildSessionCookie(sessionB.token).split(";")[0] });
    assert.equal(stale.status, 401);

    const current = await request(app)
      .get("/api/auth/me")
      .set({ Origin: ORIGIN, Cookie: buildSessionCookie(sessionA.token).split(";")[0] });
    assert.equal(current.status, 200);
    assert.equal(current.body.user.mustChangePassword, undefined);
  });

  it("rolls back password change when audit write fails", async () => {
    const client = await pool.connect();
    let userId = "";
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "audit-fault-user@example.com",
        fullName: "Audit Fault User",
        actorUserId: actorAdminId,
        operationId: randomUUID(),
        basis: "Проверка отката при ошибке аудита",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!EF",
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
      if (!created.ok || created.mode !== "created") {
        return;
      }
      userId = created.userId;
      await confirmProvision(pool, userId, actorAdminId, "Проверка отката при ошибке аудита");
    } finally {
      client.release();
    }

    const session = await createSession(userId);
    setTestFaultBeforePasswordChangeAudit(true);
    await assert.rejects(() =>
      changePasswordAtomically(pool, {
        userId,
        sessionId: session.sessionId,
        currentPassword: "TempPass123!EF",
        newPassword: "NewStrongPass123!",
      }),
    );
    setTestFaultBeforePasswordChangeAudit(false);

    const auditClient = await pool.connect();
    try {
      const row = await lookupUserByEmail(auditClient, "audit-fault-user@example.com");
      assert.equal(row?.password_must_change, true);
    } finally {
      auditClient.release();
    }
  });

  it("marks incomplete provision instead of deleting user on delivery failure", async () => {
    const tempDir = await fs.mkdtemp("/tmp/tandoor-provision-");
    const target = `${tempDir}/password.txt`;
    await verifyPasswordDeliveryChannel({ kind: "file", filePath: target });
    await deliverTemporaryPasswordToChannel("blocker", { kind: "file", filePath: target });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "delivery-fail-user@example.com",
        fullName: "Delivery Fail User",
        actorUserId: actorAdminId,
        operationId: randomUUID(),
        basis: "Проверка незавершённой выдачи при ошибке доставки",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!GH",
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
      if (!created.ok || created.mode !== "created") {
        return;
      }

      await assert.rejects(
        () =>
          deliverTemporaryPasswordToChannel(created.temporaryPassword, {
            kind: "file",
            filePath: target,
          }),
        /already exists/,
      );

      await client.query("BEGIN");
      await markAdminProvisionIncomplete(client, {
        userId: created.userId,
        actorUserId: actorAdminId,
        basis: "Проверка незавершённой выдачи при ошибке доставки",
        reason: "password delivery failed",
      });
      await client.query("COMMIT");

      const row = await lookupUserByEmail(client, "delivery-fail-user@example.com");
      assert.equal(row?.status, "disabled");
      assert.equal(row?.role, "admin");
      const inspect = await inspectUserByEmail(client, "delivery-fail-user@example.com");
      assert.equal(inspect.provisionState, "pending_delivery");
    } finally {
      client.release();
    }
  });

  it("CLI: pending delivery resume fails closed when password update rolls back", async () => {
    const tempDir = await fs.mkdtemp("/tmp/tandoor-provision-");
    const recoveryFile = `${tempDir}/rolled-back-resume.txt`;
    await seedPendingDelivery(pool, {
      email: "rolled-back-resume@example.com",
      fullName: "Rolled Back Resume",
      actorUserId: actorAdminId,
      basis: "Pending delivery before rolled-back resume",
      temporaryPassword: "TempPass123!RB",
    });
    await verifyPasswordDeliveryChannel({ kind: "file", filePath: recoveryFile });

    setTestSimulateCommitFailure(true);
    const grantClient = await pool.connect();
    try {
      const result = await runAdminGrant(pool, grantClient, {
        email: "rolled-back-resume@example.com",
        fullName: "Rolled Back Resume",
        actorUserId: actorAdminId,
        basis: "Повтор после отката обновления пароля",
        auditReviewConfirmed: true,
        passwordDelivery: { kind: "file", filePath: recoveryFile },
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "PROVISION_OUTCOME_ROLLED_BACK");
        assert.equal(result.recoveryStatus, "pending_delivery");
      }
    } finally {
      grantClient.release();
      setTestSimulateCommitFailure(false);
    }

    await assert.rejects(() => fs.access(recoveryFile));
    const client = await pool.connect();
    try {
      const row = await lookupUserByEmail(client, "rolled-back-resume@example.com");
      assert.equal(row?.status, "disabled");
      assert.equal((await inspectUserByEmail(client, "rolled-back-resume@example.com")).provisionState, "pending_delivery");
    } finally {
      client.release();
    }
  });

  it("CLI: manager to admin does not report success when operation rolls back", async () => {
    await createTestUser({
      databaseUrl,
      email: "rollback-manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Rollback Manager",
      role: "manager",
    });

    setTestSimulateCommitFailure(true);
    const grantClient = await pool.connect();
    try {
      const result = await runAdminGrant(pool, grantClient, {
        email: "rollback-manager@example.com",
        fullName: "Rollback Manager",
        actorUserId: actorAdminId,
        basis: "Попытка назначения admin с откатом операции",
        auditReviewConfirmed: true,
        assignAdminRoleOnly: true,
        passwordDelivery: null,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "PROVISION_OUTCOME_ROLLED_BACK");
      }
    } finally {
      grantClient.release();
      setTestSimulateCommitFailure(false);
    }

    const client = await pool.connect();
    try {
      const row = await lookupUserByEmail(client, "rollback-manager@example.com");
      assert.equal(row?.role, "manager");
    } finally {
      client.release();
    }
  });

  it("CLI: lost commit ack still confirms operation and completes delivery", async () => {
    const tempDir = await fs.mkdtemp("/tmp/tandoor-provision-");
    const deliveryFile = `${tempDir}/ack-lost-delivery.txt`;
    await verifyPasswordDeliveryChannel({ kind: "file", filePath: deliveryFile });

    setTestSimulateCommitAckLost(true);
    const grantClient = await pool.connect();
    try {
      const result = await runAdminGrant(pool, grantClient, {
        email: "ack-lost-user@example.com",
        fullName: "Ack Lost User",
        actorUserId: actorAdminId,
        basis: "COMMIT выполнен, подтверждение ответа потеряно",
        auditReviewConfirmed: true,
        passwordDelivery: { kind: "file", filePath: deliveryFile },
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.mode, "created");
        assert.equal(result.operationOutcome, "committed");
      }
    } finally {
      grantClient.release();
      setTestSimulateCommitAckLost(false);
    }

    const client = await pool.connect();
    try {
      const row = await lookupUserByEmail(client, "ack-lost-user@example.com");
      assert.equal(row?.status, "active");
      assert.equal((await inspectUserByEmail(client, "ack-lost-user@example.com")).provisionState, "delivered");
      await fs.access(deliveryFile);
    } finally {
      client.release();
    }
  });

  it("CLI: fail-closed when operation outcome verification is unavailable", async () => {
    await seedPendingDelivery(pool, {
      email: "verify-unavailable@example.com",
      fullName: "Verify Unavailable",
      actorUserId: actorAdminId,
      basis: "Pending delivery before verify fault",
      temporaryPassword: "TempPass123!VU",
    });

    const tempDir = await fs.mkdtemp("/tmp/tandoor-provision-");
    const recoveryFile = `${tempDir}/verify-unavailable.txt`;
    await verifyPasswordDeliveryChannel({ kind: "file", filePath: recoveryFile });

    setTestSimulateCommitFailure(true);
    setTestFaultOnOperationVerify(true);
    const grantClient = await pool.connect();
    try {
      const result = await runAdminGrant(pool, grantClient, {
        email: "verify-unavailable@example.com",
        fullName: "Verify Unavailable",
        actorUserId: actorAdminId,
        basis: "Проверка исхода операции недоступна",
        auditReviewConfirmed: true,
        passwordDelivery: { kind: "file", filePath: recoveryFile },
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "PROVISION_OUTCOME_UNKNOWN");
        assert.equal(result.operationOutcome, "unknown");
        assert.equal(result.recoveryStatus, "pending_delivery");
        assert.match(result.message, /fail-closed|неизвестен/i);
      }
    } finally {
      grantClient.release();
      setTestSimulateCommitFailure(false);
      setTestFaultOnOperationVerify(false);
    }

    await assert.rejects(() => fs.access(recoveryFile));
  });

  it("keeps account disabled when incomplete audit write fails after delivery error", async () => {
    const tempDir = await fs.mkdtemp("/tmp/tandoor-provision-");
    const target = `${tempDir}/password.txt`;
    await verifyPasswordDeliveryChannel({ kind: "file", filePath: target });

    const client = await pool.connect();
    let userId = "";
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "audit-compensation-user@example.com",
        fullName: "Audit Compensation User",
        actorUserId: actorAdminId,
        operationId: randomUUID(),
        basis: "Компенсация при недоступном аудите",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!KL",
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
      if (!created.ok || created.mode !== "created") {
        return;
      }
      userId = created.userId;

      setTestFaultBeforeProvisionIncompleteAudit(true);
      await assert.rejects(() =>
        markAdminProvisionIncomplete(client, {
          userId,
          actorUserId: actorAdminId,
          basis: "Компенсация при недоступном аудите",
          reason: "password delivery failed",
        }),
      );
      setTestFaultBeforeProvisionIncompleteAudit(false);

      const row = await lookupUserByEmail(client, "audit-compensation-user@example.com");
      assert.equal(row?.status, "disabled");
      if (row) {
        assert.equal(await getProvisionStateForUser(client, row), "pending_delivery");
      }
    } finally {
      client.release();
    }
  });

  it("separates account changes from actions performed by two admins", async () => {
    const adminTwo = await createTestUser({
      databaseUrl,
      email: "audit-admin-two@example.com",
      password: TEST_PASSWORD,
      fullName: "Audit Admin Two",
      role: "admin",
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "audit-target@example.com",
        fullName: "Audit Target",
        actorUserId: actorAdminId,
        operationId: randomUUID(),
        basis: "Первичная выдача admin для аудита",
        auditReviewConfirmed: true,
        temporaryPassword: "TempPass123!AB",
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
      if (!created.ok || created.mode !== "created") {
        return;
      }

      await pool.query(
        `
          INSERT INTO access_audit_log (actor_user_id, action, entity_type, entity_id, basis)
          VALUES ($1::uuid, $2, 'grant', gen_random_uuid(), 'grant by admin two')
        `,
        [adminTwo.id, ACCESS_AUDIT_ACTIONS.GRANT_CREATE],
      );

      const report = await queryEmployeeAuditReport({ userId: created.userId });
      assert.ok(report.accountChanges.length >= 2);
      assert.equal(report.accountChanges.every((row) => row.domain === "account"), true);
      assert.ok(report.accountChanges.every((row) => row.entityId === created.userId));
      assert.ok(
        report.accountChanges.some((row) => row.actorEmail === "provisioning-actor@example.com"),
      );
      assert.equal(report.actionsPerformed.length, 0);

      const adminTwoReport = await queryEmployeeAuditReport({ userId: adminTwo.id });
      assert.ok(
        adminTwoReport.actionsPerformed.some(
          (row) => row.action === ACCESS_AUDIT_ACTIONS.GRANT_CREATE,
        ),
      );
      assert.ok(report.disclaimer.includes("Preview"));
    } finally {
      client.release();
    }
  });

  it("records preview with admin as actor, not target employee", async () => {
    const target = await createTestUser({
      databaseUrl,
      email: "preview-target@example.com",
      password: TEST_PASSWORD,
      fullName: "Preview Target",
      role: "manager",
    });
    await pool.query(
      `
        INSERT INTO access_audit_log (actor_user_id, action, entity_type, entity_id, basis)
        VALUES ($1::uuid, $2, 'user_preview', $3::uuid, 'preview session')
      `,
      [actorAdminId, ACCESS_AUDIT_ACTIONS.PREVIEW_START, target.id],
    );

    const targetReport = await queryEmployeeAuditReport({ userId: target.id });
    assert.equal(
      targetReport.actionsPerformed.some((row) => row.action === ACCESS_AUDIT_ACTIONS.PREVIEW_START),
      false,
    );

    const adminReport = await queryEmployeeAuditReport({ userId: actorAdminId });
    assert.ok(
      adminReport.actionsPerformed.some((row) => row.action === ACCESS_AUDIT_ACTIONS.PREVIEW_START),
    );
    assert.equal(
      adminReport.actionsPerformed.find((row) => row.action === ACCESS_AUDIT_ACTIONS.PREVIEW_START)
        ?.entityId,
      target.id,
    );
  });

  it("shows client review history from two admins in employee audit", async () => {
    const adminTwo = await createTestUser({
      databaseUrl,
      email: "review-admin-two@example.com",
      password: TEST_PASSWORD,
      fullName: "Review Admin Two",
      role: "admin",
    });

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Альфа Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "Москва",
        telephone: [],
        manager_roster_state: "in_wholesale_roster",
      },
    ]);

    const adminOneCookie = await login("provisioning-actor@example.com", TEST_PASSWORD);
    const adminTwoCookie = await login("review-admin-two@example.com", TEST_PASSWORD);
    const app = await loadApp();

    const first = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set({ Origin: ORIGIN, Cookie: adminOneCookie, "Content-Type": "application/json" })
      .send({ reviewState: "in_progress", expectedVersion: null });
    assert.equal(first.status, 200);

    const second = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set({ Origin: ORIGIN, Cookie: adminTwoCookie, "Content-Type": "application/json" })
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "Ревизия второго администратора",
        expectedVersion: first.body.review.version,
      });
    assert.equal(second.status, 200, JSON.stringify(second.body));

    const adminOneReport = await queryEmployeeAuditReport({ userId: actorAdminId });
    const adminTwoReport = await queryEmployeeAuditReport({ userId: adminTwo.id });

    const oneReviews = adminOneReport.actionsPerformed.filter((row) => row.domain === "reviews");
    const twoReviews = adminTwoReport.actionsPerformed.filter((row) => row.domain === "reviews");

    assert.equal(oneReviews.length, 1);
    assert.equal(twoReviews.length, 1);
    assert.equal(oneReviews[0]?.entityId, CLIENT_ONE);
    assert.equal(twoReviews[0]?.entityId, CLIENT_ONE);
    assert.equal(oneReviews[0]?.actorEmail, "provisioning-actor@example.com");
    assert.equal(twoReviews[0]?.actorEmail, "review-admin-two@example.com");
    assert.notEqual(oneReviews[0]?.action, twoReviews[0]?.action);
    assert.ok(oneReviews[0]?.details?.after);
    assert.ok(twoReviews[0]?.details?.after);

    const coverage = adminOneReport.coverage.find((row) => row.domain === "reviews");
    assert.ok(coverage);
    assert.match(coverage?.source ?? "", /client_review_history/i);

    const exportsCoverage = adminOneReport.coverage.find((row) => row.domain === "exports");
    assert.ok(exportsCoverage);
    assert.match(exportsCoverage?.notes ?? "", /не реализован/i);
  });
});
