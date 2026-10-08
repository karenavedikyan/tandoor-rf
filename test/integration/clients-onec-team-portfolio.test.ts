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
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const LEADER_A = "44444444-4444-4444-8444-444444444444";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const C2 = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const C3 = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const T1 = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const T3 = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";

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

async function upsertRoster(input: {
  guid: string;
  name: string;
  teamGuid?: string | null;
  teamName?: string | null;
}): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, guid_team, name_team, raw_json)
      VALUES ($1::uuid, $2, 'Менеджер', $3::uuid, $4, '{}'::jsonb)
      ON CONFLICT (guid_manager) DO UPDATE SET
        name_manager = EXCLUDED.name_manager,
        guid_team = EXCLUDED.guid_team,
        name_team = EXCLUDED.name_team
    `,
    [input.guid, input.name, input.teamGuid ?? null, input.teamName ?? null],
  );
  await pool.end();
}

async function upsertMembership(managerGuid: string, teamGuid: string, teamName: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_wholesale_employee_team_memberships (guid_manager, guid_team, name_team)
      VALUES ($1::uuid, $2::uuid, $3)
      ON CONFLICT (guid_manager, guid_team) DO UPDATE SET name_team = EXCLUDED.name_team
    `,
    [managerGuid, teamGuid, teamName],
  );
  await pool.end();
}

function outletSnapshot(managerGuid: string, storeGuid: string) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: [
      {
        ordinal: 0,
        guidStore: storeGuid,
        holdingName: "TT",
        warehouse: false,
        address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
        loading: {},
        managers: {
          manager: {
            guid: managerGuid,
            name: "Mgr",
            state: "directory_unverified",
          },
          regionalManager: { guid: null, name: "", state: "not_provided" },
          hardwareManager: { guid: null, name: "", state: "not_provided" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
        },
        contacts: {},
        lpr: {},
      },
    ],
  };
}

describe("clients onec team portfolio integration", { concurrency: false }, () => {
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

    await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director User",
      role: "director",
    });

    await linkUserToEmployee({
      databaseUrl,
      userId: admin.id,
      employeeId: LEADER_A,
      confirmedByUserId: admin.id,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count) VALUES (1, $1, 3) ON CONFLICT (id) DO UPDATE SET employee_count = 3`,
      ["c".repeat(64)],
    );
    await pool.query(
      `
        INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
        VALUES ($1::uuid, 'Team Alpha', $2::uuid, 'Leader A')
      `,
      [TEAM_A, LEADER_A],
    );
    await pool.end();

    await upsertRoster({ guid: M1, name: "Manager One", teamGuid: TEAM_A, teamName: "Team Alpha" });
    await upsertRoster({ guid: M2, name: "Manager Two", teamGuid: TEAM_B, teamName: "Team Beta" });
    await upsertRoster({ guid: LEADER_A, name: "Leader A" });
    await upsertMembership(M1, TEAM_A, "Team Alpha");
    await upsertMembership(M2, TEAM_B, "Team Beta");

    await insertSyntheticClients(databaseUrl, [
      { guidClient: C1, nameClient: "Client M1", guidManager: M1 },
      { guidClient: C2, nameClient: "Client M2", guidManager: M2 },
      { guidClient: C3, nameClient: "Client M1 parent TT M2", guidManager: M1 },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guidStore: T1, guidClient: C1, nameStore: "T1" },
      { guidStore: T2, guidClient: C2, nameStore: "T2" },
      { guidStore: T3, guidClient: C3, nameStore: "T3 hidden slot" },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, C3, outletSnapshot(M2, T3));
    await insertSuccessfulImportRun(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("scopes group client list to team members only", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const teamA = await request(app)
      .get(
        `/api/clients?view=teams&entity=clients&portfolio=clients&teamSource=onec&onecTeam=${TEAM_A}`,
      )
      .set(authHeaders(cookie));
    assert.equal(teamA.status, 200);
    const teamAClients = (teamA.body.items as Array<{ guidClient: string }>).map((item) => item.guidClient);
    assert.deepEqual([...teamAClients].sort(), [C1, C3].sort());
    assert.ok(!teamAClients.includes(C2));

    const teamB = await request(app)
      .get(
        `/api/clients?view=teams&entity=clients&portfolio=clients&teamSource=onec&onecTeam=${TEAM_B}`,
      )
      .set(authHeaders(cookie));
    assert.equal(teamB.status, 200);
    const teamBClients = (teamB.body.items as Array<{ guidClient: string }>).map((item) => item.guidClient);
    assert.deepEqual(teamBClients, [C2]);
  });

  it("matches org-structure counters with scoped team portfolio lists", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const overview = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    const groupA = (overview.body.allGroups as Array<{ teamGuid: string; uniqueClientCount: number; uniqueOutletCount: number }>).find(
      (group) => group.teamGuid === TEAM_A,
    );
    assert.ok(groupA);

    const clients = await request(app)
      .get(
        `/api/clients?view=teams&entity=clients&portfolio=clients&teamSource=onec&onecTeam=${TEAM_A}`,
      )
      .set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, groupA!.uniqueClientCount);

    const outlets = await request(app)
      .get(
        `/api/clients?view=teams&entity=outlets&portfolio=outlets&teamSource=onec&onecTeam=${TEAM_A}`,
      )
      .set(authHeaders(cookie));
    assert.equal(outlets.status, 200);
    assert.equal(outlets.body.total, groupA!.uniqueOutletCount);
    assert.ok((outlets.body.items as Array<{ guidStore: string }>).some((item) => item.guidStore === T3));
    assert.ok(!(outlets.body.items as Array<{ guidStore: string }>).some((item) => item.guidStore === T2));
  });

  it("does not expand portfolio when onecTeam guid is swapped without membership", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(
        `/api/clients?view=teams&entity=clients&portfolio=clients&teamSource=onec&onecTeam=${TEAM_B}&manager=${M1}`,
      )
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
  });
});
