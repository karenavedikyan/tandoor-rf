import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import type { Test } from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { denyClientAccess } from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertSyntheticRetailOutlets,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";
let adminUserId = "";

const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const R1 = "55555555-5555-4555-8555-555555555555";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "88888888-8888-4888-8888-888888888888";
const C_DENIED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T3 = "88888888-8888-4888-8888-888888888803";
const T_REG = "88888888-8888-4888-8888-888888888804";
const T_NO_MGR = "88888888-8888-4888-8888-888888888805";

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
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

function branchSnapshot(input: {
  clientRop?: { guid: string; name: string };
  clientManager?: { guid: string; name: string };
  clientRegional?: { guid: string; name: string };
  outlets?: Array<{
    guidStore: string;
    rop?: { guid: string; name: string };
    manager?: { guid: string; name: string; state?: string };
    regional?: { guid: string; name: string; state?: string };
  }>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: input.clientRegional
      ? {
          guid: input.clientRegional.guid,
          name: input.clientRegional.name,
          state: "directory_unverified",
        }
      : { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: input.clientRop
      ? {
          guid: input.clientRop.guid,
          name: input.clientRop.name,
          state: "directory_unverified",
        }
      : { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: false,
      address: { storeAddress: "Addr " + outlet.guidStore.slice(0, 8), deliveryAddress: "", routeDirection: "" },
      loading: {},
      managers: {
        manager: outlet.manager
          ? {
              guid: outlet.manager.guid,
              name: outlet.manager.name,
              state: outlet.manager.state ?? "directory_unverified",
            }
          : { guid: null, name: "", state: "unassigned" },
        regionalManager: outlet.regional
          ? {
              guid: outlet.regional.guid,
              name: outlet.regional.name,
              state: outlet.regional.state ?? "directory_unverified",
            }
          : { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: outlet.rop
          ? {
              guid: outlet.rop.guid,
              name: outlet.rop.name,
              state: "directory_unverified",
            }
          : { guid: null, name: "", state: "unassigned" },
      },
      contacts: {},
      lpr: {},
      additional: {},
      outletGuidStatus: "confirmed",
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      provenance: { freshness: "current", sourceSha256: "a".repeat(64), importedAt: new Date().toISOString() },
      distributionAllowed: false,
    })),
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

async function seedFixture(): Promise<void> {
  await insertSyntheticClients(databaseUrl, [
    { guid_client: C1, name_client: "Client C1", guid_manager: M1, name_manager: "Manager One" },
    { guid_client: C2, name_client: "Client C2", guid_manager: R1, name_manager: "Regional One" },
    { guid_client: C3, name_client: "Client C3", guid_manager: M2, name_manager: "Manager Two" },
    { guid_client: C_DENIED, name_client: "Client Denied", guid_manager: M1, name_manager: "Manager One" },
  ]);

  await updateClientExtendedSnapshot(
    databaseUrl,
    C1,
    branchSnapshot({
      clientRop: { guid: ROP_A, name: "ROP Alpha" },
      clientManager: { guid: M1, name: "Manager One" },
      outlets: [
        { guidStore: T1, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } },
        { guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" } },
        {
          guidStore: T_REG,
          rop: { guid: ROP_A, name: "ROP Alpha" },
          manager: { guid: M1, name: "Manager One" },
          regional: { guid: R1, name: "Regional One" },
        },
        {
          guidStore: T_NO_MGR,
          rop: { guid: ROP_A, name: "ROP Alpha" },
          manager: { guid: "", name: "", state: "unassigned" },
        },
      ],
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    C2,
    branchSnapshot({
      clientRop: { guid: ROP_B, name: "ROP Beta" },
      clientRegional: { guid: R1, name: "Regional One" },
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    C3,
    branchSnapshot({
      outlets: [{ guidStore: T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
    }),
  );
  await updateClientExtendedSnapshot(databaseUrl, C_DENIED, branchSnapshot({}));

  await insertSyntheticRetailOutlets(databaseUrl, [
    { guid_store: T1, guid_client: C1 },
    { guid_store: T2, guid_client: C1 },
    { guid_store: T_REG, guid_client: C1 },
    { guid_store: T_NO_MGR, guid_client: C1 },
    { guid_store: T3, guid_client: C3 },
  ]);
}

function listClients(app: Awaited<ReturnType<typeof loadApp>>, cookie: string, query: Record<string, string>): Test {
  return request(app)
    .get(`/api/clients?${new URLSearchParams(query).toString()}`)
    .set(authHeaders(cookie));
}

describe("clients list filters integration", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    adminUserId = (
      await createTestUser({
        databaseUrl,
        email: "admin@example.com",
        password: TEST_PASSWORD,
        fullName: "Admin User",
        role: "admin",
      })
    ).id;
    await insertSuccessfulImportRun(databaseUrl);
    await seedFixture();
  });

  after(async () => {
    await closePool();
  });

  it("A: ROP A + manager M1 returns only client C1", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      ropEmployee: ROP_A,
      manager: M1,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guid, C1);
  });

  it("B: same manager M2 under ROP B returns only ROP B outlet portfolio", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      entity: "outlets",
      ropEmployee: ROP_B,
      manager: M2,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.deepEqual(
      (res.body.items as Array<{ guidStore: string }>).map((item) => item.guidStore).sort(),
      [T1, T3].sort(),
    );
  });

  it("C: regional filter on outlets returns only the assigned store", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      entity: "outlets",
      regionalManager: R1,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guidStore, T_REG);
  });

  it("D: missing manager on outlets finds store without outlet manager", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      entity: "outlets",
      missingManager: "1",
    });
    assert.equal(res.status, 200);
    assert.ok((res.body.items as Array<{ guidStore: string }>).some((item) => item.guidStore === T_NO_MGR));
    assert.ok(!(res.body.items as Array<{ guidStore: string }>).some((item) => item.guidStore === T2));
  });

  it("E: missing ROP excludes clients with assigned ROP", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      missingRop: "1",
    });
    assert.equal(res.status, 200);
    const guids = (res.body.items as Array<{ guid: string }>).map((item) => item.guid);
    assert.ok(guids.includes(C_DENIED));
    assert.ok(!guids.includes(C1));
    assert.ok(!guids.includes(C2));
  });

  it("F: completeness queue intersects reason, search and ROP filters", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(
        `/api/clients/completeness-queue?entity=outlets&q=88888805&completenessReason=missing_manager&ropEmployee=${ROP_A}`,
      )
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guidStore, T_NO_MGR);
  });

  it("G: pagination preserves filter semantics", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const page1 = await listClients(app, cookie, {
      view: "all",
      entity: "outlets",
      ropEmployee: ROP_A,
      page: "1",
      pageSize: "2",
    });
    const page2 = await listClients(app, cookie, {
      view: "all",
      entity: "outlets",
      ropEmployee: ROP_A,
      page: "2",
      pageSize: "2",
    });
    assert.equal(page1.status, 200);
    assert.equal(page2.status, 200);
    assert.equal(page1.body.total, page2.body.total);
    const allGuids = [...page1.body.items, ...page2.body.items].map(
      (item: { guidStore: string }) => item.guidStore,
    );
    assert.ok(allGuids.every((guid) => [T2, T_REG, T_NO_MGR].includes(guid)));
    assert.equal(new Set(allGuids).size, allGuids.length);
  });

  it("H: denial excludes records and options stay scoped", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: adminUserId,
      scopeType: "client",
      objectId: C_DENIED,
      deniedByUserId: adminUserId,
    });
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const list = await listClients(app, cookie, { view: "all", missingRop: "1" });
    assert.equal(list.status, 200);
    assert.ok(!(list.body.items as Array<{ guid: string }>).some((item) => item.guid === C_DENIED));

    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    assert.ok(Array.isArray(options.body.rops));
  });

  it("rejects mutually exclusive ROP and missingRop filters", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      ropEmployee: ROP_A,
      missingRop: "1",
    });
    assert.equal(res.status, 400);
  });
});
