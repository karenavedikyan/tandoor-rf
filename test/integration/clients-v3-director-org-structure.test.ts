import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ORG_DIRECTOR_EMPLOYEE_GUID, ROSTER_ROP_POST_LABEL } from "../../src/clients/org/constants";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const ROP = "55555555-5555-4555-8555-555555555555";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const DIRECTOR_NAME = "Org Director Fixture";

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
    .send({ email: email.trim().toLowerCase(), password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

function buildRosterBytes(directorPost: string, directorEmail: string) {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
    buildEmployeeRosterEntry(ORG_DIRECTOR_EMPLOYEE_GUID, {
      name_manager: DIRECTOR_NAME,
      post: directorPost,
      email: directorEmail,
    }),
    buildEmployeeRosterEntry(ROP, {
      name_manager: "ROP Fixture One",
      post: ROSTER_ROP_POST_LABEL,
    }),
  ]);
}

async function applyV3Bundle(databaseUrl: string, employeesBytes: Buffer) {
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
  assert.notEqual(applied.status, "NO_CHANGES", applied.message ?? "expected a real apply");
  assert.equal(applied.status, "SUCCESS", applied.message ?? "apply failed");
  return applied;
}

async function readRosterPost(databaseUrl: string, guid: string): Promise<string | null> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ post: string | null }>(
    `SELECT post FROM onec_wholesale_employee_roster WHERE lower(guid_manager::text) = $1`,
    [guid.toLowerCase()],
  );
  await pool.end();
  return row.rows[0]?.post ?? null;
}

async function countActiveLinks(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM user_onec_employee_links WHERE revoked_at IS NULL`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("v3 org-structure director GUID", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
  });

  after(async () => {
    await closePool();
  });

  it("classifies canonical director by GUID across two roster imports and keeps ROP branch", async () => {
    await prepareDatabase(databaseUrl);
    const adminEmail = "admin-v3-director-org@example.com";
    const admin = await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Director Org",
      role: "admin",
    });
    const managerEmail = "manager-v3-director-org@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager Director Org",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    const linksBefore = await countActiveLinks(databaseUrl);

    const firstEmployees = buildRosterBytes(ROSTER_ROP_POST_LABEL, "director-org-a@example.test");
    await applyV3Bundle(databaseUrl, firstEmployees);

    const cookie = await login(adminEmail);
    const app = await loadApp();

    async function assertStructure(expectedDirectorPost: string) {
      const overview = await request(app)
        .get("/api/clients/v3/org-structure")
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(overview.status, 200);
      assert.ok(overview.body.director);
      assert.equal(overview.body.director.employeeGuid.toLowerCase(), ORG_DIRECTOR_EMPLOYEE_GUID);
      assert.equal(overview.body.director.name, DIRECTOR_NAME);
      assert.equal(overview.body.director.rosterPost, expectedDirectorPost);
      assert.ok(
        !overview.body.rops.some(
          (r: { employeeGuid: string }) => r.employeeGuid.toLowerCase() === ORG_DIRECTOR_EMPLOYEE_GUID,
        ),
        "director GUID must not appear among ROP rows",
      );
      const ropRow = overview.body.rops.find((r: { employeeGuid: string }) => r.employeeGuid === ROP);
      assert.ok(ropRow, "expected separate ROP fixture row");
      assert.equal(ropRow.rosterPost, ROSTER_ROP_POST_LABEL);
      assert.ok(ropRow.uniqueClientCount >= 1 || ropRow.uniqueOutletCount >= 1, "ROP branch keeps v3 portfolio");
    }

    await assertStructure(ROSTER_ROP_POST_LABEL);
    assert.equal(await readRosterPost(databaseUrl, ORG_DIRECTOR_EMPLOYEE_GUID), ROSTER_ROP_POST_LABEL);

    const secondEmployees = buildRosterBytes(ROSTER_ROP_POST_LABEL, "director-org-b@example.test");
    await applyV3Bundle(databaseUrl, secondEmployees);

    await assertStructure(ROSTER_ROP_POST_LABEL);
    assert.equal(await readRosterPost(databaseUrl, ORG_DIRECTOR_EMPLOYEE_GUID), ROSTER_ROP_POST_LABEL);
    assert.equal(await countActiveLinks(databaseUrl), linksBefore);

    const directorTitleEmployees = buildRosterBytes("Директор", "director-org-c@example.test");
    await applyV3Bundle(databaseUrl, directorTitleEmployees);
    await assertStructure("Директор");
    assert.equal(await readRosterPost(databaseUrl, ORG_DIRECTOR_EMPLOYEE_GUID), "Директор");
  });
});
