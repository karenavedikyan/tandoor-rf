import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
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

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROP_LEADER = "44444444-4444-4444-8444-444444444444";
const ROP_OTHER = "55555555-5555-4555-8555-555555555555";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const C_DIRECT = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const C_OUTLET_ONLY = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const C_HW = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const T_DIRECT = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const T_OUTLET_ROP = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const T_HW = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";
const T_NEIGHBOR = "dddddddd-dddd-4ddd-8ddd-dddddddddd04";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
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

function clientSnapshot(input: {
  clientManager: string;
  clientRop?: string | null;
  clientHardware?: string | null;
  outlets: Array<{ store: string; rop?: string | null; manager?: string | null; hardware?: string | null }>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: input.clientHardware
      ? { guid: input.clientHardware, name: "HW", state: "directory_unverified" }
      : { guid: null, name: "", state: "not_provided" },
    headOfSales: input.clientRop
      ? { guid: input.clientRop, name: "ROP", state: "directory_unverified" }
      : { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: input.outlets.map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.store,
      holdingName: "TT",
      warehouse: false,
      address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
      loading: {},
      managers: {
        manager: outlet.manager
          ? { guid: outlet.manager, name: "Mgr", state: "directory_unverified" }
          : { guid: null, name: "", state: "unassigned" },
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: outlet.hardware
          ? { guid: outlet.hardware, name: "HW", state: "directory_unverified" }
          : { guid: null, name: "", state: "not_provided" },
        headOfSales: outlet.rop
          ? { guid: outlet.rop, name: "ROP", state: "directory_unverified" }
          : { guid: null, name: "", state: "unassigned" },
      },
      contacts: {},
      lpr: {},
    })),
  };
}

describe("clients onec team portfolio ROP scope integration", { concurrency: false }, () => {
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

    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop-leader@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP Leader",
      role: "rop",
    });

    await linkUserToEmployee({
      databaseUrl,
      userId: ropUser.id,
      employeeId: ROP_LEADER,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count) VALUES (1, $1, 4) ON CONFLICT (id) DO UPDATE SET employee_count = 4`,
      ["c".repeat(64)],
    );
    await pool.query(
      `
        INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
        VALUES
          ($1::uuid, 'Team Alpha', $2::uuid, 'Leader A'),
          ($3::uuid, 'Team Beta', $4::uuid, 'Leader B')
      `,
      [TEAM_A, ROP_LEADER, TEAM_B, ROP_OTHER],
    );
    for (const [guid, name] of [
      [M1, "Manager One"],
      [M2, "Manager Two"],
      [ROP_LEADER, "Leader A"],
      [ROP_OTHER, "Leader B"],
    ] as const) {
      await pool.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, 'Менеджер', '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
        `,
        [guid, name],
      );
    }
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_team_memberships (guid_manager, guid_team, name_team)
        VALUES ($1::uuid, $2::uuid, 'Team Alpha'), ($3::uuid, $4::uuid, 'Team Beta')
      `,
      [M1, TEAM_A, M2, TEAM_B],
    );
    await pool.end();

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: C_DIRECT,
        name_client: "Direct ROP client",
        guid_manager: M1,
        name_manager: "Manager One",
      },
      {
        guid_client: C_OUTLET_ONLY,
        name_client: "Outlet-only parent",
        guid_manager: M1,
        name_manager: "Manager One",
      },
      {
        guid_client: C_HW,
        name_client: "Hardware client",
        guid_manager: M1,
        name_manager: "Manager One",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_DIRECT,
      clientSnapshot({
        clientManager: M1,
        clientRop: ROP_LEADER,
        outlets: [{ store: T_DIRECT, manager: M1, rop: ROP_LEADER }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_OUTLET_ONLY,
      clientSnapshot({
        clientManager: M1,
        clientRop: null,
        outlets: [{ store: T_OUTLET_ROP, manager: M1, rop: ROP_LEADER }],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_HW,
      clientSnapshot({
        clientManager: M1,
        clientRop: ROP_LEADER,
        clientHardware: M1,
        outlets: [{ store: T_HW, manager: M1, hardware: M1, rop: ROP_LEADER }],
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T_DIRECT, guid_client: C_DIRECT },
      { guid_store: T_OUTLET_ROP, guid_client: C_OUTLET_ONLY },
      { guid_store: T_HW, guid_client: C_HW },
      { guid_store: T_NEIGHBOR, guid_client: C_OUTLET_ONLY },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C_OUTLET_ONLY,
      clientSnapshot({
        clientManager: M1,
        clientRop: null,
        outlets: [
          { store: T_OUTLET_ROP, manager: M1, rop: ROP_LEADER },
          { store: T_NEIGHBOR, manager: M2, rop: ROP_OTHER },
        ],
      }),
    );
    await insertSuccessfulImportRun(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("aligns ROP member client/outlet counts with scoped portfolio lists", async () => {
    const cookie = await login("rop-leader@example.com");
    const app = await loadApp();

    const overview = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    assert.equal((overview.body.groups as unknown[]).length, 1);
    const groupA = (overview.body.groups as Array<{
      teamGuid: string;
      members: Array<{ employeeGuid: string; clientCount: number; outletCount: number }>;
    }>)[0];
    assert.equal(groupA?.teamGuid, TEAM_A);
    const memberM1 = groupA?.members.find((member) => member.employeeGuid === M1);
    assert.ok(memberM1);

    const clients = await request(app)
      .get(
        `/api/clients?view=teams&entity=clients&portfolio=clients&teamSource=onec&onecTeam=${TEAM_A}&onecPortfolioEmployee=${M1}`,
      )
      .set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    const clientGuids = (clients.body.items as Array<{ guid: string }>).map((item) => item.guid).sort();
    assert.deepEqual(clientGuids, [C_DIRECT, C_HW].sort());
    assert.equal(clients.body.total, memberM1!.clientCount);

    const outlets = await request(app)
      .get(
        `/api/clients?view=teams&entity=outlets&portfolio=outlets&teamSource=onec&onecTeam=${TEAM_A}&onecPortfolioEmployee=${M1}`,
      )
      .set(authHeaders(cookie));
    assert.equal(outlets.status, 200);
    assert.equal(outlets.body.total, memberM1!.outletCount);
    const outletGuids = (outlets.body.items as Array<{ guidStore: string }>).map((item) => item.guidStore);
    assert.deepEqual([...new Set(outletGuids)].sort(), [T_DIRECT, T_HW].sort());
    assert.ok(!outletGuids.includes(T_OUTLET_ROP));
    assert.ok(!outletGuids.includes(T_NEIGHBOR));

    const foreignTeam = await request(app)
      .get(
        `/api/clients?view=teams&entity=clients&portfolio=clients&teamSource=onec&onecTeam=${TEAM_B}&onecPortfolioEmployee=${M1}`,
      )
      .set(authHeaders(cookie));
    assert.equal(foreignTeam.status, 403);
  });
});
