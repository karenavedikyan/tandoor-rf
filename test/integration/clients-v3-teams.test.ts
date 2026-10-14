import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { listV3RopResponsibles } from "../../src/clients/v3/teams-structure";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const ROP = "55555555-5555-4555-8555-555555555555";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

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

describe("clients v3 teams org-structure", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
  });

  after(async () => {
    await closePool();
  });

  it("uses v3 portfolios when legacy onec_clients and onec_retail_outlets are empty", async () => {
    await prepareDatabase(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const legacyClients = await pool.query(`SELECT COUNT(*)::int AS c FROM onec_clients`);
    const legacyOutlets = await pool.query(`SELECT COUNT(*)::int AS c FROM onec_retail_outlets`);
    assert.equal(legacyClients.rows[0]?.c, 0);
    assert.equal(legacyOutlets.rows[0]?.c, 0);
    await pool.end();

    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(ROP, {
        name_manager: "ROP One",
        post: "Руководитель отдела продаж",
      }),
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
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });

    const adminEmail = "admin-v3-teams@example.com";
    const admin = await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Teams",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();
    const overview = await request(app)
      .get("/api/clients/v3/org-structure")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(overview.status, 200);
    const ropRow = overview.body.rops.find((r: { employeeGuid: string }) => r.employeeGuid === ROP);
    assert.ok(ropRow, "ROP from roster expected");
    assert.ok(ropRow.uniqueClientCount >= 1, "v3 legal count in ROP branch");
    assert.ok(ropRow.uniqueOutletCount >= 1, "v3 retail count in ROP branch");
    assert.ok(ropRow.managerCount >= 1, "manager count matches accessible responsibles");
    assert.ok(ropRow.teamMemberCount >= ropRow.managerCount, "team members deduped across kinds");

    const adminCtx = {
      status: "active" as const,
      role: "admin" as const,
      fullClientBase: true,
      userId: admin.id,
    };
    const directItems = await listV3RopResponsibles(adminCtx, ROP);
    assert.ok(directItems.length >= 1);

    const responsibles = await request(app)
      .get(`/api/clients/v3/org-structure/${ROP}/responsibles`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(responsibles.status, 200);
    const managerRow = responsibles.body.items.find(
      (i: { kind: string; employeeGuid: string }) => i.kind === "manager" && i.employeeGuid === M1.toLowerCase(),
    );
    assert.ok(managerRow);
    assert.ok(managerRow.clientCount >= 1 || managerRow.outletCount >= 1);

    const managerEmail = "manager-v3-teams@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager Teams",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    const legacyOrg = await request(app)
      .get("/api/clients/org-structure")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(legacyOrg.status, 200);
    const legacyRop = legacyOrg.body.rops?.find((r: { employeeGuid: string }) => r.employeeGuid === ROP);
    assert.equal(legacyRop?.uniqueClientCount ?? 0, 0, "legacy org must not drive portfolio counts");

    const mgrCookie = await login(managerEmail);
    const mgrList = await request(app)
      .get("/api/clients/v3/list?entity=legal&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(mgrList.status, 200);
    assert.ok(mgrList.body.total >= 1, "manager portfolio comes from v3 assignment, not legacy tables");
  });
});
