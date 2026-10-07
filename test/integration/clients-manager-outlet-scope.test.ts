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
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "55555555-5555-4555-8555-555555555555";
const REGIONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C1 = "11111111-1111-4111-8111-111111111111";
const C_GRANT = "33333333-3333-4333-8333-333333333333";
const T1 = "44444444-4444-4444-8444-444444444444";
const T2 = "55555555-5555-5555-8555-555555555555";
const T_GRANT = "66666666-6666-4666-8666-666666666666";

function buildOutlet(input: {
  ordinal: number;
  guidStore: string;
  storeAddress: string;
  managerGuid: string;
  regionalGuid?: string;
}) {
  return {
    ordinal: input.ordinal,
    guidStore: input.guidStore,
    holdingName: "Holding",
    warehouse: null,
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    closureConfirmedInCurrentExport: true,
    closureHistory: [],
    address: {
      storeAddress: input.storeAddress,
      deliveryAddress: "",
      routeDirection: "",
    },
    loading: {
      loadingOnMonday: null,
      loadingOnTuesday: null,
      loadingOnWednesday: null,
      loadingOnThursday: null,
      loadingOnFriday: null,
      loadingOnSaturday: null,
      loadingOnSunday: null,
      loadingTime: null,
    },
    managers: {
      manager: { guid: input.managerGuid, name: "Manager", state: "directory_unverified" },
      regionalManager: {
        guid: input.regionalGuid ?? null,
        name: input.regionalGuid ? "Regional" : "",
        state: input.regionalGuid ? "directory_unverified" : "not_provided",
      },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: null, name: "", state: "not_provided" },
    },
    contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
    lpr: {
      name: "",
      post: "",
      dateOfBirth: null,
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
    },
    additional: { statusTandoorClub: "", bonusTandoorClub: "" },
    provenance: {
      freshness: "current",
      sourceSha256: "a".repeat(64),
      importedAt: "2026-01-01T10:00:00.000Z",
    },
    distributionAllowed: false,
  };
}

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

describe("manager outlet assignment scope integration", { concurrency: false }, () => {
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

    const m1UserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-m1@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager M1",
        role: "manager",
      })
    ).id;
    const m2UserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-m2@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager M2",
        role: "manager",
      })
    ).id;
    const regionalUserId = (
      await createTestUser({
        databaseUrl,
        email: "regional-grant@example.com",
        password: TEST_PASSWORD,
        fullName: "Regional Grant",
        role: "regional_manager",
      })
    ).id;

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C1,
        name_client: "Client C1",
        guid_manager: M1,
        name_manager: "Manager M1",
        address: "Moscow",
        telephone: [],
      },
      {
        guid_client: C_GRANT,
        name_client: "Grant Client",
        guid_manager: M2,
        name_manager: "Manager M2",
        address: "Kazan",
        telephone: [],
      },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1, is_closed: false },
      { guid_store: T2, guid_client: C1, is_closed: false },
      { guid_store: T_GRANT, guid_client: C_GRANT, is_closed: false },
    ]);

    const emptyRef = { guid: null, name: "", state: "not_provided" as const };
    await updateClientExtendedSnapshot(databaseUrl, C1, {
      regionalManager: emptyRef,
      hardwareManager: emptyRef,
      headOfSales: emptyRef,
      currentRetailOutlets: [
        buildOutlet({
          ordinal: 1,
          guidStore: T1,
          storeAddress: "TT1 address",
          managerGuid: M1,
        }),
        buildOutlet({
          ordinal: 2,
          guidStore: T2,
          storeAddress: "TT2 address",
          managerGuid: M2,
        }),
      ],
    });
    await updateClientExtendedSnapshot(databaseUrl, C_GRANT, {
      regionalManager: emptyRef,
      hardwareManager: emptyRef,
      headOfSales: emptyRef,
      currentRetailOutlets: [
        buildOutlet({
          ordinal: 1,
          guidStore: T_GRANT,
          storeAddress: "Grant outlet",
          managerGuid: M2,
          regionalGuid: REGIONAL,
        }),
      ],
    });
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 2 });

    await linkUserToEmployee({
      databaseUrl,
      userId: m1UserId,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: m2UserId,
      employeeId: M2,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: regionalUserId,
      employeeId: REGIONAL,
      confirmedByUserId: admin.id,
    });

    await grantClientAccess({
      databaseUrl,
      userId: regionalUserId,
      objectId: C_GRANT,
      grantedByUserId: admin.id,
    });
  });

  after(async () => {
    await closePool();
  });

  it("M1 sees C1 with only TT1 in list, card and outlets total", async () => {
    const app = await loadApp();
    const cookie = await login("manager-m1@example.com");

    const clients = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, 1);
    assert.equal(clients.body.items[0].guid, C1);
    assert.equal(clients.body.items[0].outletsCount, 1);

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set(authHeaders(cookie));
    assert.equal(outlets.status, 200);
    assert.equal(outlets.body.total, 1);
    assert.equal(outlets.body.items[0].guidStore, T1);

    const card = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(card.status, 200);
    assert.equal(card.body.client.extended.retailOutlets.length, 1);
    assert.equal(card.body.client.extended.retailOutlets[0].guidStore, T1);
  });

  it("M2 sees TT2 and parent C1 without TT1 and without extra grants", async () => {
    const app = await loadApp();
    const cookie = await login("manager-m2@example.com");

    const clients = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.ok(clients.body.items.some((item: { guid: string }) => item.guid === C1));
    const c1Row = clients.body.items.find((item: { guid: string }) => item.guid === C1);
    assert.equal(c1Row.outletsCount, 1);

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set(authHeaders(cookie));
    assert.equal(outlets.status, 200);
    const outletGuids = outlets.body.items.map((item: { guidStore: string }) => item.guidStore);
    assert.ok(outletGuids.includes(T2));
    assert.ok(!outletGuids.includes(T1));

    const card = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(card.status, 200);
    assert.equal(card.body.client.extended.retailOutlets.length, 1);
    assert.equal(card.body.client.extended.retailOutlets[0].guidStore, T2);
  });

  it("regional grant access stays independent of manager outlet scope", async () => {
    const app = await loadApp();
    const cookie = await login("regional-grant@example.com");

    const clients = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, 1);
    assert.equal(clients.body.items[0].guid, C_GRANT);

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set(authHeaders(cookie));
    assert.equal(outlets.status, 200);
    assert.equal(outlets.body.total, 1);
    assert.equal(outlets.body.items[0].guidStore, T_GRANT);
    assert.ok(!outlets.body.items.some((item: { guidClient: string }) => item.guidClient === C1));
  });
});
