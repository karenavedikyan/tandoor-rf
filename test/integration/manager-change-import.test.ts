import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Express } from "express";
import request from "supertest";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  addRopTeamMember,
  createDelegationRecord,
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
  buildImportVerificationFingerprint,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const MANAGER_C = "66666666-6666-4666-8666-666666666666";
const ROP_A_EMP = "77777777-7777-4777-8777-777777777777";
const ROP_B_EMP = "88888888-8888-4888-8888-888888888888";
const ASSISTANT_EMP = "99999999-9999-4999-8999-999999999999";
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

async function applyBytes(
  databaseUrl: string,
  clients: Record<string, unknown>[],
  rosterBytes?: Buffer,
) {
  const bytes = buildClientsFileBytes(clients);
  const hash = buildImportVerificationFingerprint(clients, { employeeRosterBytes: rosterBytes });
  const result = await runClientsImport({
    env: ftpEnv(databaseUrl),
    argv: ["--apply", "--expected-sha256", hash],
    fileBytes: bytes,
    employeeRosterBytes: rosterBytes,
  });
  assert.equal(result.status, "SUCCESS", JSON.stringify(result));
}

function rosterConfirmingManagers(...guids: string[]): Buffer {
  return buildEmployeeRosterBytes(
    guids.map((guid) => buildEmployeeRosterEntry(guid, { name_manager: `Roster ${guid.slice(0, 8)}` })),
  );
}

describe("manager reassignment after import (same app session)", { concurrency: false }, () => {
  let databaseUrl = "";
  let app!: Express;
  let adminUserId = "";
  let managerAUserId = "";
  let managerBUserId = "";
  let managerCUserId = "";
  let ropAUserId = "";
  let ropBUserId = "";
  let assistantUserId = "";
  let managerACookie = "";
  let managerBCookie = "";
  let ropACookie = "";
  let ropBCookie = "";
  let assistantCookie = "";
  let adminCookie = "";

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
    managerCUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-c@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager C",
        role: "manager",
      })
    ).id;
    ropAUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop-a@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP A",
        role: "rop",
      })
    ).id;
    ropBUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop-b@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP B",
        role: "rop",
      })
    ).id;
    assistantUserId = (
      await createTestUser({
        databaseUrl,
        email: "assistant@example.com",
        password: TEST_PASSWORD,
        fullName: "Assistant",
        role: "assistant",
      })
    ).id;

    for (const [userId, employeeId] of [
      [managerAUserId, MANAGER_A],
      [managerBUserId, MANAGER_B],
      [managerCUserId, MANAGER_C],
      [ropAUserId, ROP_A_EMP],
      [ropBUserId, ROP_B_EMP],
      [assistantUserId, ASSISTANT_EMP],
    ] as const) {
      await linkUserToEmployee({
        databaseUrl,
        userId,
        employeeId,
        confirmedByUserId: adminUserId,
      });
    }

    await addRopTeamMember({
      databaseUrl,
      ropUserId: ropAUserId,
      memberUserId: managerAUserId,
      createdByUserId: adminUserId,
    });
    await addRopTeamMember({
      databaseUrl,
      ropUserId: ropBUserId,
      memberUserId: managerCUserId,
      createdByUserId: adminUserId,
    });

    const login = async (email: string) => {
      const res = await request(app)
        .post("/api/auth/login")
        .set({ Origin: ORIGIN, "Content-Type": "application/json" })
        .send({ email, password: TEST_PASSWORD });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
    };

    adminCookie = await login("admin@example.com");
    managerACookie = await login("manager-a@example.com");
    managerBCookie = await login("manager-b@example.com");
    ropACookie = await login("rop-a@example.com");
    ropBCookie = await login("rop-b@example.com");
    assistantCookie = await login("assistant@example.com");
  });

  after(async () => {
    await closePool();
  });

  it("moves client visibility across list, search, filters, counts and detail without reloading the app", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A", name_client: "Alpha Searchable" }),
      sampleClientTwo({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);

    assert.equal((await request(app).get("/api/clients").set(authHeaders(managerACookie))).body.total, 1);
    assert.equal(
      (
        await request(app)
          .get("/api/clients?q=" + encodeURIComponent("Alpha"))
          .set(authHeaders(managerACookie))
      ).body.total,
      1,
    );

    await applyBytes(
      databaseUrl,
      [
        sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B", name_client: "Alpha Searchable" }),
        sampleClientTwo({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
      ],
      rosterConfirmingManagers(MANAGER_B),
    );

    assert.equal((await request(app).get("/api/clients").set(authHeaders(managerACookie))).body.total, 0);
    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerACookie))).status,
      404,
    );
    assert.equal((await request(app).get("/api/clients").set(authHeaders(managerBCookie))).body.total, 2);
  });

  it("scopes two ROP teams independently after reassignment", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
      sampleClientTwo({
        guid_client: CLIENT_TWO,
        guid_manager: MANAGER_C,
        name_manager: "Manager C",
      }),
    ]);

    assert.equal((await request(app).get("/api/clients").set(authHeaders(ropACookie))).body.total, 1);
    assert.equal((await request(app).get("/api/clients").set(authHeaders(ropBCookie))).body.total, 1);

    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
      sampleClientTwo({
        guid_client: CLIENT_TWO,
        guid_manager: MANAGER_C,
        name_manager: "Manager C",
      }),
    ]);

    assert.equal((await request(app).get("/api/clients").set(authHeaders(ropACookie))).body.total, 0);
    assert.equal((await request(app).get("/api/clients").set(authHeaders(ropBCookie))).body.total, 1);
  });

  it("does not grant access to unknown manager GUID or by name alone", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({
        guid_manager: UNKNOWN_EMP,
        name_manager: "Manager A",
      }),
    ]);

    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerACookie))).status,
      404,
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

    const regionalLogin = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "regional@example.com", password: TEST_PASSWORD });
    const regionalCookie = (regionalLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";

    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);

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

    const holdingFilter = await request(app)
      .get(`/api/clients?holding=${HOLDING}`)
      .set(authHeaders(managerACookie));
    assert.equal(holdingFilter.body.total, 0);
  });

  it("respects manager denial after reassignment on the same session", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);

    const denial = await request(app)
      .post("/api/admin/access/denials")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({
        userId: managerAUserId,
        scopeType: "client",
        objectId: CLIENT_ONE,
        reason: "explicit block",
        basis: "import reassignment test",
      });
    assert.equal(denial.status, 201);

    assert.equal(
      (await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(managerACookie))).status,
      404,
    );
  });

  it("updates assistant delegation visibility for active, expired and revoked states without reloading the app", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);

    const activeStarts = new Date(Date.now() - 60_000).toISOString();
    const activeEnds = new Date(Date.now() + 3_600_000).toISOString();
    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerAUserId,
      assistantUserId,
      clientGuids: [CLIENT_ONE],
      status: "active",
      startsAt: activeStarts,
      endsAt: activeEnds,
      approvedByUserId: ropAUserId,
    });

    assert.equal((await request(app).get("/api/clients").set(authHeaders(assistantCookie))).body.total, 1);

    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_B, name_manager: "Manager B" }),
    ]);
    assert.equal((await request(app).get("/api/clients").set(authHeaders(assistantCookie))).body.total, 0);

    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);

    const { Pool } = await import("pg");
    const revokePool = new Pool({ connectionString: databaseUrl, max: 1 });
    await revokePool.query(
      `
        UPDATE delegations
        SET status = 'revoked', revoked_at = NOW()
        WHERE assistant_user_id = $1::uuid AND status = 'active'
      `,
      [assistantUserId],
    );
    await revokePool.end();

    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerAUserId,
      assistantUserId,
      clientGuids: [CLIENT_ONE],
      status: "expired",
      startsAt: new Date(Date.now() - 7_200_000).toISOString(),
      endsAt: new Date(Date.now() - 3_600_000).toISOString(),
      approvedByUserId: ropAUserId,
    });
    assert.equal((await request(app).get("/api/clients").set(authHeaders(assistantCookie))).body.total, 0);

    const revokeExpiredPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await revokeExpiredPool.query(
      `
        UPDATE delegations
        SET status = 'revoked', revoked_at = NOW()
        WHERE assistant_user_id = $1::uuid
      `,
      [assistantUserId],
    );
    await revokeExpiredPool.end();

    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerAUserId,
      assistantUserId,
      clientGuids: [CLIENT_ONE],
      status: "revoked",
      startsAt: activeStarts,
      endsAt: activeEnds,
      approvedByUserId: ropAUserId,
      revokedAt: new Date().toISOString(),
    });
    assert.equal((await request(app).get("/api/clients").set(authHeaders(assistantCookie))).body.total, 0);
  });

  it("does not expose clients to disabled linked manager after import on the same session", async () => {
    await applyBytes(databaseUrl, [
      sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager A" }),
    ]);
    assert.equal((await request(app).get("/api/clients").set(authHeaders(managerACookie))).body.total, 1);

    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1::uuid", [managerAUserId]);
    await pool.end();

    assert.equal((await request(app).get("/api/clients").set(authHeaders(managerACookie))).status, 401);
  });
});
