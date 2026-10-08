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
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const DIRECTOR_EMP = "33333333-3333-4333-8333-333333333333";
const C_OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T_ACCESS = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const T_SIBLING = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const CODE = "009988-F6";
const LPR_VISIBLE = "F6 Scope LPR Visible";
const LPR_HIDDEN = "F6 Scope LPR Hidden";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
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

function buildOutlet(input: {
  ordinal: number;
  guidStore: string;
  storeAddress: string;
  managerGuid: string;
  lprName: string;
}) {
  return {
    ordinal: input.ordinal,
    guidStore: input.guidStore,
    holdingName: "Holding",
    warehouse: null,
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    closureConfirmedInCurrentExport: true,
    closureHistory: [],
    address: {
      storeAddress: input.storeAddress,
      deliveryAddress: "",
      routeDirection: "",
    },
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
      manager: { guid: input.managerGuid, name: "Manager", state: "directory_unverified" },
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: null, name: "", state: "not_provided" },
    },
    contacts: { storePhone: "+79001112233", accountantPhone: "", accountantEmail: "" },
    lpr: {
      name: input.lprName,
      post: "Director",
      dateOfBirth: "1985-06-01",
      phone: "+79003334455",
      email: "lpr-scope@example.test",
      bonus: "0",
      conditionsBonus: "Scope bonus terms",
    },
    additional: { statusTandoorClub: "", bonusTandoorClub: "" },
    provenance: {
      freshness: "current",
      sourceSha256: "a".repeat(64),
      importedAt: "2026-01-01T10:00:00.000Z",
    },
    distributionAllowed: false,
  };
}

function f2f5Snapshot() {
  const emptyRef = { guid: null, name: "", state: "not_provided" as const };
  return {
    formatVersion: "extended_v1",
    sourceSha256: "c".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: emptyRef,
    hardwareManager: emptyRef,
    headOfSales: emptyRef,
    wholesaleExchange: {
      top150: "Нет",
      outletCategory: "D",
      fieldPresence: { top150: true, outletCategory: true },
    },
    counterparty: {
      counterparty: "ООО «F6 API»",
      fullName: "F6 API Full Name",
      legalEntityType: "Компания",
      ogrn: "0123456789012",
      fieldPresence: {
        counterparty: true,
        fullName: true,
        legalEntityType: true,
        ogrn: true,
      },
    },
    clientContract: {
      primaryContract: "Договор F6 API",
      mainAgreement: "Соглашение F6 API",
      fieldPresence: { primaryContract: true, mainAgreement: true },
    },
    clientCode: {
      code1c: CODE,
      fieldPresence: { code1c: true },
    },
    currentRetailOutlets: [
      buildOutlet({
        ordinal: 1,
        guidStore: T_ACCESS,
        storeAddress: "Accessible TT address",
        managerGuid: M1,
        lprName: LPR_VISIBLE,
      }),
      buildOutlet({
        ordinal: 2,
        guidStore: T_SIBLING,
        storeAddress: "Sibling TT address",
        managerGuid: M2,
        lprName: LPR_HIDDEN,
      }),
    ],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

function assertF2F5CardFields(body: { client: { extended?: Record<string, unknown> } }) {
  const ext = body.client.extended as {
    clientCode?: { code1c?: { label: string } };
    wholesaleExchange?: { top150?: { label: string } };
    counterparty?: { counterparty?: { label: string } };
    clientContract?: { primaryContract?: { label: string } };
  };
  assert.equal(ext?.clientCode?.code1c?.label, CODE);
  assert.equal(ext?.wholesaleExchange?.top150?.label, "Нет");
  assert.equal(ext?.counterparty?.counterparty?.label, "ООО «F6 API»");
  assert.equal(ext?.clientContract?.primaryContract?.label, "Договор F6 API");
}

describe("clients F6 API access and F2–F5 DTO visibility", { concurrency: false }, () => {
  let databaseUrl = "";

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
      email: "admin-f6@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin F6",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-f6@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager F6",
      role: "manager",
    });
    const director = await createTestUser({
      databaseUrl,
      email: "director-f6@example.com",
      password: TEST_PASSWORD,
      fullName: "Director F6",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: director.id,
      employeeId: DIRECTOR_EMP,
      confirmedByUserId: admin.id,
    });
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C_OWN, name_client: "F6 Own Client", guid_manager: M1, name_manager: "M1" },
      { guid_client: C_FOREIGN, name_client: "F6 Foreign Client", guid_manager: M2, name_manager: "M2" },
    ]);
    await insertSyntheticRetailOutlets(databaseUrl, [
      { guid_store: T_ACCESS, guid_client: C_OWN, is_closed: false },
      { guid_store: T_SIBLING, guid_client: C_OWN, is_closed: false },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, C_OWN, f2f5Snapshot());
    const foreignSnap = f2f5Snapshot();
    foreignSnap.currentRetailOutlets = [
      buildOutlet({
        ordinal: 1,
        guidStore: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        storeAddress: "Foreign-only TT",
        managerGuid: M2,
        lprName: "Foreign LPR",
      }),
    ];
    await updateClientExtendedSnapshot(databaseUrl, C_FOREIGN, foreignSnap);
  });

  after(async () => {
    await closePool();
  });

  it("admin sees all F2–F5 fields on accessible client list and card", async () => {
    const cookie = await login("admin-f6@example.com");
    const app = await loadApp();
    const list = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(CODE)}`)
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);
    assert.equal(list.body.items[0]?.code1c?.label, CODE);

    const card = await request(app).get(`/api/clients/${C_OWN}`).set(authHeaders(cookie));
    assert.equal(card.status, 200);
    assertF2F5CardFields(card.body);
    assert.equal(card.body.client.extended.retailOutlets.length, 2);
  });

  it("director sees F2–F5 on full base list and card", async () => {
    const cookie = await login("director-f6@example.com");
    const app = await loadApp();
    const list = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(CODE)}`)
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);
    const card = await request(app).get(`/api/clients/${C_OWN}`).set(authHeaders(cookie));
    assert.equal(card.status, 200);
    assertF2F5CardFields(card.body);
    assert.equal(card.body.client.extended.retailOutlets.length, 2);
  });

  it("manager sees accessible outlet business fields; sibling outlet and LPR hidden", async () => {
    const cookie = await login("manager-f6@example.com");
    const app = await loadApp();
    const list = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(CODE)}`)
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0]?.guid, C_OWN);

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set(authHeaders(cookie));
    assert.equal(outlets.status, 200);
    const outletGuids = outlets.body.items.map((item: { guidStore: string }) => item.guidStore);
    assert.ok(outletGuids.includes(T_ACCESS));
    assert.ok(!outletGuids.includes(T_SIBLING));

    const hiddenLprFilter = await request(app)
      .get(`/api/clients?entity=outlets&lprNameContains=${encodeURIComponent("Hidden")}`)
      .set(authHeaders(cookie));
    assert.equal(hiddenLprFilter.status, 200);
    assert.equal(hiddenLprFilter.body.total, 0);

    const visibleLprFilter = await request(app)
      .get(`/api/clients?entity=outlets&lprNameContains=${encodeURIComponent("Visible")}`)
      .set(authHeaders(cookie));
    assert.equal(visibleLprFilter.status, 200);
    assert.equal(visibleLprFilter.body.total, 1);
    assert.equal(visibleLprFilter.body.items[0]?.guidStore, T_ACCESS);

    const foreign = await request(app).get(`/api/clients/${C_FOREIGN}`).set(authHeaders(cookie));
    assert.equal(foreign.status, 404);

    const card = await request(app).get(`/api/clients/${C_OWN}`).set(authHeaders(cookie));
    assert.equal(card.status, 200);
    assertF2F5CardFields(card.body);
    assert.equal(card.body.client.extended.retailOutlets.length, 1);
    const outlet = card.body.client.extended.retailOutlets[0];
    assert.equal(outlet.guidStore, T_ACCESS);
    assert.equal(outlet.lpr.name.label, LPR_VISIBLE);
    assert.equal(outlet.lpr.bonus.label, "0");
    assert.equal(outlet.lpr.conditionsBonus.label, "Scope bonus terms");
    assert.equal(outlet.lpr.phone.label, "+79003334455");
  });

  it("preview-as-manager is read-only and inherits manager outlet scope", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin-f6@example.com");
    const managerUser = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-f6")
        .set(authHeaders(adminCookie))
    ).body.items.find((item: { email: string }) => item.email === "manager-f6@example.com");
    assert.ok(managerUser);
    await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: managerUser.id });

    const outlets = await request(app)
      .get("/api/clients?entity=outlets")
      .set(authHeaders(adminCookie));
    assert.equal(outlets.status, 200);
    const outletGuids = outlets.body.items.map((item: { guidStore: string }) => item.guidStore);
    assert.ok(outletGuids.includes(T_ACCESS));
    assert.ok(!outletGuids.includes(T_SIBLING));

    const card = await request(app).get(`/api/clients/${C_OWN}`).set(authHeaders(adminCookie));
    assert.equal(card.body.client.extended?.clientCode?.code1c?.label, CODE);
    assert.equal(card.body.client.extended.retailOutlets.length, 1);
    assert.equal(card.body.client.extended.retailOutlets[0].lpr.name.label, LPR_VISIBLE);

    const write = await request(app)
      .put(`/api/clients/${C_OWN}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", comment: "blocked" });
    assert.equal(write.status, 403);
    await request(app).post("/api/admin/access/preview/stop").set(authHeaders(adminCookie)).send({});
  });
});
