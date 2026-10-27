import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const ROP = "55555555-5555-4555-8555-555555555555";
const ASSISTANT_EMP = "99999999-9999-4999-8999-999999999999";
const LEGAL_M1 = "b2000000-0000-4000-8000-000000000001";
const LEGAL_M2 = "b2000000-0000-4000-8000-000000000004";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("assistant delegation presentation vs v3 list", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
  });

  after(async () => {
    await closePool();
  });

  async function seedV3Users(): Promise<{
    adminId: string;
    manager1Id: string;
    manager2Id: string;
    assistantId: string;
  }> {
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "deleg-pres-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Pres",
      role: "admin",
    });
    const manager1 = await createTestUser({
      databaseUrl,
      email: "deleg-pres-m1@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager One",
      role: "manager",
    });
    const manager2 = await createTestUser({
      databaseUrl,
      email: "deleg-pres-m2@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Two",
      role: "manager",
    });
    const assistant = await createTestUser({
      databaseUrl,
      email: "deleg-pres-assistant@example.com",
      password: TEST_PASSWORD,
      fullName: "Assistant Pres",
      role: "assistant",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager1.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager2.id,
      employeeId: M2,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: assistant.id,
      employeeId: ASSISTANT_EMP,
      confirmedByUserId: admin.id,
    });
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(ASSISTANT_EMP, { name_manager: "Assistant Emp" }),
      buildEmployeeRosterEntry(ROP, { name_manager: "ROP One", post: "Руководитель отдела продаж" }),
    ]);
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json")),
      clientsBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json")),
      retailBytes: fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json")),
      employeesBytes,
    });
    return {
      adminId: admin.id,
      manager1Id: manager1.id,
      manager2Id: manager2.id,
      assistantId: assistant.id,
    };
  }

  async function insertDelegation(input: {
    delegatorUserId: string;
    assistantUserId: string;
    adminId: string;
    clientGuids: string[];
    startsAt?: Date;
    endsAt?: Date;
    status?: string;
  }): Promise<string> {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const starts = input.startsAt ?? new Date(Date.now() - 3_600_000);
    const ends = input.endsAt ?? new Date(Date.now() + 30 * 86_400_000);
    const status = input.status ?? "active";
    const delegation = await pool.query<{ id: string }>(
      `
        INSERT INTO delegations (
          delegator_user_id, assistant_user_id, status, starts_at, ends_at, approved_by_user_id, approved_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, NOW())
        RETURNING id::text
      `,
      [input.delegatorUserId, input.assistantUserId, status, starts, ends, input.adminId],
    );
    const id = delegation.rows[0]!.id;
    for (const guid of input.clientGuids) {
      await pool.query(`INSERT INTO delegation_clients (delegation_id, guid_client) VALUES ($1::uuid, $2::uuid)`, [
        id,
        guid,
      ]);
    }
    await pool.end();
    return id;
  }

  async function presentationAndList(cookie: string): Promise<{
    presentation: Record<string, unknown> | null;
    listTotal: number;
  }> {
    const app = await loadApp();
    const pres = await request(app)
      .get("/api/clients/presentation")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(pres.status, 200);
    const list = await request(app)
      .get("/api/clients/v3/list?entity=legal&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    return {
      presentation: pres.body.presentation?.delegationContext ?? null,
      listTotal: list.body.total as number,
    };
  }

  it("active delegator: banner count matches accessible v3 list", async () => {
    const ids = await seedV3Users();
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.ok(presentation);
    assert.equal(presentation!.mode, "single");
    assert.equal(presentation!.clientCount, listTotal);
    assert.equal(listTotal, 1);
  });

  it("disabled delegator: no presentation context while raw delegation rows remain", async () => {
    const ids = await seedV3Users();
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1::uuid`, [ids.manager1Id]);
    await pool.end();
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.equal(presentation, null);
    assert.equal(listTotal, 0);
  });

  it("revoked employee link on delegator removes context", async () => {
    const ids = await seedV3Users();
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [ids.manager1Id],
    );
    await pool.end();
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.equal(presentation, null);
    assert.equal(listTotal, 0);
  });

  it("object denial on delegator removes context and list access", async () => {
    const ids = await seedV3Users();
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO access_denials (user_id, scope_type, object_id, reason, basis, created_by_user_id)
        VALUES ($1::uuid, 'client', $2::uuid, 'test', 'test', $3::uuid)
      `,
      [ids.manager1Id, LEGAL_M1, ids.adminId],
    );
    await pool.end();
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.equal(presentation, null);
    assert.equal(listTotal, 0);
  });

  it("expired delegation yields no context", async () => {
    const ids = await seedV3Users();
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
      endsAt: new Date(Date.now() - 60_000),
      status: "active",
    });
    const cookie = await login("deleg-pres-assistant@example.com");
    const result = await presentationAndList(cookie);
    assert.equal(result.presentation, null);
    assert.equal(result.listTotal, 0);
  });

  it("revoked delegation yields no context", async () => {
    const ids = await seedV3Users();
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE delegations SET status = 'revoked', revoked_at = NOW() WHERE assistant_user_id = $1::uuid`,
      [ids.assistantId],
    );
    await pool.end();
    const cookie = await login("deleg-pres-assistant@example.com");
    const result = await presentationAndList(cookie);
    assert.equal(result.presentation, null);
    assert.equal(result.listTotal, 0);
  });

  it("multiple active delegations use aggregate context when delegators differ", async () => {
    const ids = await seedV3Users();
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
    await insertDelegation({
      delegatorUserId: ids.manager2Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M2],
    });
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.ok(presentation);
    assert.equal(presentation!.mode, "multiple");
    assert.equal(presentation!.delegatorCount, 2);
    assert.equal(presentation!.clientCount, listTotal);
    assert.equal(listTotal, 2);
  });

  async function insertDenial(userId: string, adminId: string, input: { allClients?: boolean; objectId?: string }) {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    if (input.allClients) {
      await pool.query(
        `
          INSERT INTO access_denials (user_id, scope_type, reason, basis, created_by_user_id)
          VALUES ($1::uuid, 'all_clients', 'test', 'test', $2::uuid)
        `,
        [userId, adminId],
      );
    } else if (input.objectId) {
      await pool.query(
        `
          INSERT INTO access_denials (user_id, scope_type, object_id, reason, basis, created_by_user_id)
          VALUES ($1::uuid, 'client', $2::uuid, 'test', 'test', $3::uuid)
        `,
        [userId, input.objectId, adminId],
      );
    }
    await pool.end();
  }

  async function dualDelegationSameClient(ids: {
    manager1Id: string;
    manager2Id: string;
    assistantId: string;
    adminId: string;
  }): Promise<void> {
    await insertDelegation({
      delegatorUserId: ids.manager1Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
    await insertDelegation({
      delegatorUserId: ids.manager2Id,
      assistantUserId: ids.assistantId,
      adminId: ids.adminId,
      clientGuids: [LEGAL_M1],
    });
  }

  it("same client in two delegations: B all_clients denial → single A only", async () => {
    const ids = await seedV3Users();
    await dualDelegationSameClient(ids);
    await insertDenial(ids.manager2Id, ids.adminId, { allClients: true });
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.ok(presentation);
    assert.equal(presentation!.mode, "single");
    assert.equal(presentation!.delegatorName, "Manager One");
    assert.equal(presentation!.clientCount, 1);
    assert.equal(listTotal, 1);
  });

  it("same client in two delegations: B object denial on X → single A only", async () => {
    const ids = await seedV3Users();
    await dualDelegationSameClient(ids);
    await insertDenial(ids.manager2Id, ids.adminId, { objectId: LEGAL_M1 });
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.ok(presentation);
    assert.equal(presentation!.mode, "single");
    assert.equal(presentation!.delegatorName, "Manager One");
    assert.equal(presentation!.clientCount, 1);
    assert.equal(listTotal, 1);
  });

  it("same client in two delegations: only its current 1C owner can grant access", async () => {
    const ids = await seedV3Users();
    await dualDelegationSameClient(ids);
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.ok(presentation);
    assert.equal(presentation!.mode, "single");
    assert.equal(presentation!.delegatorName, "Manager One");
    assert.equal(presentation!.clientCount, 1);
    assert.equal(listTotal, 1);
  });

  it("same client in two delegations: both delegators denied → null and empty list", async () => {
    const ids = await seedV3Users();
    await dualDelegationSameClient(ids);
    await insertDenial(ids.manager1Id, ids.adminId, { allClients: true });
    await insertDenial(ids.manager2Id, ids.adminId, { allClients: true });
    const cookie = await login("deleg-pres-assistant@example.com");
    const { presentation, listTotal } = await presentationAndList(cookie);
    assert.equal(presentation, null);
    assert.equal(listTotal, 0);
  });
});
