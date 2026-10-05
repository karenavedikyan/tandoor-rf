import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { addRopTeamMember, denyClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
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
let ropBUserId = "";

const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const M4 = "44444444-4444-4444-8444-444444444444";
const R1 = "55555555-5555-4555-8555-555555555555";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "88888888-8888-4888-8888-888888888888";
const T3 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const C3_T3 = "88888888-8888-4888-8888-888888888803";
const C3_T4 = "88888888-8888-4888-8888-888888888804";
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
      VALUES (1, $1, 7)
      ON CONFLICT (id) DO UPDATE SET employee_count = 7, source_sha256 = EXCLUDED.source_sha256
    `,
    ["b".repeat(64)],
  );
  for (const [guid, name, post] of [
    [ROP_A, "ROP Alpha", "Руководитель отдела продаж"],
    [ROP_B, "ROP Beta", "Руководитель отдела продаж"],
    [M1, "Manager One", "Менеджер"],
    [M2, "Manager Two", "Менеджер"],
    [M3, "Manager Three", "Менеджер"],
    [M4, "Manager Four", "Менеджер"],
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

async function seedBranchFixture(): Promise<void> {
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
  await insertSyntheticRetailOutlets(databaseUrl, [
    { guid_store: T1, guid_client: C1 },
    { guid_store: T2, guid_client: C1 },
  ]);
}

describe("clients org structure branch composition integration", { concurrency: false }, () => {
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
    adminUserId = admin.id;

    ropAUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop-a@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP A User",
        role: "rop",
      })
    ).id;
    ropBUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop-b@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP B User",
        role: "rop",
      })
    ).id;
    await linkUserToEmployee({
      databaseUrl,
      userId: ropAUserId,
      employeeId: ROP_A,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropBUserId,
      employeeId: ROP_B,
      confirmedByUserId: adminUserId,
    });

    await seedRoster();
    await insertSuccessfulImportRun(databaseUrl);
    await seedBranchFixture();
  });

  after(async () => {
    await closePool();
  });

  it("builds independent ROP branches with correct counts and responsibles", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);

    const ropA = overview.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_A);
    const ropB = overview.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_B);
    assert.ok(ropA);
    assert.ok(ropB);

    assert.equal(ropA.uniqueClientCount, 1, "A assigned clients");
    assert.equal(ropA.uniqueOutletCount, 1, "A assigned outlets");
    assert.equal(ropA.parentClientCount, 0, "A has no outlet-only parents");
    assert.equal(ropA.teamMemberCount, 2, "A team members M1+M3");
    assert.equal(ropA.managerCount, 2);
    assert.equal(ropA.regionalCount, 0);

    assert.equal(ropB.uniqueClientCount, 1, "B assigned clients");
    assert.equal(ropB.uniqueOutletCount, 1, "B assigned outlets");
    assert.equal(ropB.parentClientCount, 1, "B parent of outlet-only C1");
    assert.equal(ropB.teamMemberCount, 2, "B team members M2+R1");
    assert.equal(ropB.managerCount, 2, "M2 outlet + R1 client manager slot");
    assert.equal(ropB.regionalCount, 1);

    const undefinedGuids = overview.body.undefinedTeam.map((item: { employeeGuid: string }) => item.employeeGuid);
    assert.deepEqual(undefinedGuids, [M4]);

    const respA = await request(app)
      .get(`/api/clients/org-structure/${ROP_A}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(respA.status, 200);
    const respAGuids = respA.body.items.map((item: { employeeGuid: string }) => item.employeeGuid);
    assert.deepEqual(respAGuids.sort(), [M1, M3].sort());
    assert.ok(!respAGuids.includes(M2));
    assert.ok(!respAGuids.includes(R1));

    const m1 = respA.body.items.find((item: { employeeGuid: string }) => item.employeeGuid === M1);
    const m3 = respA.body.items.find((item: { employeeGuid: string }) => item.employeeGuid === M3);
    assert.equal(m1.clientCount, 1);
    assert.equal(m1.outletCount, 0);
    assert.equal(m3.clientCount, 0);
    assert.equal(m3.outletCount, 1);

    const respB = await request(app)
      .get(`/api/clients/org-structure/${ROP_B}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(respB.status, 200);
    const respBGuids = [...new Set(respB.body.items.map((item: { employeeGuid: string }) => item.employeeGuid))];
    assert.deepEqual(respBGuids.sort(), [M2, R1].sort());
    assert.ok(!respBGuids.includes(M1));
    assert.equal(respB.body.items.length, 3, "M2 manager + R1 manager + R1 regional");

    const r1Rows = respB.body.items.filter((item: { employeeGuid: string }) => item.employeeGuid === R1);
    assert.equal(r1Rows.length, 2, "R1 appears as client manager and regional");
    const r1Regional = r1Rows.find((item: { kind: string }) => item.kind === "regional");
    assert.ok(r1Regional);
    assert.equal(r1Regional.clientCount, 1);
    assert.equal(r1Regional.outletCount, 0);
  });

  it("deduplicates responsibles and excludes ROP from team member count", async () => {
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        outlets: [
          { guidStore: T1, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } },
          { guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" } },
          { guidStore: T3, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" } },
        ],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: T3, guid_client: C1 }]);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    const ropA = overview.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_A);
    assert.equal(ropA.uniqueOutletCount, 2, "two outlets under A");
    assert.equal(ropA.teamMemberCount, 2, "M3 counted once despite two outlet assignments");

    const respA = await request(app)
      .get(`/api/clients/org-structure/${ROP_A}/responsibles`)
      .set(authHeaders(cookie));
    const m3Rows = respA.body.items.filter((item: { employeeGuid: string }) => item.employeeGuid === M3);
    assert.equal(m3Rows.length, 1);
    assert.equal(m3Rows[0].outletCount, 2);
    assert.ok(!respA.body.items.some((item: { employeeGuid: string }) => item.employeeGuid === ROP_A));
  });

  it("does not count ROP own portfolio as a team member", async () => {
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
        clientManager: { guid: ROP_A, name: "ROP Alpha" },
        outlets: [
          { guidStore: T1, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } },
          { guidStore: T2, rop: { guid: ROP_A, name: "ROP Alpha" }, manager: { guid: M3, name: "Manager Three" } },
        ],
      }),
    );
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`UPDATE onec_clients SET guid_manager = $1::uuid WHERE guid_client = $2::uuid`, [ROP_A, C1]);
    await pool.end();

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    const ropA = overview.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_A);
    assert.equal(ropA.hasAssignedPortfolio, true);
    assert.equal(ropA.teamMemberCount, 1, "only M3; ROP own manager slot excluded");
    assert.ok(!overview.body.undefinedTeam.some((item: { employeeGuid: string }) => item.employeeGuid === ROP_A));
  });

  it("shows responsibles without LK accounts for admin", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const resp = await request(app)
      .get(`/api/clients/org-structure/${ROP_A}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(resp.status, 200);
    for (const guid of [M1, M3]) {
      const row = resp.body.items.find((item: { employeeGuid: string }) => item.employeeGuid === guid);
      assert.ok(row);
      assert.equal(row.hasLinkedAccount, false);
    }
  });

  it("isolates C3 outlet-only parent for ROP B without client-level ROP", async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-isolated@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Isolated",
      role: "admin",
    });
    await seedRoster();
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C3,
        name_client: "Client C3 Isolated",
        guid_manager: M1,
        name_manager: "Manager One",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({
        outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: C3_T3, guid_client: C3 }]);

    const cookie = await login("admin-isolated@example.com");
    const app = await loadApp();
    const ropB = (await request(app).get("/api/clients/org-structure").set(authHeaders(cookie))).body.rops.find(
      (item: { employeeGuid: string }) => item.employeeGuid === ROP_B,
    );
    assert.ok(ropB);
    assert.equal(ropB.uniqueClientCount, 0);
    assert.equal(ropB.uniqueOutletCount, 1);
    assert.equal(ropB.parentClientCount, 1);
  });

  it("counts parent client when outlet is assigned but client-level ROP is missing", async () => {
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C3,
        name_client: "Client C3 No ROP",
        guid_manager: M1,
        name_manager: "Manager One",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({
        outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: C3_T3, guid_client: C3 }]);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    const ropB = overview.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_B);
    assert.ok(ropB);
    assert.equal(ropB.uniqueClientCount, 1, "C2 still directly assigned to B");
    assert.equal(ropB.uniqueOutletCount, 2, "T1 and C3_T3 outlets under B");
    assert.equal(ropB.parentClientCount, 2, "C1 and C3 are outlet-only parents");
  });

  it("counts parent client when client headOfSales guid is empty string", async () => {
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C3,
        name_client: "Client C3 Empty ROP Guid",
        guid_manager: M1,
        name_manager: "Manager One",
      },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, C3, {
      ...branchSnapshot({
        outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
      }),
      headOfSales: { guid: "", name: "", state: "unassigned" },
    });
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: C3_T3, guid_client: C3 }]);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const ropB = (await request(app).get("/api/clients/org-structure").set(authHeaders(cookie))).body.rops.find(
      (item: { employeeGuid: string }) => item.employeeGuid === ROP_B,
    );
    assert.equal(ropB.parentClientCount, 2, "empty client ROP guid still yields parent count for C3");
  });

  it("deduplicates parentClientCount for multiple outlets of the same client", async () => {
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C3,
        name_client: "Client C3 Multi Outlet",
        guid_manager: M1,
        name_manager: "Manager One",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({
        outlets: [
          { guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } },
          { guidStore: C3_T4, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } },
        ],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: C3_T3, guid_client: C3 },
      { guid_store: C3_T4, guid_client: C3 },
    ]);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const ropB = (await request(app).get("/api/clients/org-structure").set(authHeaders(cookie))).body.rops.find(
      (item: { employeeGuid: string }) => item.employeeGuid === ROP_B,
    );
    assert.equal(ropB.uniqueOutletCount, 3, "T1 + two C3 outlets");
    assert.equal(ropB.parentClientCount, 2, "C1 and C3 counted once each");
  });

  it("does not count parentClient when client is also directly assigned to the ROP", async () => {
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C3,
        name_client: "Client C3 Assigned To B",
        guid_manager: M1,
        name_manager: "Manager One",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({
        clientRop: { guid: ROP_B, name: "ROP Beta" },
        outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: C3_T3, guid_client: C3 }]);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const ropB = (await request(app).get("/api/clients/org-structure").set(authHeaders(cookie))).body.rops.find(
      (item: { employeeGuid: string }) => item.employeeGuid === ROP_B,
    );
    assert.equal(ropB.uniqueClientCount, 2, "C2 and C3 directly assigned");
    assert.equal(ropB.parentClientCount, 1, "only C1 remains outlet-only parent");
  });

  it("excludes denied parent client and its outlets from parentClientCount", async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin-deny-parent@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Deny Parent",
      role: "admin",
    });
    const ropBLocal = (
      await createTestUser({
        databaseUrl,
        email: "rop-b-deny@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP B Deny",
        role: "rop",
      })
    ).id;
    const managerUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-m1-deny@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager One",
        role: "manager",
      })
    ).id;
    await linkUserToEmployee({
      databaseUrl,
      userId: ropBLocal,
      employeeId: ROP_B,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUserId,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await addRopTeamMember({
      databaseUrl,
      ropUserId: ropBLocal,
      memberUserId: managerUserId,
      createdByUserId: admin.id,
    });

    await seedRoster();
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C3,
        name_client: "Client C3 Denied Parent",
        guid_manager: M1,
        name_manager: "Manager One",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      branchSnapshot({
        outlets: [{ guidStore: C3_T3, rop: { guid: ROP_B, name: "ROP Beta" }, manager: { guid: M2, name: "Manager Two" } }],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [{ guid_store: C3_T3, guid_client: C3 }]);

    const app = await loadApp();
    const beforeCookie = (
      await request(app)
        .post("/api/auth/login")
        .set(authHeaders())
        .send({ email: "rop-b-deny@example.com", password: TEST_PASSWORD })
    ).headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const before = await request(app).get("/api/clients/org-structure").set(authHeaders(beforeCookie));
    assert.equal(before.body.rops[0].parentClientCount, 1);

    await denyClientAccess({
      databaseUrl,
      userId: ropBLocal,
      scopeType: "client",
      objectId: C3,
      deniedByUserId: admin.id,
    });
    await resetPoolForTests();
    const appAfter = await loadApp();
    const afterCookie = (
      await request(appAfter)
        .post("/api/auth/login")
        .set(authHeaders())
        .send({ email: "rop-b-deny@example.com", password: TEST_PASSWORD })
    ).headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const after = await request(appAfter).get("/api/clients/org-structure").set(authHeaders(afterCookie));
    assert.equal(after.status, 200);
    const ropB = after.body.rops[0];
    assert.equal(ropB.uniqueClientCount, 0);
    assert.equal(ropB.uniqueOutletCount, 0);
    assert.equal(ropB.parentClientCount, 0);
  });

  it("excludes denied client and its outlets from scoped ROP branch", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: ropAUserId,
      scopeType: "client",
      objectId: C1,
      deniedByUserId: adminUserId,
    });

    const cookie = await login("rop-a@example.com");
    const app = await loadApp();
    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    const ropA = overview.body.rops[0];
    assert.equal(ropA.uniqueClientCount, 0);
    assert.equal(ropA.uniqueOutletCount, 0);
    assert.equal(ropA.parentClientCount, 0);
    assert.equal(ropA.teamMemberCount, 0);

    const resp = await request(app)
      .get(`/api/clients/org-structure/${ROP_A}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(resp.status, 200);
    assert.equal(resp.body.items.length, 0);
  });
});
