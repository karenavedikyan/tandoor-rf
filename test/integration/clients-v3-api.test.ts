import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
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
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const HOLDING = "a1000000-0000-4000-8000-000000000001";
const LEGAL = "b2000000-0000-4000-8000-000000000001";
const RETAIL = "c3000000-0000-4000-8000-000000000001";

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

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

describe("clients v3 API", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  async function seedV3(): Promise<void> {
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
    ]);
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    const applied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(applied.status, "SUCCESS");
  }

  it("manager sees scoped v3 list; foreign detail returns 404", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-v3-api@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin V3",
      role: "admin",
    });
    const managerEmail = "manager-v3-api@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager V3",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });

    const cookie = await login(managerEmail);
    const app = await loadApp();
    const list = await request(app)
      .get("/api/clients/v3/list?entity=legal&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    assert.ok(list.body.total >= 1);

    const detailOk = await request(app)
      .get(`/api/clients/v3/detail?entity=legal&guid=${LEGAL}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(detailOk.status, 200);

    const composition = await request(app)
      .get(`/api/clients/v3/holdings/${HOLDING}/composition`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(composition.status, 200);
    assert.ok(Array.isArray(composition.body.legalEntities));

    const manager2Email = "manager2-v3-api@example.com";
    const manager2 = await createTestUser({
      databaseUrl,
      email: manager2Email,
      password: TEST_PASSWORD,
      fullName: "Manager Two",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager2.id,
      employeeId: M2,
      confirmedByUserId: admin.id,
    });
    const cookie2 = await login(manager2Email);
    const withheld = await request(app)
      .get(`/api/clients/v3/detail?entity=legal&guid=${LEGAL}`)
      .set({ Origin: ORIGIN, Cookie: cookie2 });
    assert.equal(withheld.status, 404);
  });

  it("sync-status exposes exchangeV3Active", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const adminEmail = "admin-v3-sync@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Sync",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();
    const res = await request(app).get("/api/clients/sync-status").set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.exchangeV3Active, true);
  });
});
