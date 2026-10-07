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
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const M1 = "11111111-1111-4111-8111-111111111111";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

function snapshotWithCommercial(input: {
  guidStore: string;
  discountProgram?: string | null;
  discountAmount?: number | null;
  bonusTandoorClub?: string | null;
  bonusProvided?: boolean;
}) {
  const outlets = [
    {
      ordinal: 0,
      guidStore: input.guidStore,
      holdingName: "TT",
      warehouse: false,
      address: { storeAddress: "Addr", deliveryAddress: "", routeDirection: "" },
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
        manager: { guid: M1, name: "Manager One", state: "directory_unverified" },
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: { guid: null, name: "", state: "not_provided" },
      },
      contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
      lpr: { name: "", post: "", dateOfBirth: null, phone: "", email: "", bonus: "", conditionsBonus: "" },
      outletGuidStatus: "confirmed",
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      provenance: { freshness: "current", sourceSha256: "a".repeat(64), importedAt: new Date().toISOString() },
      distributionAllowed: false,
      additional: {
        statusTandoorClub: "",
        bonusTandoorClub: input.bonusTandoorClub ?? "",
        fieldPresence: {
          statusTandoorClub: false,
          bonusTandoorClub: input.bonusProvided ?? false,
        },
      },
    },
  ];
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: { guid: null, name: "", state: "not_provided" },
    commercial: {
      discountProgram: input.discountProgram ?? null,
      discountAmount: input.discountAmount ?? null,
      markups: [],
      fieldPresence: {
        discountProgram: input.discountProgram !== undefined,
        discountAmount: input.discountAmount !== undefined,
        markups: false,
      },
    },
    currentRetailOutlets: outlets,
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients sprint3 fields integration", { concurrency: false }, () => {
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
      email: "admin-s3@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Sprint3",
      role: "admin",
    });
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client With Commercial", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client Without Commercial", guid_manager: M1, name_manager: "Manager One" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      snapshotWithCommercial({
        guidStore: T1,
        discountProgram: "PROMO",
        discountAmount: 0,
        bonusTandoorClub: "0",
        bonusProvided: true,
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      snapshotWithCommercial({ guidStore: T2, bonusProvided: false }),
    );
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T1, guid_client: C1 },
      { guid_store: T2, guid_client: C2 },
    ]);
  });

  after(async () => {
    await closePool();
  });

  it("filled=discountAmount matches zero as value", async () => {
    const cookie = await login("admin-s3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&filled=discountAmount")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guid, C1);
    assert.equal(res.body.items[0].discountAmount?.value, "0");
  });

  it("filled=bonusTandoorClub matches zero on scoped outlet", async () => {
    const cookie = await login("admin-s3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=outlets&filled=bonusTandoorClub")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].bonusTandoorClub?.value, "0");
  });

  it("empty=bonusTandoorClub excludes provided zero value", async () => {
    const cookie = await login("admin-s3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=outlets&empty=bonusTandoorClub")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].guidClient, C2);
  });

  it("detail remains readable after commercial filters (LPR withheld in unit DTO tests)", async () => {
    const cookie = await login("admin-s3@example.com");
    const app = await loadApp();
    const listRes = await request(app)
      .get("/api/clients?view=all&entity=clients&filled=discountProgram")
      .set(authHeaders(cookie));
    assert.equal(listRes.body.items[0]?.discountProgram?.value, "PROMO");

    const res = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.guid, C1);
    assert.equal(res.body.client.extended?.commercial?.discountProgram?.value, "PROMO");
    assert.equal(res.body.client.extended?.sensitiveFieldsWithheld, true);
  });
});
