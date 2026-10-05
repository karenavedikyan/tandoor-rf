import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { applyClientsImportVerified } from "../helpers/onec-clients-fixtures";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import {
  grantClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
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
    .set(authHeaders())
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  const cookie = res.headers["set-cookie"]?.[0] ?? "";
  return cookie.split(";")[0] ?? "";
}

describe("clients extended nested outlet access", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    const managerA = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    const director = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director User",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: director.id,
      employeeId: EXTENDED_FIXTURE_GUIDS.REGIONAL,
      confirmedByUserId: admin.id,
    });

    await linkUserToEmployee({
      databaseUrl,
      userId: managerA.id,
      employeeId: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
      confirmedByUserId: admin.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: managerA.id,
      objectId: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
      grantedByUserId: admin.id,
    });

    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
    const validated = validateClientsForApplyTest(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const applied = await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true);
  });

  after(async () => {
    await closePool();
  });

  it("allows assigned manager to read nested outlets on own clients", async () => {
    const app = await loadApp();
    const cookie = await login("manager-a@example.com");
    const res = await request(app)
      .get(`/api/clients/${EXTENDED_FIXTURE_GUIDS.HOLDING_GUID}`)
      .set(authHeaders(cookie));

    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended.retailOutletsAccess, "granted");
    assert.ok(res.body.client.extended.retailOutlets.length >= 1);
    assert.match(JSON.stringify(res.body.client.extended), /Store 1 street|Delivery dock 1/);
  });

  it("denies foreign client card for manager outside guid_manager portfolio", async () => {
    const app = await loadApp();
    const cookie = await login("manager-a@example.com");
    const res = await request(app)
      .get(`/api/clients/${EXTENDED_FIXTURE_GUIDS.CHILD_GUID}`)
      .set(authHeaders(cookie));

    assert.equal(res.status, 404);
  });

  it("allows admin to read nested outlets", async () => {
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${EXTENDED_FIXTURE_GUIDS.HOLDING_GUID}`)
      .set(authHeaders(cookie));

    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended.retailOutletsAccess, "granted");
    assert.ok(res.body.client.extended.retailOutlets.length >= 1);
    assert.match(
      JSON.stringify(res.body.client.extended),
      /Store 1 street|Delivery dock 1/,
    );
  });

  it("allows director with fullClientBase to read nested outlets", async () => {
    const app = await loadApp();
    const cookie = await login("director@example.com");
    const res = await request(app)
      .get(`/api/clients/${EXTENDED_FIXTURE_GUIDS.HOLDING_GUID}`)
      .set(authHeaders(cookie));

    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended.retailOutletsAccess, "granted");
    assert.ok(res.body.client.extended.retailOutlets.length >= 1);
  });
});
