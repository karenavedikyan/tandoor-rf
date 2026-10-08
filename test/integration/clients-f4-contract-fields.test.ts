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
const MGR_ONLY_PRIMARY = "MGR-HIDDEN-CONTRACT-UNIQUE";
const SPECIAL_PRIMARY = "100%_«quoted»";
const SPECIAL_NEEDLE = "100%_";

type ContractSnapshotInput = {
  primaryContract?: string | null;
  primaryContractProvided?: boolean;
  mainAgreement?: string | null;
  mainAgreementProvided?: boolean;
};

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

function baseSnapshot(contract: ContractSnapshotInput) {
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
      counterparty: null,
      legalEntityType: null,
      ogrn: null,
      fullName: null,
      fieldPresence: {
        counterparty: false,
        legalEntityType: false,
        ogrn: false,
        fullName: false,
      },
    },
    clientContract: {
      primaryContract: contract.primaryContract ?? null,
      mainAgreement: contract.mainAgreement ?? null,
      fieldPresence: {
        primaryContract: contract.primaryContractProvided ?? false,
        mainAgreement: contract.mainAgreementProvided ?? false,
      },
    },
    currentRetailOutlets: [],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

describe("clients F4 contract exchange fields integration", { concurrency: false }, () => {
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
      email: "admin-f4@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin F4",
      role: "admin",
    });
    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager-f4@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager F4",
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
      { guid_client: C1, name_client: "Client Contract Match", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client Empty Agreement", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C3, name_client: "Client Hidden Contract", guid_manager: M2, name_manager: "Manager Two" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      baseSnapshot({
        primaryContract: SPECIAL_PRIMARY,
        primaryContractProvided: true,
        mainAgreement: "Соглашение Alpha F4",
        mainAgreementProvided: true,
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      baseSnapshot({
        primaryContract: "Договор Beta",
        primaryContractProvided: true,
        mainAgreement: "",
        mainAgreementProvided: true,
      }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      baseSnapshot({
        primaryContract: MGR_ONLY_PRIMARY,
        primaryContractProvided: true,
        mainAgreement: "Hidden agreement",
        mainAgreementProvided: true,
      }),
    );
  });

  after(async () => {
    await closePool();
  });

  it("onecPrimaryContractContains treats % and _ literally with escape", async () => {
    const cookie = await login("admin-f4@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(
        `/api/clients?view=all&entity=clients&onecPrimaryContractContains=${encodeURIComponent(SPECIAL_NEEDLE)}`,
      )
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C1);
    assert.equal(res.body.items[0]?.onecPrimaryContract?.label, SPECIAL_PRIMARY);
  });

  it("onecMainAgreementContains matches substring with quotes", async () => {
    const cookie = await login("admin-f4@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&onecMainAgreementContains=Alpha%20F4")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C1);
  });

  it("detail card exposes clientContract DTO block", async () => {
    const cookie = await login("admin-f4@example.com");
    const app = await loadApp();
    const res = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended?.clientContract?.primaryContract?.label, SPECIAL_PRIMARY);
    assert.equal(res.body.client.extended?.clientContract?.mainAgreement?.label, "Соглашение Alpha F4");
  });

  it("empty=onecMainAgreement matches explicit empty agreement", async () => {
    const cookie = await login("admin-f4@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&empty=onecMainAgreement")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C2);
  });

  it("filled=onecPrimaryContract matches non-empty stored values", async () => {
    const cookie = await login("admin-f4@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&filled=onecPrimaryContract")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 3);
  });

  it("rejects contract filters on entity=outlets", async () => {
    const cookie = await login("admin-f4@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(
        `/api/clients?view=all&entity=outlets&onecPrimaryContractContains=${encodeURIComponent("Договор")}`,
      )
      .set(authHeaders(cookie));
    assert.equal(res.status, 400);
  });

  it("manager scope hides hidden-client contract from list and detail", async () => {
    const cookie = await login("manager-f4@example.com");
    const app = await loadApp();
    const list = await request(app)
      .get(
        `/api/clients?view=all&entity=clients&onecPrimaryContractContains=${encodeURIComponent(MGR_ONLY_PRIMARY)}`,
      )
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);
    const detail = await request(app).get(`/api/clients/${C3}`).set(authHeaders(cookie));
    assert.equal(detail.status, 404);
  });

  it("preview-as-manager: own client F4 visible, foreign hidden, writes blocked", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin-f4@example.com");
    const managerUser = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-f4")
        .set(authHeaders(adminCookie))
    ).body.items.find((item: { email: string }) => item.email === "manager-f4@example.com");
    assert.ok(managerUser);

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: managerUser.id });
    assert.equal(start.status, 200);

    const ownCard = await request(app).get(`/api/clients/${C1}`).set(authHeaders(adminCookie));
    assert.equal(ownCard.status, 200);
    assert.equal(ownCard.body.client.extended?.clientContract?.primaryContract?.label, SPECIAL_PRIMARY);

    const foreignList = await request(app)
      .get(
        `/api/clients?view=all&entity=clients&onecPrimaryContractContains=${encodeURIComponent(MGR_ONLY_PRIMARY)}`,
      )
      .set(authHeaders(adminCookie));
    assert.equal(foreignList.status, 200);
    assert.equal(foreignList.body.total, 0);

    const write = await request(app)
      .put(`/api/clients/${C1}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", comment: "blocked in preview" });
    assert.equal(write.status, 403);

    await request(app).post("/api/admin/access/preview/stop").set(authHeaders(adminCookie)).send({});
  });
});
