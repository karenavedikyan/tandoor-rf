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
let databaseUrl = "";

const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const MGR_ONLY_CATEGORY = "MGR-ONLY-CAT";

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

function baseSnapshot(wholesale: {
  top150?: string | null;
  top150Provided?: boolean;
  outletCategory?: string | null;
  outletCategoryProvided?: boolean;
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
    headOfSales: { guid: null, name: "", state: "not_provided" },
    wholesaleExchange: {
      top150: wholesale.top150 ?? null,
      outletCategory: wholesale.outletCategory ?? null,
      fieldPresence: {
        top150: wholesale.top150Provided ?? false,
        outletCategory: wholesale.outletCategoryProvided ?? false,
      },
    },
    currentRetailOutlets: [],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients F2 wholesale exchange fields integration", { concurrency: false }, () => {
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
      email: "admin-f2@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin F2",
      role: "admin",
    });
    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager-f2@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager F2",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUser.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      { guid_client: C1, name_client: "Client TOP Net", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client Category D", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C3, name_client: "Client Hidden", guid_manager: M2, name_manager: "Manager Two" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      baseSnapshot({ top150: "Нет", top150Provided: true, outletCategory: "SYNTH-UNKNOWN", outletCategoryProvided: true }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      baseSnapshot({ top150: "Нет", top150Provided: true, outletCategory: "D", outletCategoryProvided: true }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      baseSnapshot({
        top150: "Нет",
        top150Provided: true,
        outletCategory: MGR_ONLY_CATEGORY,
        outletCategoryProvided: true,
      }),
    );
  });

  after(async () => {
    await closePool();
  });

  it("onecCategory exact filter returns scoped client row", async () => {
    const cookie = await login("admin-f2@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&onecCategory=SYNTH-UNKNOWN")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C1);
    assert.equal(res.body.items[0]?.onecCategory?.label, "SYNTH-UNKNOWN");
    assert.equal(res.body.items[0]?.onecTop150?.label, "Нет");
  });

  it("options list distinct non-empty wholesale values for admin scope", async () => {
    const cookie = await login("admin-f2@example.com");
    const app = await loadApp();
    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    const categoryIds = (options.body.onecCategoryValues || []).map((row: { id: string }) => row.id);
    assert.ok(categoryIds.includes("D"));
    assert.ok(categoryIds.includes("SYNTH-UNKNOWN"));
    assert.deepEqual((options.body.onecTop150Values || []).map((row: { id: string }) => row.id), ["Нет"]);
  });

  it("rejects wholesale filters on entity=outlets", async () => {
    const cookie = await login("admin-f2@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=outlets&onecTop150=Нет")
      .set(authHeaders(cookie));
    assert.equal(res.status, 400);
  });

  it("detail card exposes separate TOP and category DTO fields", async () => {
    const cookie = await login("admin-f2@example.com");
    const app = await loadApp();
    const res = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended?.wholesaleExchange?.top150?.label, "Нет");
    assert.equal(res.body.client.extended?.wholesaleExchange?.outletCategory?.label, "SYNTH-UNKNOWN");
  });

  it("filled=onecTop150 matches observed «Нет» value", async () => {
    const cookie = await login("admin-f2@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&filled=onecTop150")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 2);
    assert.ok(res.body.items.every((item: { onecTop150?: { label: string } }) => item.onecTop150?.label === "Нет"));
  });

  it("manager scope hides hidden-client category from options, list, and detail", async () => {
    const cookie = await login("manager-f2@example.com");
    const app = await loadApp();

    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    const categoryIds = (options.body.onecCategoryValues || []).map((row: { id: string }) => row.id);
    assert.ok(categoryIds.includes("D"));
    assert.ok(categoryIds.includes("SYNTH-UNKNOWN"));
    assert.ok(!categoryIds.includes(MGR_ONLY_CATEGORY));

    const list = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCategory=${encodeURIComponent(MGR_ONLY_CATEGORY)}`)
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);

    const detail = await request(app).get(`/api/clients/${C3}`).set(authHeaders(cookie));
    assert.equal(detail.status, 404);
  });

  it("manager can combine exact category filter with filled=onecTop150", async () => {
    const cookie = await login("manager-f2@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&onecCategory=D&filled=onecTop150")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C2);
  });

  it("exact category filter preserves stored spacing without trim mismatch", async () => {
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      baseSnapshot({ top150: "Нет", top150Provided: true, outletCategory: " D", outletCategoryProvided: true }),
    );
    const cookie = await login("admin-f2@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCategory=${encodeURIComponent(" D")}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.onecCategory?.label, " D");
  });
});
