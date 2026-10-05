import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
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
let ropBUserId = "";

const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const M_SHARED = "66666666-6666-4666-8666-666666666601";
const M_OTHER = "77777777-7777-4777-8777-777777777701";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const C_B = "33333333-3333-4333-8333-333333333333";
const T2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T3 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
    regionalManager: { guid: null, name: "", state: "not_provided" },
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
              name: "Shared Manager",
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
      VALUES (1, $1, 4)
      ON CONFLICT (id) DO UPDATE SET employee_count = 4, source_sha256 = EXCLUDED.source_sha256
    `,
    ["b".repeat(64)],
  );
  for (const [guid, name] of [
    [ROP_A, "ROP Alpha"],
    [ROP_B, "ROP Beta"],
    [M_SHARED, "Shared Manager"],
    [M_OTHER, "Other Manager"],
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
  await pool.end();
}

async function seedAssignmentFixture(): Promise<void> {
  await insertSyntheticClients(databaseUrl, [
    {
      guid_client: C1,
      name_client: "Client C1",
      guid_manager: M_SHARED,
      name_manager: "Shared Manager",
    },
    {
      guid_client: C2,
      name_client: "Client C2",
      guid_manager: M_OTHER,
      name_manager: "Other Manager",
    },
    {
      guid_client: C_B,
      name_client: "Client B only",
      guid_manager: M_SHARED,
      name_manager: "Shared Manager",
    },
  ]);

  await updateClientExtendedSnapshot(
    databaseUrl,
    C1,
    branchSnapshot({
      clientRop: { guid: ROP_A, name: "ROP Alpha" },
      clientManager: { guid: M_SHARED, name: "Shared Manager" },
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    C2,
    branchSnapshot({
      outlets: [
        {
          guidStore: T2,
          rop: { guid: ROP_A, name: "ROP Alpha" },
          manager: { guid: M_SHARED, name: "Shared Manager" },
        },
        {
          guidStore: T3,
          rop: { guid: ROP_B, name: "ROP Beta" },
          manager: { guid: M_SHARED, name: "Shared Manager" },
        },
      ],
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    C_B,
    branchSnapshot({
      clientRop: { guid: ROP_B, name: "ROP Beta" },
      clientManager: { guid: M_SHARED, name: "Shared Manager" },
    }),
  );

  await insertSyntheticRetailOutlets(databaseUrl, [
    { guid_store: T2, guid_client: C2 },
    { guid_store: T3, guid_client: C2 },
  ]);
}

describe("clients ROP assignment read scope integration", { concurrency: false }, () => {
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
        email: "rop-a@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP Alpha User",
        role: "rop",
      })
    ).id;

    ropBUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop-b@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP Beta User",
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
    await seedAssignmentFixture();
  });

  after(async () => {
    await closePool();
  });

  it("A: empty legacy team — ROP A sees C1 and outlet T2 by 1C assignment", async () => {
    const cookie = await login("rop-a@example.com");
    const app = await loadApp();

    const clients = await request(app).get("/api/clients?view=all").set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, 1);
    assert.equal(clients.body.items[0].guid, C1);

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    assert.equal(overview.body.rops[0].uniqueClientCount, 1);
    assert.equal(overview.body.rops[0].uniqueOutletCount, 1);

    const parentCard = await request(app).get(`/api/clients/${C2}`).set(authHeaders(cookie));
    assert.equal(parentCard.status, 200);
    assert.deepEqual(
      (parentCard.body.client?.extended?.retailOutlets ?? []).map(
        (item: { guidStore: string | null }) => item.guidStore,
      ),
      [T2],
    );
  });

  it("B: outlet-only parent C2 is not a direct client; T3 is blocked", async () => {
    const cookie = await login("rop-a@example.com");
    const app = await loadApp();

    const clients = await request(app).get("/api/clients?view=all").set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.ok(!clients.body.items.some((item: { guid: string }) => item.guid === C2));

    const card = await request(app).get(`/api/clients/${C2}`).set(authHeaders(cookie));
    assert.equal(card.status, 200);
    const storeGuids = (card.body.client?.extended?.retailOutlets ?? []).map(
      (item: { guidStore: string | null }) => item.guidStore,
    );
    assert.deepEqual(storeGuids, [T2]);
    assert.ok(!storeGuids.includes(T3));

    const foreignCard = await request(app).get(`/api/clients/${C_B}`).set(authHeaders(cookie));
    assert.equal(foreignCard.status, 404);
  });

  it("C: shared manager does not give ROP A portfolio of ROP B", async () => {
    const cookie = await login("rop-a@example.com");
    const app = await loadApp();

    const clients = await request(app).get("/api/clients?view=all").set(authHeaders(cookie));
    assert.ok(!clients.body.items.some((item: { guid: string }) => item.guid === C_B));
  });

  it("G: client denial removes C1 from list, org counters and filter options", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: ropAUserId,
      scopeType: "client",
      objectId: C1,
      deniedByUserId: adminUserId,
    });

    const cookie = await login("rop-a@example.com");
    const app = await loadApp();

    const clients = await request(app).get("/api/clients?view=all").set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.ok(!clients.body.items.some((item: { guid: string }) => item.guid === C1));

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    assert.equal(overview.body.rops[0].uniqueClientCount, 0);

    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    assert.ok(!options.body.managers.some((item: { id: string }) => item.id.toLowerCase() === M_SHARED.toLowerCase()));
  });

  it("D: all_clients denial returns empty data without fallback", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: ropAUserId,
      scopeType: "all_clients",
      deniedByUserId: adminUserId,
    });

    const cookie = await login("rop-a@example.com");
    const app = await loadApp();

    const clients = await request(app).get("/api/clients?view=all").set(authHeaders(cookie));
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, 0);

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    assert.equal(overview.body.rops[0].uniqueClientCount, 0);
    assert.equal(overview.body.rops[0].uniqueOutletCount, 0);

    const card = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(card.status, 404);
  });

  it("E: revoked employee-link stops access in the same session", async () => {
    const cookie = await login("rop-a@example.com");
    const app = await loadApp();

    const before = await request(app).get("/api/clients?view=all").set(authHeaders(cookie));
    assert.equal(before.status, 200);
    assert.ok(before.body.total > 0);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [ropAUserId],
    );
    await pool.end();
    await resetPoolForTests();

    const appAfter = await loadApp();
    const after = await request(appAfter).get("/api/clients?view=all").set(authHeaders(cookie));
    assert.equal(after.status, 403);
    assert.equal(after.body.error?.code, "FORBIDDEN");
  });

  it("Ж: import reassignment moves client assignment from ROP A to ROP B", async () => {
    const cookieA = await login("rop-a@example.com");
    const cookieB = await login("rop-b@example.com");
    const app = await loadApp();

    const beforeA = await request(app).get("/api/clients?view=all").set(authHeaders(cookieA));
    assert.ok(beforeA.body.items.some((item: { guid: string }) => item.guid === C1));

    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      branchSnapshot({
        clientRop: { guid: ROP_B, name: "ROP Beta" },
        clientManager: { guid: M_SHARED, name: "Shared Manager" },
      }),
    );
    await resetPoolForTests();
    const appAfter = await loadApp();

    const afterA = await request(appAfter).get("/api/clients?view=all").set(authHeaders(cookieA));
    assert.ok(!afterA.body.items.some((item: { guid: string }) => item.guid === C1));

    const afterB = await request(appAfter).get("/api/clients?view=all").set(authHeaders(cookieB));
    assert.ok(afterB.body.items.some((item: { guid: string }) => item.guid === C1));
  });

  it("И: 1C assignment read scope does not grant review write", async () => {
    const cookie = await login("rop-a@example.com");
    const app = await loadApp();

    const write = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set(authHeaders(cookie))
      .send({ reviewState: "in_progress", expectedVersion: null });
    assert.equal(write.status, 403);
  });
});
