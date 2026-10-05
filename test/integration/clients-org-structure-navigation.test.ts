import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import type { Test } from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { denyClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
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
let ropAUserId = "";

const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const R1 = "55555555-5555-4555-8555-555555555555";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "88888888-8888-4888-8888-888888888888";
const C3_T3 = "88888888-8888-4888-8888-888888888803";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
    manager?: { guid: string; name: string };
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
      address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
      loading: {},
      managers: {
        manager: outlet.manager
          ? {
              guid: outlet.manager.guid,
              name: outlet.manager.name,
              state: "directory_unverified",
            }
          : { guid: null, name: "", state: "unassigned" },
        regionalManager: { guid: null, name: "", state: "not_provided" },
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

async function seedRoster(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
      VALUES (1, $1, 6)
      ON CONFLICT (id) DO UPDATE SET employee_count = 6, source_sha256 = EXCLUDED.source_sha256
    `,
    ["b".repeat(64)],
  );
  for (const [guid, name, post] of [
    [ROP_A, "ROP Alpha", "Руководитель отдела продаж"],
    [ROP_B, "ROP Beta", "Руководитель отдела продаж"],
    [M1, "Manager One", "Менеджер"],
    [M2, "Manager Two", "Менеджер"],
    [M3, "Manager Three", "Менеджер"],
    [R1, "Regional One", "Региональный менеджер"],
  ] as const) {
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
        VALUES ($1::uuid, $2, $3, '{}'::jsonb)
        ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post
      `,
      [guid, name, post],
    );
  }
  await pool.end();
}

async function seedNavigationFixture(): Promise<void> {
  await insertSyntheticClients(databaseUrl, [
    {
      guid_client: C1,
      name_client: "Client C1",
      guid_manager: M1,
      name_manager: "Manager One",
    },
    {
      guid_client: C2,
      name_client: "Client C2",
      guid_manager: R1,
      name_manager: "Regional One",
    },
    {
      guid_client: C3,
      name_client: "Client C3",
      guid_manager: M2,
      name_manager: "Manager Two",
    },
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
      outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
    }),
  );
  await insertSyntheticRetailOutlets(databaseUrl, [
    { guid_store: T1, guid_client: C1 },
    { guid_store: T2, guid_client: C1 },
    { guid_store: C3_T3, guid_client: C3 },
  ]);
}

function listClients(app: Awaited<ReturnType<typeof loadApp>>, cookie: string, query: Record<string, string>): Test {
  const params = new URLSearchParams(query);
  return request(app).get(`/api/clients?${params.toString()}`).set(authHeaders(cookie));
}

describe("clients org structure navigation integration", { concurrency: false }, () => {
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
    ropAUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop-a-nav@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP A Nav",
        role: "rop",
      })
    ).id;
    await linkUserToEmployee({
      databaseUrl,
      userId: ropAUserId,
      employeeId: ROP_A,
      confirmedByUserId: adminUserId,
    });

    await seedRoster();
    await insertSuccessfulImportRun(databaseUrl);
    await seedNavigationFixture();
  });

  after(async () => {
    await closePool();
  });

  it("lists client-level ROP A portfolio without outlet-only parents", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "teams",
      ropEmployee: ROP_A,
      portfolio: "clients",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.deepEqual(
      (res.body.items as Array<{ guid: string }>).map((item) => item.guid),
      [C1],
    );
  });

  it("lists outlet-level ROP A portfolio without client-level-only assignments", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "teams",
      entity: "outlets",
      ropEmployee: ROP_A,
      portfolio: "outlets",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.deepEqual(
      (res.body.items as Array<{ guidStore: string }>).map((item) => item.guidStore),
      [T2],
    );
  });

  it("lists client-level ROP B portfolio without outlet-only parents", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "teams",
      ropEmployee: ROP_B,
      portfolio: "clients",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.deepEqual(
      (res.body.items as Array<{ guid: string }>).map((item) => item.guid),
      [C2],
    );
  });

  it("lists outlet-level ROP B portfolio including outlet-only parent stores", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "teams",
      entity: "outlets",
      ropEmployee: ROP_B,
      portfolio: "outlets",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.deepEqual(
      (res.body.items as Array<{ guidStore: string }>).map((item) => item.guidStore).sort(),
      [T1, C3_T3].sort(),
    );
  });

  it("filters regional responsible by regional assignment field, not manager slot", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();

    const regional = await listClients(app, cookie, {
      view: "teams",
      ropEmployee: ROP_B,
      regionalManager: R1,
      responsibleKind: "regional",
    });
    assert.equal(regional.status, 200);
    assert.equal(regional.body.total, 1);
    assert.deepEqual(
      (regional.body.items as Array<{ guid: string }>).map((item) => item.guid),
      [C2],
    );

    const managerSlot = await listClients(app, cookie, {
      view: "teams",
      ropEmployee: ROP_B,
      manager: R1,
      responsibleKind: "manager",
    });
    assert.equal(managerSlot.status, 200);
    assert.equal(managerSlot.body.total, 1);
    assert.deepEqual(
      (managerSlot.body.items as Array<{ guid: string }>).map((item) => item.guid),
      [C2],
    );
  });

  it("keeps shared manager outlet portfolios separate per ROP branch", async () => {
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: M1, name: "Manager One" },
        outlets: [
          { guidStore: T1, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M3, name: "Manager Three" } },
          { guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" } },
        ],
      }),
    );

    const cookie = await login("admin@example.com");
    const app = await loadApp();

    const branchA = await listClients(app, cookie, {
      view: "teams",
      entity: "outlets",
      ropEmployee: ROP_A,
      manager: M3,
      responsibleKind: "manager",
    });
    assert.equal(branchA.status, 200);
    assert.equal(branchA.body.total, 1);
    assert.deepEqual(
      (branchA.body.items as Array<{ guidStore: string }>).map((item) => item.guidStore),
      [T2],
    );

    const branchB = await listClients(app, cookie, {
      view: "teams",
      entity: "outlets",
      ropEmployee: ROP_B,
      manager: M3,
      responsibleKind: "manager",
    });
    assert.equal(branchB.status, 200);
    assert.equal(branchB.body.total, 1);
    assert.deepEqual(
      (branchB.body.items as Array<{ guidStore: string }>).map((item) => item.guidStore),
      [T1],
    );
  });

  it("excludes denied client from org-structure counters and branch list", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: ropAUserId,
      scopeType: "client",
      objectId: C1,
      deniedByUserId: adminUserId,
    });

    const cookie = await login("rop-a-nav@example.com");
    const app = await loadApp();

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    const ropA = overview.body.rops[0];
    assert.equal(ropA.uniqueClientCount, 0);
    assert.equal(ropA.uniqueOutletCount, 0);
    assert.equal(ropA.parentClientCount, 0);

    const list = await listClients(app, cookie, {
      view: "teams",
      ropEmployee: ROP_A,
      portfolio: "clients",
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);
  });

  it("rejects foreign ropEmployee branch for scoped ROP session", async () => {
    const cookie = await login("rop-a-nav@example.com");
    const app = await loadApp();
    const res = await listClients(app, cookie, {
      view: "teams",
      ropEmployee: ROP_B,
      portfolio: "clients",
    });
    assert.equal(res.status, 403);
  });

  it("matches org-structure client counter with branch portfolio list total", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    const ropB = overview.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_B);

    const clients = await listClients(app, cookie, {
      view: "teams",
      ropEmployee: ROP_B,
      portfolio: "clients",
    });
    const outlets = await listClients(app, cookie, {
      view: "teams",
      entity: "outlets",
      ropEmployee: ROP_B,
      portfolio: "outlets",
    });

    assert.equal(clients.body.total, ropB.uniqueClientCount);
    assert.equal(outlets.body.total, ropB.uniqueOutletCount);
  });
});
