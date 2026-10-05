import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertSyntheticRetailOutlets,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
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

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const ROP_EMPLOYEE = "77777777-7777-4777-8777-777777777777";
const REGIONAL_EMPLOYEE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIRECTOR_EMPLOYEE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const STORE_ONE = "44444444-4444-4444-8444-444444444444";
const STORE_TWO = "55555555-5555-5555-8555-555555555555";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: ORIGIN };
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
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("clients role views integration", { concurrency: false }, () => {
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

    const managerAUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-a@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager A",
        role: "manager",
      })
    ).id;
    const managerBUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-b@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager B",
        role: "manager",
      })
    ).id;
    const ropUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP User",
        role: "rop",
      })
    ).id;
    const regionalUserId = (
      await createTestUser({
        databaseUrl,
        email: "regional@example.com",
        password: TEST_PASSWORD,
        fullName: "Regional User",
        role: "regional_manager",
      })
    ).id;
    const directorUserId = (
      await createTestUser({
        databaseUrl,
        email: "director@example.com",
        password: TEST_PASSWORD,
        fullName: "Director User",
        role: "director",
      })
    ).id;

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Alpha Client",
        guid_manager: MANAGER_A,
        name_manager: "Manager Ivanov",
        address: "Moscow",
        telephone: ["+79990001122"],
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Beta Client",
        guid_manager: MANAGER_B,
        name_manager: "Manager Petrov",
        address: "Kazan",
        telephone: [],
      },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: STORE_ONE, guid_client: CLIENT_ONE, is_closed: false },
      { guid_store: STORE_TWO, guid_client: CLIENT_ONE, is_closed: true },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      CLIENT_ONE,
      {
        currentRetailOutlets: [
          {
            ordinal: 1,
            guidStore: STORE_ONE,
            holdingName: "Holding",
            outletGuidStatus: "confirmed",
            closed: false,
            address: { storeAddress: "Store One Address", deliveryAddress: "", routeDirection: "" },
            managers: {
              manager: { guid: MANAGER_A, name: "Manager", state: "directory_unverified" },
              regionalManager: { guid: REGIONAL_EMPLOYEE, name: "Regional", state: "directory_unverified" },
              hardwareManager: { guid: null, name: "", state: "not_provided" },
              headOfSales: { guid: null, name: "", state: "not_provided" },
            },
          },
          {
            ordinal: 2,
            guidStore: STORE_TWO,
            holdingName: "Holding",
            outletGuidStatus: "confirmed",
            closed: true,
            address: { storeAddress: "Store Two Address", deliveryAddress: "", routeDirection: "" },
            managers: {
              manager: { guid: MANAGER_A, name: "Manager", state: "directory_unverified" },
              regionalManager: { guid: MANAGER_B, name: "Other Regional", state: "directory_unverified" },
              hardwareManager: { guid: null, name: "", state: "not_provided" },
              headOfSales: { guid: null, name: "", state: "not_provided" },
            },
          },
        ],
      },
    );
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 2 });

    const adminCookie = await login("admin@example.com");
    for (const [userId, employeeId] of [
      [managerAUserId, MANAGER_A],
      [managerBUserId, MANAGER_B],
      [ropUserId, ROP_EMPLOYEE],
      [regionalUserId, REGIONAL_EMPLOYEE],
      [directorUserId, DIRECTOR_EMPLOYEE],
    ] as const) {
      const link = await request(await loadApp())
        .post("/api/admin/access/employee-links")
        .set({ Origin: ORIGIN, "Content-Type": "application/json", Cookie: adminCookie })
        .send({ userId, employeeId, basis: "integration setup" });
      assert.equal(link.status, 201);
    }

    await grantClientAccess({
      databaseUrl,
      userId: regionalUserId,
      objectId: CLIENT_ONE,
      grantedByUserId: admin.id,
    });

    await addRopTeamMember({
      databaseUrl,
      ropUserId,
      memberUserId: managerAUserId,
      createdByUserId: admin.id,
    });
  });

  after(async () => {
    await closePool();
  });

  it("returns role-specific presentation metadata", async () => {
    const app = await loadApp();
    const managerCookie = await login("manager-a@example.com");
    const res = await request(app).get("/api/clients/presentation").set(authHeaders(managerCookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.presentation.pageTitle, "Мои клиенты");
    assert.equal(res.body.presentation.defaultEntity, "clients");

    const regionalCookie = await login("regional@example.com");
    const regional = await request(app)
      .get("/api/clients/presentation")
      .set(authHeaders(regionalCookie));
    assert.equal(regional.body.presentation.pageTitle, "Мои торговые точки");
    assert.equal(regional.body.presentation.defaultEntity, "outlets");
  });

  it("manager sees only own clients and cannot open teams view", async () => {
    const app = await loadApp();
    const cookie = await login("manager-a@example.com");

    const own = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(own.status, 200);
    assert.equal(own.body.total, 1);
    assert.equal(own.body.items[0].guid, CLIENT_ONE);

    const teams = await request(app).get("/api/clients?view=teams").set(authHeaders(cookie));
    assert.equal(teams.status, 403);

    const teamList = await request(app).get("/api/clients/teams").set(authHeaders(cookie));
    assert.equal(teamList.status, 403);
  });

  it("regional manager sees only assigned outlet, not sibling outlet of same client", async () => {
    const app = await loadApp();
    const cookie = await login("regional@example.com");

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set(authHeaders(cookie));
    assert.equal(outlets.status, 200);
    assert.equal(outlets.body.total, 1);
    assert.equal(outlets.body.items[0].guidStore, STORE_ONE);

    const foreignClient = await request(app)
      .get(`/api/clients/${CLIENT_TWO}`)
      .set(authHeaders(cookie));
    assert.equal(foreignClient.status, 404);
  });

  it("ROP sees team members and scoped clients", async () => {
    const app = await loadApp();
    const cookie = await login("rop@example.com");

    const teams = await request(app).get("/api/clients/teams").set(authHeaders(cookie));
    assert.equal(teams.status, 200);
    assert.equal(teams.body.items.length, 1);

    const ropUser = teams.body.items[0].ropUserId;
    const managers = await request(app)
      .get(`/api/clients/teams/${ropUser}/managers`)
      .set(authHeaders(cookie));
    assert.equal(managers.status, 200);
    assert.ok(managers.body.items.some((item: { employeeGuid: string }) => item.employeeGuid === MANAGER_A));

    const clients = await request(app)
      .get(`/api/clients?view=teams&rop=${ropUser}&manager=${MANAGER_A}`)
      .set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, 1);
    assert.equal(clients.body.items[0].guid, CLIENT_ONE);
  });

  it("director sees full base and read-only review navigation", async () => {
    const app = await loadApp();
    const cookie = await login("director@example.com");

    const all = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 2);

    const review = await request(app).get("/api/clients?view=review").set(authHeaders(cookie));
    assert.equal(review.status, 200);

    const unassigned = await request(app).get("/api/clients/unassigned/summary").set(authHeaders(cookie));
    assert.equal(unassigned.status, 200);

    const writeReview = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set({ Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie })
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "n/a",
        expectedVersion: null,
      });
    assert.equal(writeReview.status, 403);
  });

  it("rejects foreign client GUID and disallowed entity modes", async () => {
    const app = await loadApp();
    const managerCookie = await login("manager-a@example.com");

    const foreign = await request(app)
      .get(`/api/clients/${CLIENT_TWO}`)
      .set(authHeaders(managerCookie));
    assert.equal(foreign.status, 404);

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set(authHeaders(managerCookie));
    assert.equal(outlets.status, 403);
  });
});
