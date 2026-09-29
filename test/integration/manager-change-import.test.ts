import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  addRopTeamMember,
  grantClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const ROP_EMP = "77777777-7777-4777-8777-777777777777";
const UNKNOWN_EMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const HOLDING = "44444444-4444-4444-8444-444444444444";

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
  return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
}

async function adminPost(path: string, body: unknown, adminCookie: string) {
  const app = await loadApp();
  return request(app)
    .post(path)
    .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
    .send(body);
}

async function applyBytes(databaseUrl: string, clients: Record<string, unknown>[]) {
  const bytes = buildClientsFileBytes(clients);
  const hash = buildClientsFileSha256(clients);
  const result = await runClientsImport({
    env: ftpEnv(databaseUrl),
    argv: ["--apply", "--expected-sha256", hash],
    fileBytes: bytes,
  });
  assert.equal(result.status, "SUCCESS", JSON.stringify(result));
}

describe("manager reassignment after import", { concurrency: false }, () => {
  let databaseUrl = "";
  let adminUserId = "";
  let managerAUserId = "";
  let managerBUserId = "";
  let ropUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
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

    managerAUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-a@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager A",
        role: "manager",
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
    ropUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP",
        role: "rop",
      })
    ).id;

    await linkUserToEmployee({
      databaseUrl,
      userId: managerAUserId,
      employeeId: MANAGER_A,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerBUserId,
      employeeId: MANAGER_B,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropUserId,
      employeeId: ROP_EMP,
      confirmedByUserId: adminUserId,
    });
    await addRopTeamMember({
      databaseUrl,
      ropUserId,
      memberUserId: managerAUserId,
      createdByUserId: adminUserId,
    });
  });

  after(async () => {
    await closePool();
  });

  it("moves client visibility across list, search, filters, counts and detail after guid_manager change", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A", name_client: "Alpha Searchable" }),
      sampleClientTwo({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);

    const managerACookie = await login("manager-a@example.com");
    const app = await loadApp();

    assert.equal(
      (await request(app).get("/api/clients").set(authHeaders(managerACookie))).body.total,
      1,
    );
    assert.equal(
      (
        await request(app)
          .get("/api/clients?q=" + encodeURIComponent("Alpha"))
          .set(authHeaders(managerACookie))
      ).body.total,
      1,
    );

    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B", name_client: "Alpha Searchable" }),
      sampleClientTwo({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);

    const appAfter = await loadApp();
    const listAfter = await request(appAfter).get("/api/clients").set(authHeaders(managerACookie));
    assert.equal(listAfter.body.total, 0);
    assert.equal(
      (await request(appAfter).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerACookie))).status,
      404,
    );

    const managerBCookie = await login("manager-b@example.com");
    const managerBList = await request(appAfter).get("/api/clients").set(authHeaders(managerBCookie));
    assert.equal(managerBList.body.total, 2);
  });

  it("does not grant access to unknown manager GUID or by name alone", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({
        guid_manager: UNKNOWN_EMP,
        name_manager: "Manager A",
      }),
    ]);

    const managerACookie = await login("manager-a@example.com");
    const app = await loadApp();
    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerACookie))).status,
      404,
    );
  });

  it("keeps ROP visibility within team scope after reassignment", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);

    const ropCookie = await login("rop@example.com");
    const app = await loadApp();
    assert.equal((await request(app).get("/api/clients").set(authHeaders(ropCookie))).body.total, 1);

    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);

    const appAfter = await loadApp();
    assert.equal(
      (await request(appAfter).get("/api/clients").set(authHeaders(ropCookie))).body.total,
      0,
    );
  });

  it("preserves explicit regional grant while removing manager scope after reassignment", async () => {
    const regionalUserId = (
      await createTestUser({
        databaseUrl,
        email: "regional@example.com",
        password: TEST_PASSWORD,
        fullName: "Regional",
        role: "regional_manager",
      })
    ).id;
    await linkUserToEmployee({
      databaseUrl,
      userId: regionalUserId,
      employeeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      confirmedByUserId: adminUserId,
    });
    await grantClientAccess({
      databaseUrl,
      userId: regionalUserId,
      objectId: CLIENT_ONE,
      grantedByUserId: adminUserId,
    });

    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);

    const regionalCookie = await login("regional@example.com");
    const app = await loadApp();
    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(regionalCookie))).status,
      200,
    );
  });

  it("does not expose holding neighbors outside scope after reassignment", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
        guid_holding: HOLDING,
        name_holding: "Holding East",
      }),
      sampleClientTwo({
        guid_client: CLIENT_TWO,
        guid_manager: MANAGER_B,
        name_manager: "Manager B",
        guid_holding: HOLDING,
        name_holding: "Holding East",
      }),
    ]);

    await applyBytes(databaseUrl, [
      sampleClient({
        guid_manager: MANAGER_B,
        name_manager: "Manager B",
        guid_holding: HOLDING,
        name_holding: "Holding East",
      }),
      sampleClientTwo({
        guid_client: CLIENT_TWO,
        guid_manager: MANAGER_B,
        name_manager: "Manager B",
        guid_holding: HOLDING,
        name_holding: "Holding East",
      }),
    ]);

    const managerACookie = await login("manager-a@example.com");
    const app = await loadApp();
    const holdingFilter = await request(app)
      .get(`/api/clients?holding=${HOLDING}`)
      .set(authHeaders(managerACookie));
    assert.equal(holdingFilter.body.total, 0);
  });

  it("respects manager denial after reassignment", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);

    const adminCookie = await login("admin@example.com");
    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: managerAUserId,
        scopeType: "client",
        objectId: CLIENT_ONE,
        reason: "explicit block",
        basis: "import reassignment test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const managerACookie = await login("manager-a@example.com");
    const app = await loadApp();
    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerACookie))).status,
      404,
    );
  });
});
