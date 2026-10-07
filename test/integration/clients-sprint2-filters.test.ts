import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import type { Test } from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
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

const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const R1 = "55555555-5555-4555-8555-555555555555";
const H1 = "77777777-7777-4777-8777-777777777777";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T_WH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";

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
  clientRegional?: { guid: string; name: string };
  clientHardware?: { guid: string; name: string };
  outlets?: Array<{
    guidStore: string;
    warehouse?: boolean;
    regional?: { guid: string; name: string };
    hardware?: { guid: string; name: string };
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
    hardwareManager: input.clientHardware
      ? {
          guid: input.clientHardware.guid,
          name: input.clientHardware.name,
          state: "directory_unverified",
        }
      : { guid: null, name: "", state: "not_provided" },
    headOfSales: { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: outlet.warehouse ?? false,
      address: { storeAddress: "Addr " + outlet.guidStore.slice(0, 8), deliveryAddress: "", routeDirection: "" },
      loading: {},
      managers: {
        manager: { guid: M1, name: "Manager One", state: "directory_unverified" },
        regionalManager: outlet.regional
          ? {
              guid: outlet.regional.guid,
              name: outlet.regional.name,
              state: "directory_unverified",
            }
          : { guid: null, name: "", state: "not_provided" },
        hardwareManager: outlet.hardware
          ? {
              guid: outlet.hardware.guid,
              name: outlet.hardware.name,
              state: "directory_unverified",
            }
          : { guid: null, name: "", state: "not_provided" },
        headOfSales: { guid: ROP_A, name: "ROP Alpha", state: "directory_unverified" },
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
    { guid_client: C2, name_client: "Client C2", guid_manager: M2, name_manager: "Manager Two" },
  ]);

  await updateClientExtendedSnapshot(
    databaseUrl,
    C1,
    branchSnapshot({
      clientHardware: { guid: H1, name: "Hardware Lead" },
      outlets: [
        { guidStore: T1, warehouse: false },
        { guidStore: T2, warehouse: true, regional: { guid: R1, name: "Regional One" } },
        { guidStore: T_WH, warehouse: true, hardware: { guid: H1, name: "Hardware Lead" } },
      ],
    }),
  );
  const c2Snapshot = branchSnapshot({
    clientRegional: { guid: R1, name: "Regional One" },
  });
  c2Snapshot.hardwareManager = { guid: null, name: "", state: "unassigned" };
  await updateClientExtendedSnapshot(databaseUrl, C2, c2Snapshot);

  await insertSyntheticRetailOutlets(databaseUrl, [
    { guid_store: T1, guid_client: C1 },
    { guid_store: T2, guid_client: C1 },
    { guid_store: T_WH, guid_client: C1 },
  ]);
}

function listClients(app: Awaited<ReturnType<typeof loadApp>>, cookie: string, query: Record<string, string>): Test {
  return request(app)
    .get(`/api/clients?${new URLSearchParams(query).toString()}`)
    .set(authHeaders(cookie));
}

describe("clients sprint2 filters integration", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    await insertSuccessfulImportRun(databaseUrl);
    await seedFixture();
  });

  after(async () => {
    await closePool();
  });

  it("I: client-level hardware filter matches extended snapshot", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      entity: "clients",
      hardwareManager: H1,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guid, C1);
  });

  it("J: client-level regional filter matches extended snapshot", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      entity: "clients",
      regionalManager: R1,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guid, C2);
  });

  it("K: client list outlet filters require one matching outlet (same-outlet AND)", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      entity: "clients",
      warehouse: "yes",
      outletStatus: "open",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guid, C1);
  });

  it("L: total is computed before pagination", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const page1 = await listClients(app, cookie, {
      view: "all",
      entity: "outlets",
      page: "1",
      pageSize: "1",
    });
    const page2 = await listClients(app, cookie, {
      view: "all",
      entity: "outlets",
      page: "2",
      pageSize: "1",
    });
    assert.equal(page1.status, 200);
    assert.equal(page2.status, 200);
    assert.equal(page1.body.total, 3);
    assert.equal(page1.body.total, page2.body.total);
    assert.notEqual(page1.body.items[0].guidStore, page2.body.items[0].guidStore);
  });

  it("M: missingHardware excludes clients with assigned hardware manager", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      entity: "clients",
      missingHardware: "1",
    });
    assert.equal(res.status, 200);
    const guids = (res.body.items as Array<{ guid: string }>).map((item) => item.guid);
    assert.ok(guids.includes(C2));
    assert.ok(!guids.includes(C1));
  });

  it("rejects hardwareManager and missingHardware together", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "all",
      hardwareManager: H1,
      missingHardware: "1",
    });
    assert.equal(res.status, 400);
  });
});
