import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ORG_DIRECTOR_EMPLOYEE_GUID } from "../../src/clients/org/constants";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  insertSyntheticRetailOutlets,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";
let adminUserId = "";

const DIRECTOR = ORG_DIRECTOR_EMPLOYEE_GUID;
const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const MANAGER_SHARED = "22222222-2222-4222-8222-222222222222";
const MANAGER_ONLY_B = "55555555-5555-4555-8555-555555555555";
const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "33333333-3333-4333-8333-333333333333";
const CLIENT_MIXED = "44444444-4444-4444-8444-444444444444";
const CLIENT_MISSING_ROP = "66666666-6666-4666-8666-666666666666";
const STORE_MIXED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  const rows = [
    [DIRECTOR, "Гончаренко Дмитрий", "Директор"],
    [ROP_A, "Скалабан Александр", "Руководитель отдела продаж"],
    [ROP_B, "Купянский Родион", "Руководитель отдела продаж"],
    [MANAGER_SHARED, "Общий Менеджер", "Менеджер"],
    [MANAGER_ONLY_B, "Менеджер B", "Менеджер"],
    ["99999999-9999-4999-8999-999999999999", "Маркетинг", "Маркетолог"],
  ];
  for (const [guid, name, post] of rows) {
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

function extendedSnapshot(input: {
  headOfSales?: { guid: string; name: string; state?: string };
  manager?: { guid: string; name: string; state?: string };
  outlets?: Array<{
    guidStore: string;
    headOfSales?: { guid: string; name: string; state?: string };
    manager?: { guid: string; name: string; state?: string };
  }>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: input.headOfSales
      ? {
          guid: input.headOfSales.guid,
          name: input.headOfSales.name,
          state: input.headOfSales.state ?? "directory_unverified",
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
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: outlet.headOfSales
          ? {
              guid: outlet.headOfSales.guid,
              name: outlet.headOfSales.name,
              state: outlet.headOfSales.state ?? "directory_unverified",
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

describe("clients org structure integration", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    const adminUser = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    adminUserId = adminUser.id;
    const directorUser = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director User",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: directorUser.id,
      employeeId: DIRECTOR,
      confirmedByUserId: adminUserId,
    });
    await seedRoster();
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_A,
        name_client: "Client A",
        guid_manager: MANAGER_SHARED,
        name_manager: "Shared Manager",
      },
      {
        guid_client: CLIENT_B,
        name_client: "Client B",
        guid_manager: MANAGER_ONLY_B,
        name_manager: "Manager B",
      },
      {
        guid_client: CLIENT_MIXED,
        name_client: "Client Mixed",
        guid_manager: MANAGER_SHARED,
        name_manager: "Shared Manager",
      },
      {
        guid_client: CLIENT_MISSING_ROP,
        name_client: "Client Missing ROP",
        guid_manager: MANAGER_SHARED,
        name_manager: "Shared Manager",
      },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      CLIENT_A,
      extendedSnapshot({
        headOfSales: { guid: ROP_A, name: "Skalaban" },
        manager: { guid: MANAGER_SHARED, name: "Shared Manager" },
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      CLIENT_B,
      extendedSnapshot({
        headOfSales: { guid: ROP_B, name: "Kupyansky" },
        manager: { guid: MANAGER_ONLY_B, name: "Manager B" },
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      CLIENT_MIXED,
      extendedSnapshot({
        headOfSales: { guid: ROP_A, name: "Skalaban" },
        manager: { guid: MANAGER_SHARED, name: "Shared Manager" },
        outlets: [
          {
            guidStore: STORE_MIXED,
            headOfSales: { guid: ROP_B, name: "Kupyansky" },
            manager: { guid: MANAGER_ONLY_B, name: "Manager B" },
          },
        ],
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      CLIENT_MISSING_ROP,
      extendedSnapshot({
        headOfSales: { guid: "", name: "", state: "unassigned" },
        manager: { guid: MANAGER_SHARED, name: "Shared Manager" },
      }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: STORE_MIXED, guid_client: CLIENT_MIXED },
    ]);
  });

  after(async () => {
    await closePool();
  });

  it("shows director separately and excludes director from ROP list", async () => {
    const cookie = await login("director@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.director?.employeeGuid, DIRECTOR);
    assert.ok(res.body.rops.some((rop: { employeeGuid: string }) => rop.employeeGuid === ROP_A));
    assert.ok(!res.body.rops.some((rop: { employeeGuid: string }) => rop.employeeGuid === DIRECTOR));
  });

  it("lists ROPs without linked accounts and undefined team members", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const ropA = res.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_A);
    assert.ok(ropA);
    assert.equal(ropA.hasLinkedAccount, false);
    assert.ok(res.body.undefinedTeam.some((item: { name: string }) => item.name.includes("Маркетинг")));
  });

  it("keeps shared manager portfolios separate per ROP branch", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const branchA = await request(app)
      .get(`/api/clients?view=teams&ropEmployee=${ROP_A}&manager=${MANAGER_SHARED}`)
      .set(authHeaders(cookie));
    assert.equal(branchA.status, 200);
    const guidsA = (branchA.body.items as Array<{ guid: string }>).map((item) => item.guid).sort();
    assert.deepEqual(guidsA, [CLIENT_A, CLIENT_MIXED].sort());

    const branchB = await request(app)
      .get(`/api/clients?view=teams&ropEmployee=${ROP_B}&manager=${MANAGER_SHARED}`)
      .set(authHeaders(cookie));
    assert.equal(branchB.status, 200);
    assert.equal(branchB.body.total, 0);
  });

  it("returns completeness queue entries with multiple reasons collapsed per row", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/completeness-queue").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const missing = res.body.items.find(
      (item: { guidClient: string }) => item.guidClient === CLIENT_MISSING_ROP,
    );
    assert.ok(missing);
    assert.ok(missing.reasons.includes("missing_rop"));
    assert.equal(
      res.body.items.filter((item: { guidClient: string }) => item.guidClient === CLIENT_MISSING_ROP).length,
      1,
    );
  });

  it("rejects simultaneous rop and ropEmployee filters", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients?rop=${ROP_A}&ropEmployee=${ROP_B}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 400);
  });
});
