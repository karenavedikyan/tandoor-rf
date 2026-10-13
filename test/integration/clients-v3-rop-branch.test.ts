import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const R1 = "44444444-4444-4444-8444-444444444444";
const ROP_A = "55555555-5555-4555-8555-555555555555";
const ROP_B = "66666666-6666-4666-8666-666666666666";
const LEGAL_ROP_A = "b2000000-0000-4000-8000-000000000001";
const LEGAL_ROP_B = "b2000000-0000-4000-8000-000000000004";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

function clientsWithTwoRopBranches(): Buffer {
  const base = JSON.parse(loadFixture("all_clients.json").toString("utf8")) as Record<string, unknown>[];
  const extra = {
    guid_client: LEGAL_ROP_B,
    name_client: "Legal ROP B Branch",
    guid_holding: "",
    name_holding: "",
    type_category: { guid_type: "t3", name_type: "Type C", guid_category: "c3", name_category: "Cat C" },
    guid_manager: M1,
    name_manager: "Manager One",
    guid_head_of_the_sales_department: ROP_B,
    name_head_of_the_sales_department: "ROP Two",
    guid_regional_manager: R1,
    name_regional_manager: "Regional Shared",
    address: "",
    telephone: [],
    Discount: "",
    DiscountAmount: 0,
    markups: [],
    other: {},
  };
  const legalA = base.find((r) => r.guid_client === LEGAL_ROP_A) as Record<string, unknown>;
  if (legalA) {
    legalA.guid_regional_manager = R1;
    legalA.name_regional_manager = "Regional Shared";
  }
  base.push(extra);
  return Buffer.from(JSON.stringify(base), "utf8");
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

describe("clients v3 ROP branch list scope", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
  });

  after(async () => {
    await closePool();
  });

  it("limits portfolio to selected ROP branch for manager and regional roles", async () => {
    await prepareDatabase(databaseUrl);
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(ROP_A, { name_manager: "ROP One", post: "Руководитель отдела продаж" }),
      buildEmployeeRosterEntry(ROP_B, { name_manager: "ROP Two", post: "Руководитель отдела продаж" }),
    ]);
    const clientsBytes = clientsWithTwoRopBranches();
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes,
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });

    const adminEmail = "admin-v3-rop-branch@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin ROP Branch",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();

    const branchA = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&ropBranchGuid=${ROP_A}&responsibleGuid=${M1}&responsibleKind=manager&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(branchA.status, 200);
    assert.ok(branchA.body.items.some((i: { guid: string }) => i.guid === LEGAL_ROP_A));
    assert.ok(!branchA.body.items.some((i: { guid: string }) => i.guid === LEGAL_ROP_B));

    const branchB = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&ropBranchGuid=${ROP_B}&responsibleGuid=${M1}&responsibleKind=manager&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(branchB.status, 200);
    assert.equal(branchB.body.items.length, 1);
    assert.equal(branchB.body.items[0].guid, LEGAL_ROP_B);

    const regionalA = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&ropBranchGuid=${ROP_A}&responsibleGuid=${R1}&responsibleKind=regional&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(regionalA.status, 200);
    assert.ok(regionalA.body.items.some((i: { guid: string }) => i.guid === LEGAL_ROP_A));
    assert.ok(!regionalA.body.items.some((i: { guid: string }) => i.guid === LEGAL_ROP_B));

    const regionalB = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&ropBranchGuid=${ROP_B}&responsibleGuid=${R1}&responsibleKind=regional&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(regionalB.status, 200);
    assert.equal(regionalB.body.items.length, 1);
    assert.equal(regionalB.body.items[0].guid, LEGAL_ROP_B);

    const withoutBranch = await request(app)
      .get(`/api/clients/v3/list?entity=legal&responsibleGuid=${M1}&responsibleKind=manager&page=1&pageSize=50`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(withoutBranch.status, 200);
    assert.ok(withoutBranch.body.total >= 2);
  });
});
