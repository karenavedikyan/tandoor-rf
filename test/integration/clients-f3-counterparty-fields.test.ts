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
const MGR_ONLY_COUNTERPARTY = "MGR-HIDDEN-COUNTERPARTY-UNIQUE";
const MGR_ONLY_LEGAL_TYPE = "MGR-ONLY-LEGAL-TYPE";
const OGRN_LEADING_ZEROS = "0123456789012";

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

type CounterpartySnapshotInput = {
  counterparty?: string | null;
  counterpartyProvided?: boolean;
  legalEntityType?: string | null;
  legalEntityTypeProvided?: boolean;
  ogrn?: string | null;
  ogrnProvided?: boolean;
  fullName?: string | null;
  fullNameProvided?: boolean;
};

function baseSnapshot(counterparty: CounterpartySnapshotInput) {
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
      top150: null,
      outletCategory: null,
      fieldPresence: { top150: false, outletCategory: false },
    },
    counterparty: {
      counterparty: counterparty.counterparty ?? null,
      legalEntityType: counterparty.legalEntityType ?? null,
      ogrn: counterparty.ogrn ?? null,
      fullName: counterparty.fullName ?? null,
      fieldPresence: {
        counterparty: counterparty.counterpartyProvided ?? false,
        legalEntityType: counterparty.legalEntityTypeProvided ?? false,
        ogrn: counterparty.ogrnProvided ?? false,
        fullName: counterparty.fullNameProvided ?? false,
      },
    },
    currentRetailOutlets: [],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients F3 counterparty exchange fields integration", { concurrency: false }, () => {
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
      email: "admin-f3@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin F3",
      role: "admin",
    });
    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager-f3@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager F3",
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
      { guid_client: C1, name_client: "Client OGRN Match", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client Legal Type", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C3, name_client: "Client Hidden", guid_manager: M2, name_manager: "Manager Two" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      baseSnapshot({
        counterparty: "ООО «Alpha F3»",
        counterpartyProvided: true,
        legalEntityType: "Компания",
        legalEntityTypeProvided: true,
        ogrn: OGRN_LEADING_ZEROS,
        ogrnProvided: true,
        fullName: "Alpha Full Legal Name",
        fullNameProvided: true,
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      baseSnapshot({
        counterparty: "Частное лицо Beta",
        counterpartyProvided: true,
        legalEntityType: "Частное лицо",
        legalEntityTypeProvided: true,
        ogrn: "9988776655443",
        ogrnProvided: true,
        fullName: "",
        fullNameProvided: true,
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      baseSnapshot({
        counterparty: MGR_ONLY_COUNTERPARTY,
        counterpartyProvided: true,
        legalEntityType: MGR_ONLY_LEGAL_TYPE,
        legalEntityTypeProvided: true,
        ogrn: "1111111111111",
        ogrnProvided: true,
        fullName: "Hidden Full Name",
        fullNameProvided: true,
      }),
    );
  });

  after(async () => {
    await closePool();
  });

  it("onecOgrn exact filter preserves leading zeros", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecOgrn=${encodeURIComponent(OGRN_LEADING_ZEROS)}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C1);
    assert.equal(res.body.items[0]?.onecOgrn?.label, OGRN_LEADING_ZEROS);
  });

  it("onecLegalEntityType exact filter returns scoped client row", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&onecLegalEntityType=Частное%20лицо")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C2);
    assert.equal(res.body.items[0]?.onecLegalEntityType?.label, "Частное лицо");
  });

  it("onecCounterpartyContains filter matches substring", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&onecCounterpartyContains=Alpha%20F3")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C1);
    assert.equal(res.body.items[0]?.onecCounterparty?.label, "ООО «Alpha F3»");
  });

  it("options list distinct legal entity types for admin scope", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    const legalIds = (options.body.onecLegalEntityTypeValues || []).map((row: { id: string }) => row.id);
    assert.ok(legalIds.includes("Компания"));
    assert.ok(legalIds.includes("Частное лицо"));
    assert.ok(legalIds.includes(MGR_ONLY_LEGAL_TYPE));
  });

  it("rejects counterparty filters on entity=outlets", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients?view=all&entity=outlets&onecOgrn=${encodeURIComponent(OGRN_LEADING_ZEROS)}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 400);
  });

  it("detail card exposes counterparty DTO block", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const res = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended?.counterparty?.counterparty?.label, "ООО «Alpha F3»");
    assert.equal(res.body.client.extended?.counterparty?.legalEntityType?.label, "Компания");
    assert.equal(res.body.client.extended?.counterparty?.ogrn?.label, OGRN_LEADING_ZEROS);
    assert.equal(res.body.client.extended?.counterparty?.fullName?.label, "Alpha Full Legal Name");
  });

  it("filled=onecOgrn matches stored OGRN values", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&filled=onecOgrn")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 3);
    assert.ok(
      res.body.items.every(
        (item: { onecOgrn?: { label: string } }) => item.onecOgrn?.label && item.onecOgrn.label.length > 0,
      ),
    );
  });

  it("empty=onecFullName matches explicit empty full name", async () => {
    const cookie = await login("admin-f3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&empty=onecFullName")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C2);
  });

  it("manager scope hides hidden-client counterparty from options, list, and detail", async () => {
    const cookie = await login("manager-f3@example.com");
    const app = await loadApp();

    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    const legalIds = (options.body.onecLegalEntityTypeValues || []).map((row: { id: string }) => row.id);
    assert.ok(legalIds.includes("Компания"));
    assert.ok(legalIds.includes("Частное лицо"));
    assert.ok(!legalIds.includes(MGR_ONLY_LEGAL_TYPE));

    const list = await request(app)
      .get(
        `/api/clients?view=all&entity=clients&onecCounterpartyContains=${encodeURIComponent(MGR_ONLY_COUNTERPARTY)}`,
      )
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);

    const byLegalType = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecLegalEntityType=${encodeURIComponent(MGR_ONLY_LEGAL_TYPE)}`)
      .set(authHeaders(cookie));
    assert.equal(byLegalType.status, 200);
    assert.equal(byLegalType.body.total, 0);

    const detail = await request(app).get(`/api/clients/${C3}`).set(authHeaders(cookie));
    assert.equal(detail.status, 404);
  });

  it("manager can combine legal type filter with filled=onecCounterparty", async () => {
    const cookie = await login("manager-f3@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&onecLegalEntityType=Частное%20лицо&filled=onecCounterparty")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C2);
  });

  it("preview-as-manager: own client F3 visible, foreign client hidden, writes blocked", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin-f3@example.com");
    const managerUser = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-f3")
        .set(authHeaders(adminCookie))
    ).body.items.find((item: { email: string }) => item.email === "manager-f3@example.com");
    assert.ok(managerUser);

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: managerUser.id });
    assert.equal(start.status, 200);

    const ownCard = await request(app).get(`/api/clients/${C1}`).set(authHeaders(adminCookie));
    assert.equal(ownCard.status, 200);
    assert.equal(ownCard.body.client.extended?.counterparty?.counterparty?.label, "ООО «Alpha F3»");
    assert.equal(ownCard.body.client.extended?.counterparty?.ogrn?.label, OGRN_LEADING_ZEROS);

    const foreignList = await request(app)
      .get(
        `/api/clients?view=all&entity=clients&onecCounterpartyContains=${encodeURIComponent(MGR_ONLY_COUNTERPARTY)}`,
      )
      .set(authHeaders(adminCookie));
    assert.equal(foreignList.status, 200);
    assert.equal(foreignList.body.total, 0);

    const foreignDetail = await request(app).get(`/api/clients/${C3}`).set(authHeaders(adminCookie));
    assert.equal(foreignDetail.status, 404);

    const previewOptions = await request(app).get("/api/clients/options").set(authHeaders(adminCookie));
    assert.equal(previewOptions.status, 200);
    const previewLegalIds = (previewOptions.body.onecLegalEntityTypeValues || []).map(
      (row: { id: string }) => row.id,
    );
    assert.ok(!previewLegalIds.includes(MGR_ONLY_LEGAL_TYPE));

    const write = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", comment: "blocked in preview" });
    assert.equal(write.status, 403);

    await request(app).post("/api/admin/access/preview/stop").set(authHeaders(adminCookie)).send({});
  });
});
