import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Express } from "express";
import request from "supertest";
import { Pool } from "pg";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import {
  buildClientsFileBytes,
  buildImportVerificationFingerprint,
  sampleClient,
} from "../helpers/onec-clients-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";

function authHeaders(cookie: string): Record<string, string> {
  return { Origin: ORIGIN, Cookie: cookie };
}

function ftpEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "127.0.0.1",
    ONEC_FTP_PORT: "21",
    ONEC_FTP_USER: "lc_exchange",
    ONEC_FTP_PASSWORD: "test-password",
    ONEC_FTP_BASE_PATH: "/LC",
    ONEC_FTP_TIMEOUT_MS: "15000",
  };
}

async function applyWithOptionalRoster(
  databaseUrl: string,
  clients: Record<string, unknown>[],
  rosterBytes?: Buffer,
) {
  const hash = buildImportVerificationFingerprint(clients, { employeeRosterBytes: rosterBytes });
  const result = await runClientsImport({
    env: ftpEnv(databaseUrl),
    argv: ["--apply", "--expected-sha256", hash],
    fileBytes: buildClientsFileBytes(clients),
    employeeRosterBytes: rosterBytes,
  });
  assert.equal(result.status, "SUCCESS", JSON.stringify(result));
}

describe("PR41 R3 roster reassignment without confirmation", { concurrency: false }, () => {
  let databaseUrl = "";
  let app!: Express;
  let adminUserId = "";
  let managerBUserId = "";
  let managerBCookie = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    app = createApp();
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);

    adminUserId = (
      await createTestUser({
        databaseUrl,
        email: "admin@example.com",
        password: TEST_PASSWORD,
        fullName: "Admin",
        role: "admin",
      })
    ).id;

    managerBUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-b@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager B",
        role: "manager",
      })
    ).id;

    await linkUserToEmployee({
      databaseUrl,
      userId: managerBUserId,
      employeeId: MANAGER_B,
      confirmedByUserId: adminUserId,
    });

    const login = async (email: string) => {
      const res = await request(app)
        .post("/api/auth/login")
        .set({ Origin: ORIGIN, "Content-Type": "application/json" })
        .send({ email, password: TEST_PASSWORD });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
    };
    managerBCookie = await login("manager-b@example.com");
  });

  after(async () => {
    await closePool();
  });

  it("does not grant access to new manager without roster confirmation", async () => {
    const rosterA = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Manager A" }),
    ]);
    await applyWithOptionalRoster(
      databaseUrl,
      [sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" })],
      rosterA,
    );

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const before = await pool.query<{ manager_roster_state: string }>(
      `SELECT manager_roster_state FROM onec_clients WHERE guid_client = $1::uuid`,
      [CLIENT_ONE],
    );
    await pool.end();
    assert.equal(before.rows[0]?.manager_roster_state, "in_wholesale_roster");

    await applyWithOptionalRoster(
      databaseUrl,
      [sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" })],
    );

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const after = await poolAfter.query<{ manager_roster_state: string; guid_manager: string }>(
      `SELECT manager_roster_state, guid_manager::text FROM onec_clients WHERE guid_client = $1::uuid`,
      [CLIENT_ONE],
    );
    await poolAfter.end();
    assert.equal(after.rows[0]?.guid_manager, MANAGER_B);
    assert.equal(after.rows[0]?.manager_roster_state, "outside_wholesale_roster");

    assert.equal(
      (await request(app).get("/api/clients").set(authHeaders(managerBCookie))).body.total,
      0,
    );
    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerBCookie))).status,
      404,
    );
  });

  it("grants access after roster-confirmed reassignment to linked employee", async () => {
    await applyWithOptionalRoster(
      databaseUrl,
      [sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" })],
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Manager A" })]),
    );

    const rosterB = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(MANAGER_A, { name_manager: "Manager A" }),
      buildEmployeeRosterEntry(MANAGER_B, { name_manager: "Manager B" }),
    ]);
    await applyWithOptionalRoster(
      databaseUrl,
      [sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" })],
      rosterB,
    );

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ manager_roster_state: string }>(
      `SELECT manager_roster_state FROM onec_clients WHERE guid_client = $1::uuid`,
      [CLIENT_ONE],
    );
    await pool.end();
    assert.equal(row.rows[0]?.manager_roster_state, "in_wholesale_roster");

    assert.equal(
      (await request(app).get("/api/clients").set(authHeaders(managerBCookie))).body.total,
      1,
    );
    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerBCookie))).status,
      200,
    );
  });
});
