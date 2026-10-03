import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { applyClientsImportVerified } from "../helpers/onec-clients-fixtures";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedHolding,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
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

describe("clients extended manager link read-time resolution", { concurrency: false }, () => {
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
    const regionalUser = await createTestUser({
      databaseUrl,
      email: "regional@example.com",
      password: TEST_PASSWORD,
      fullName: "Regional User",
      role: "director",
    });

    await linkUserToEmployee({
      databaseUrl,
      userId: regionalUser.id,
      employeeId: EXTENDED_FIXTURE_GUIDS.REGIONAL,
      confirmedByUserId: admin.id,
    });

    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const validated = validateClientsForApplyTest(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const applied = await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true);
  });

  after(async () => {
    await closePool();
  });

  it("shows account-linked state after import when link exists", async () => {
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${EXTENDED_FIXTURE_GUIDS.HOLDING_GUID}`)
      .set(authHeaders(cookie));

    assert.equal(res.status, 200);
    assert.equal(
      res.body.client.extended.managers.regionalManager.assignmentState,
      "directory_unverified_account_linked",
    );
  });

  it("reflects revoked link on subsequent read without re-import", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      "UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE employee_id = $1::uuid",
      [EXTENDED_FIXTURE_GUIDS.REGIONAL],
    );
    await pool.end();

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${EXTENDED_FIXTURE_GUIDS.HOLDING_GUID}`)
      .set(authHeaders(cookie));

    assert.equal(res.status, 200);
    assert.equal(
      res.body.client.extended.managers.regionalManager.assignmentState,
      "directory_unverified",
    );
    assert.doesNotMatch(
      res.body.client.extended.managers.regionalManager.assignmentLabel,
      /аккаунтом ЛК/,
    );
  });
});
