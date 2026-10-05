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
let regionalUserId = "";

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const REGIONAL_EMPLOYEE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_REGIONAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const CLIENT_ZERO = "10101010-1010-4101-8101-101010101010";
const CLIENT_TWO = "11111111-1111-4111-8111-111111111111";
const CLIENT_TEN = "12121212-1212-4121-8121-121212121212";

const STORE_TWO_A = "21111111-1111-4111-8111-111111111111";
const STORE_TWO_B = "22222222-2222-4222-8222-222222222222";
const STORE_TEN_PREFIX = "30000000-0000-4000-8000-0000000000";

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

function buildOutletSnapshot(input: {
  guidStore: string;
  storeAddress: string;
  regionalGuid: string;
  warehouse?: boolean | null;
  statusTandoorClub?: string;
  closed?: boolean;
}) {
  return {
    ordinal: 0,
    guidStore: input.guidStore,
    holdingName: "Holding",
    warehouse: input.warehouse ?? null,
    outletGuidStatus: "confirmed",
    closed: input.closed ?? false,
    closureStatus: input.closed ? "closed" : "open",
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
      manager: { guid: MANAGER_A, name: "Manager", state: "directory_unverified" },
      regionalManager: {
        guid: input.regionalGuid,
        name: "Regional " + input.regionalGuid.slice(0, 8),
        state: "directory_unverified",
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
    additional: { statusTandoorClub: input.statusTandoorClub ?? "Active", bonusTandoorClub: "" },
    provenance: {
      freshness: "current",
      sourceSha256: "a".repeat(64),
      importedAt: "2026-01-01T10:00:00.000Z",
    },
    distributionAllowed: false,
  };
}

describe("clients list sort and scoped counts integration", { concurrency: false }, () => {
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

    regionalUserId = (
      await createTestUser({
        databaseUrl,
        email: "regional@example.com",
        password: TEST_PASSWORD,
        fullName: "Regional User",
        role: "regional_manager",
      })
    ).id;

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ZERO,
        name_client: "Zero Outlets Client",
        guid_manager: MANAGER_A,
        name_manager: "Manager Ivanov",
        address: "City Zero",
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Two Outlets Client",
        guid_manager: MANAGER_A,
        name_manager: "Manager Ivanov",
        address: "City Two",
      },
      {
        guid_client: CLIENT_TEN,
        name_client: "Ten Outlets Client",
        guid_manager: MANAGER_B,
        name_manager: "Manager Petrov",
        address: "City Ten",
      },
    ]);

    const twoOutlets = [
      { guid_store: STORE_TWO_A, guid_client: CLIENT_TWO, is_closed: false },
      { guid_store: STORE_TWO_B, guid_client: CLIENT_TWO, is_closed: false },
    ];
    const tenOutlets = Array.from({ length: 10 }, (_, index) => ({
      guid_store: `${STORE_TEN_PREFIX}${String(index).padStart(2, "0")}`,
      guid_client: CLIENT_TEN,
      is_closed: false,
    }));
    await insertSyntheticRetailOutlets(databaseUrl, [...twoOutlets, ...tenOutlets]);

    const emptyManagerRef = { guid: null, name: "", state: "not_provided" as const };
    await updateClientExtendedSnapshot(databaseUrl, CLIENT_TWO, {
      regionalManager: emptyManagerRef,
      hardwareManager: emptyManagerRef,
      headOfSales: emptyManagerRef,
      currentRetailOutlets: [
        buildOutletSnapshot({
          guidStore: STORE_TWO_A,
          storeAddress: "Alpha Store Address",
          regionalGuid: REGIONAL_EMPLOYEE,
          warehouse: true,
          statusTandoorClub: "Gold",
        }),
        buildOutletSnapshot({
          guidStore: STORE_TWO_B,
          storeAddress: "Beta Store Address",
          regionalGuid: OTHER_REGIONAL,
          warehouse: false,
          statusTandoorClub: "Silver",
        }),
      ],
    });

    await updateClientExtendedSnapshot(databaseUrl, CLIENT_TEN, {
      regionalManager: emptyManagerRef,
      hardwareManager: emptyManagerRef,
      headOfSales: emptyManagerRef,
      currentRetailOutlets: tenOutlets.map((outlet, index) =>
        buildOutletSnapshot({
          guidStore: outlet.guid_store,
          storeAddress: `Ten Store ${String(index).padStart(2, "0")}`,
          regionalGuid: REGIONAL_EMPLOYEE,
          warehouse: index % 2 === 0,
        }),
      ),
    });

    await insertSuccessfulImportRun(databaseUrl, { recordCount: 3 });

    await linkUserToEmployee({
      databaseUrl,
      userId: regionalUserId,
      employeeId: REGIONAL_EMPLOYEE,
      confirmedByUserId: admin.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: regionalUserId,
      objectId: CLIENT_TWO,
      grantedByUserId: admin.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: regionalUserId,
      objectId: CLIENT_TEN,
      grantedByUserId: admin.id,
    });
  });

  after(async () => {
    await closePool();
  });

  it("sorts clients by scoped outletsCount ASC and DESC for admin", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");

    const asc = await request(app)
      .get("/api/clients?sortBy=outletsCount&sortDir=asc&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(asc.status, 200, asc.body?.error?.message ?? JSON.stringify(asc.body));
    const ascCounts = asc.body.items.map((item: { outletsCount: number }) => item.outletsCount);
    assert.deepEqual(ascCounts, [0, 2, 10]);

    const desc = await request(app)
      .get("/api/clients?sortBy=outletsCount&sortDir=desc&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(desc.status, 200);
    const descCounts = desc.body.items.map((item: { outletsCount: number }) => item.outletsCount);
    assert.deepEqual(descCounts, [10, 2, 0]);
  });

  it("regional scoped outletsCount matches visible outlet rows", async () => {
    const app = await loadApp();
    const regionalCookie = await login("regional@example.com");

    const clients = await request(app)
      .get("/api/clients?entity=clients&pageSize=50")
      .set(authHeaders(regionalCookie));
    assert.equal(clients.status, 200);
    const twoClient = clients.body.items.find((item: { guid: string }) => item.guid === CLIENT_TWO);
    assert.ok(twoClient);
    assert.equal(twoClient.outletsCount, 1);

    const outlets = await request(app)
      .get("/api/clients?entity=outlets&pageSize=50")
      .set(authHeaders(regionalCookie));
    assert.equal(outlets.status, 200);
    const twoOutlets = outlets.body.items.filter((item: { guidClient: string }) => item.guidClient === CLIENT_TWO);
    assert.equal(twoOutlets.length, 1);
    assert.equal(twoOutlets[0].guidStore, STORE_TWO_A);
  });

  it("sorts outlets by store address without SQL alias errors", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");

    const asc = await request(app)
      .get("/api/clients?entity=outlets&sortBy=address&sortDir=asc&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(asc.status, 200, asc.body?.error?.message ?? JSON.stringify(asc.body));
    const ascAddresses = asc.body.items.map((item: { address: string }) => item.address);
    assert.ok(ascAddresses.indexOf("Alpha Store Address") < ascAddresses.indexOf("Beta Store Address"));

    const desc = await request(app)
      .get("/api/clients?entity=outlets&sortBy=address&sortDir=desc&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(desc.status, 200);
    const descAddresses = desc.body.items.map((item: { address: string }) => item.address);
    assert.ok(descAddresses.indexOf("Beta Store Address") < descAddresses.indexOf("Alpha Store Address"));
  });

  it("rejects incompatible sortBy for outlets entity", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");
    const res = await request(app)
      .get("/api/clients?entity=outlets&sortBy=name&sortDir=desc")
      .set(authHeaders(adminCookie));
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /сортиров/i);
  });

  it("filters outlets by status, warehouse, regional and tandoor club", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");

    const warehouseYes = await request(app)
      .get("/api/clients?entity=outlets&warehouse=yes&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(warehouseYes.status, 200);
    assert.ok(
      warehouseYes.body.items.every((item: { warehouse: { value: boolean | null } }) => item.warehouse.value === true),
    );
    assert.ok(warehouseYes.body.items.some((item: { guidStore: string }) => item.guidStore === STORE_TWO_A));

    const regionalFilter = await request(app)
      .get(`/api/clients?entity=outlets&regionalManager=${OTHER_REGIONAL}&pageSize=50`)
      .set(authHeaders(adminCookie));
    assert.equal(regionalFilter.status, 200);
    assert.equal(regionalFilter.body.total, 1);
    assert.equal(regionalFilter.body.items[0].guidStore, STORE_TWO_B);

    const tandoor = await request(app)
      .get("/api/clients?entity=outlets&tandoorClub=Gold&pageSize=50")
      .set(authHeaders(adminCookie));
    assert.equal(tandoor.status, 200);
    assert.equal(tandoor.body.total, 1);
    assert.equal(tandoor.body.items[0].guidStore, STORE_TWO_A);
    assert.equal(tandoor.body.items[0].tandoorClub.value, "Gold");
  });

  it("returns regional managers in scoped options", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");
    const options = await request(app).get("/api/clients/options").set(authHeaders(adminCookie));
    assert.equal(options.status, 200);
    assert.ok(Array.isArray(options.body.regionalManagers));
    const ids = options.body.regionalManagers.map((item: { id: string }) => item.id.toLowerCase());
    assert.ok(ids.includes(REGIONAL_EMPLOYEE));
    assert.ok(ids.includes(OTHER_REGIONAL));
  });
});
