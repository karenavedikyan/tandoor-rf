import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const C_OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CODE = "009988-F6";

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

function f2f5Snapshot() {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "c".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: { guid: null, name: "", state: "not_provided" },
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
    currentRetailOutlets: [],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
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
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C_OWN, name_client: "F6 Own Client", guid_manager: M1, name_manager: "M1" },
      { guid_client: C_FOREIGN, name_client: "F6 Foreign Client", guid_manager: M2, name_manager: "M2" },
    ]);
    await updateClientExtendedSnapshot(databaseUrl, C_OWN, f2f5Snapshot());
    await updateClientExtendedSnapshot(databaseUrl, C_FOREIGN, f2f5Snapshot());
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
    assert.equal(card.body.client.extended?.clientCode?.code1c?.label, CODE);
    assert.equal(card.body.client.extended?.wholesaleExchange?.top150?.label, "Нет");
    assert.equal(card.body.client.extended?.counterparty?.counterparty?.label, "ООО «F6 API»");
    assert.equal(card.body.client.extended?.clientContract?.primaryContract?.label, "Договор F6 API");
  });

  it("manager scope hides foreign client card and filtered list rows", async () => {
    const cookie = await login("manager-f6@example.com");
    const app = await loadApp();
    const list = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(CODE)}`)
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0]?.guid, C_OWN);
    const foreign = await request(app).get(`/api/clients/${C_FOREIGN}`).set(authHeaders(cookie));
    assert.equal(foreign.status, 404);
  });

  it("preview-as-manager is read-only for review writes", async () => {
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
    const card = await request(app).get(`/api/clients/${C_OWN}`).set(authHeaders(adminCookie));
    assert.equal(card.body.client.extended?.clientCode?.code1c?.label, CODE);
    const write = await request(app)
      .put(`/api/clients/${C_OWN}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", comment: "blocked" });
    assert.equal(write.status, 403);
    await request(app).post("/api/admin/access/preview/stop").set(authHeaders(adminCookie)).send({});
  });
});
