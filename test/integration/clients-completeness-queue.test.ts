import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
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
const MANAGER_OK = "11111111-1111-4111-8111-111111111111";
const MANAGER_OUTSIDE = "99999999-9999-4999-8999-999999999998";
const CLIENT_BOTH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_FILLED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT_NOT_PROVIDED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT_ROSTER_GAP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_DENIED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STORE_MISSING = "88888888-8888-4888-8888-888888888801";
const STORE_OK = "88888888-8888-4888-8888-888888888802";

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

function extendedSnapshot(input: {
  clientRop?: { guid: string; name: string; state?: string };
  clientManagerGuid?: string | null;
  clientRegional?: { guid: string; name: string; state?: string };
  outlets?: Array<{
    guidStore: string;
    rop?: { guid: string; name: string; state?: string };
    manager?: { guid: string; name: string; state?: string };
    regional?: { guid: string | null; name: string; state?: string };
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
          state: input.clientRegional.state ?? "directory_unverified",
        }
      : { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: input.clientRop
      ? {
          guid: input.clientRop.guid,
          name: input.clientRop.name,
          state: input.clientRop.state ?? "directory_unverified",
        }
      : { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: (input.outlets ?? []).map((outlet, index) => ({
      ordinal: index,
      guidStore: outlet.guidStore,
      holdingName: "TT",
      warehouse: false,
      address: { storeAddress: "Store " + outlet.guidStore.slice(0, 8), deliveryAddress: "", routeDirection: "" },
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
              state: outlet.regional.state ?? "not_provided",
            }
          : { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: outlet.rop
          ? {
              guid: outlet.rop.guid,
              name: outlet.rop.name,
              state: outlet.rop.state ?? "directory_unverified",
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
    {
      guid_client: CLIENT_BOTH,
      name_client: "Client Both Missing",
      guid_manager: "00000000-0000-0000-0000-000000000000",
      name_manager: "Missing Manager",
    },
    {
      guid_client: CLIENT_FILLED,
      name_client: "Client Filled",
      guid_manager: MANAGER_OK,
      name_manager: "Manager OK",
    },
    {
      guid_client: CLIENT_NOT_PROVIDED,
      name_client: "Client Not Provided ROP",
      guid_manager: MANAGER_OK,
      name_manager: "Manager OK",
    },
    {
      guid_client: CLIENT_ROSTER_GAP,
      name_client: "Client Roster Gap",
      guid_manager: MANAGER_OUTSIDE,
      name_manager: "Outside Manager",
    },
    {
      guid_client: CLIENT_DENIED,
      name_client: "Client Denied",
      guid_manager: MANAGER_OK,
      name_manager: "Manager OK",
    },
  ]);

  await updateClientExtendedSnapshot(
    databaseUrl,
    CLIENT_BOTH,
    extendedSnapshot({
      clientRop: { guid: "", name: "", state: "unassigned" },
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    CLIENT_FILLED,
    extendedSnapshot({
      clientRop: { guid: ROP_A, name: "ROP Alpha" },
      clientRegional: { guid: MANAGER_OK, name: "Manager OK", state: "directory_unverified" },
      outlets: [
        {
          guidStore: STORE_MISSING,
          rop: { guid: "", name: "", state: "unassigned" },
          manager: { guid: "", name: "", state: "unassigned" },
        },
        {
          guidStore: STORE_OK,
          rop: { guid: ROP_A, name: "ROP Alpha" },
          manager: { guid: MANAGER_OK, name: "Manager OK" },
        },
      ],
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    CLIENT_NOT_PROVIDED,
    extendedSnapshot({
      clientRop: { guid: "", name: "", state: "not_provided" },
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    CLIENT_ROSTER_GAP,
    extendedSnapshot({
      clientRop: { guid: ROP_A, name: "ROP Alpha" },
    }),
  );
  await updateClientExtendedSnapshot(
    databaseUrl,
    CLIENT_DENIED,
    extendedSnapshot({
      clientRop: { guid: "", name: "", state: "unassigned" },
    }),
  );

  await insertSyntheticRetailOutlets(databaseUrl, [
    { guid_store: STORE_MISSING, guid_client: CLIENT_FILLED },
    { guid_store: STORE_OK, guid_client: CLIENT_FILLED },
  ]);

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `UPDATE onec_clients SET manager_roster_state = 'outside_wholesale_roster' WHERE guid_client = $1::uuid`,
    [CLIENT_ROSTER_GAP],
  );
  await pool.query(
    `UPDATE onec_clients SET manager_roster_state = 'roster_not_loaded' WHERE guid_client = $1::uuid`,
    [CLIENT_DENIED],
  );
  await pool.end();
}

describe("clients completeness queue integration", { concurrency: false }, () => {
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

  it("A: client without ROP and manager yields one row with two reasons", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients/completeness-queue?entity=clients")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const rows = res.body.items.filter((item: { guidClient: string }) => item.guidClient === CLIENT_BOTH);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].reasons.includes("missing_rop"));
    assert.ok(rows[0].reasons.includes("missing_manager"));
  });

  it("B: filled client does not inherit outlet missing reasons; outlet appears separately", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const clientsRes = await request(app)
      .get("/api/clients/completeness-queue?entity=clients")
      .set(authHeaders(cookie));
    assert.equal(clientsRes.status, 200);
    assert.ok(
      !clientsRes.body.items.some(
        (item: { guidClient: string; entityKind: string }) =>
          item.entityKind === "client" && item.guidClient === CLIENT_FILLED,
      ),
    );

    const res = await request(app)
      .get("/api/clients/completeness-queue?entity=outlets")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const outlet = res.body.items.find((item: { guidStore: string | null }) => item.guidStore === STORE_MISSING);
    assert.ok(outlet);
    assert.equal(outlet.entityKind, "outlet");
    assert.ok(outlet.reasons.includes("missing_rop"));
    assert.ok(outlet.reasons.includes("missing_manager"));
    assert.equal(outlet.parentClientName, "Client Filled");
  });

  it("C: not_provided ROP is field_not_provided, not missing_rop", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients/completeness-queue?entity=clients&q=Not+Provided")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const row = res.body.items.find((item: { guidClient: string }) => item.guidClient === CLIENT_NOT_PROVIDED);
    assert.ok(row);
    assert.ok(row.reasons.includes("field_not_provided"));
    assert.ok(!row.reasons.includes("missing_rop"));
  });

  it("D: GUID outside roster yields responsible_outside_roster, not missing_manager", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients/completeness-queue?entity=clients&q=Roster+Gap")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const row = res.body.items.find((item: { guidClient: string }) => item.guidClient === CLIENT_ROSTER_GAP);
    assert.ok(row);
    assert.ok(row.reasons.includes("responsible_outside_roster"));
    assert.ok(!row.reasons.includes("missing_manager"));
  });

  it("E: unavailable roster does not create missing_manager mass incompleteness", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients/completeness-queue?entity=clients&q=Denied")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const row = res.body.items.find((item: { guidClient: string }) => item.guidClient === CLIENT_DENIED);
    assert.ok(row);
    assert.ok(row.reasons.includes("roster_unavailable"));
    assert.ok(!row.reasons.includes("missing_manager"));
    assert.ok(!row.reasons.includes("missing_rop"));
  });

  it("F: reason filters, search and totals stay consistent", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const all = await request(app).get("/api/clients/completeness-queue").set(authHeaders(cookie));
    assert.equal(all.status, 200);
    const filtered = await request(app)
      .get("/api/clients/completeness-queue?completenessReason=missing_rop&entity=clients")
      .set(authHeaders(cookie));
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.total <= all.body.total);
    filtered.body.items.forEach((item: { reasons: string[] }) => {
      assert.ok(item.reasons.includes("missing_rop"));
    });

    const search = await request(app)
      .get("/api/clients/completeness-queue?q=Both+Missing&entity=clients")
      .set(authHeaders(cookie));
    assert.equal(search.status, 200);
    assert.equal(search.body.total, 1);
    assert.equal(search.body.items[0].guidClient, CLIENT_BOTH);
  });

  it("G: denial excludes client from queue totals", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: adminUserId,
      scopeType: "client",
      objectId: CLIENT_DENIED,
      deniedByUserId: adminUserId,
    });

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/completeness-queue").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.ok(!res.body.items.some((item: { guidClient: string }) => item.guidClient === CLIENT_DENIED));
  });

  it("Z: import update removes one reason while review comment persists", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO client_review_records (
          guid_client,
          review_state,
          review_decision,
          comment,
          version,
          basis_manager_guid,
          created_by_user_id,
          updated_by_user_id,
          updated_at
        )
        VALUES (
          $1::uuid,
          'in_progress',
          NULL,
          'Keep this comment',
          1,
          '00000000-0000-0000-0000-000000000000'::uuid,
          $2::uuid,
          $2::uuid,
          NOW()
        )
      `,
      [CLIENT_BOTH, adminUserId],
    );
    await pool.end();

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const before = await request(app)
      .get("/api/clients/completeness-queue?entity=clients&q=Both+Missing")
      .set(authHeaders(cookie));
    assert.equal(before.body.total, 1);
    assert.ok(before.body.items[0].reasons.includes("missing_rop"));

    await updateClientExtendedSnapshot(
      databaseUrl,
      CLIENT_BOTH,
      extendedSnapshot({
        clientRop: { guid: ROP_A, name: "ROP Alpha" },
      }),
    );
    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    await poolAfter.query(`UPDATE onec_clients SET guid_head_sales = $1::uuid WHERE guid_client = $2::uuid`, [
      ROP_A,
      CLIENT_BOTH,
    ]);
    await poolAfter.end();

    await resetPoolForTests();
    const appAfter = await loadApp();
    const afterCookie = await login("admin@example.com");
    const after = await request(appAfter)
      .get("/api/clients/completeness-queue?entity=clients&q=Both+Missing")
      .set(authHeaders(afterCookie));
    assert.equal(after.status, 200);
    assert.equal(after.body.total, 1);
    assert.ok(!after.body.items[0].reasons.includes("missing_rop"));
    assert.ok(after.body.items[0].reasons.includes("missing_manager"));

    const review = await request(appAfter)
      .get(`/api/clients/${CLIENT_BOTH}/review`)
      .set(authHeaders(afterCookie));
    assert.equal(review.status, 200);
    assert.equal(review.body.review?.comment, "Keep this comment");
    assert.equal(review.body.review?.reviewState, "in_progress");
  });
});
