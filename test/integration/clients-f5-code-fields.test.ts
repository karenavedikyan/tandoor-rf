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
import { Pool } from "pg";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const C4 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const C5 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const CODE_LEADING_ZEROS = "0012345";
const CODE_ZERO = "0";
const MGR_ONLY_CODE = "MGR-HIDDEN-CODE-UNIQUE";

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

type ClientCodeSnapshotInput = {
  code1c?: string | null;
  code1cProvided?: boolean;
  omitClientCodeBlock?: boolean;
};

function baseSnapshot(clientCode: ClientCodeSnapshotInput) {
  const snapshot: Record<string, unknown> = {
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
      primaryContract: null,
      mainAgreement: null,
      fieldPresence: { primaryContract: false, mainAgreement: false },
    },
    currentRetailOutlets: [],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
  if (!clientCode.omitClientCodeBlock) {
    snapshot.clientCode = {
      code1c: clientCode.code1c ?? null,
      fieldPresence: { code1c: clientCode.code1cProvided ?? false },
    };
  }
  return snapshot;
}

async function sqlCountCode1cFilled(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_clients
     WHERE (extended_snapshot->'clientCode'->'fieldPresence'->>'code1c') = 'true'
       AND NULLIF(BTRIM(extended_snapshot->'clientCode'->>'code1c'), '') IS NOT NULL`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

async function sqlCountCode1cEmpty(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_clients
     WHERE (extended_snapshot->'clientCode'->'fieldPresence'->>'code1c') = 'true'
       AND NULLIF(BTRIM(extended_snapshot->'clientCode'->>'code1c'), '') IS NULL`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("clients F5 client code (Код) integration", { concurrency: false }, () => {
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
      email: "admin-f5@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin F5",
      role: "admin",
    });
    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager-f5@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager F5",
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
      { guid_client: C1, name_client: "Client Code Match", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C2, name_client: "Client Code Zero", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C3, name_client: "Client Hidden Code", guid_manager: M2, name_manager: "Manager Two" },
      { guid_client: C4, name_client: "Client No Code Source", guid_manager: M1, name_manager: "Manager One" },
      { guid_client: C5, name_client: "Client Code Empty Explicit", guid_manager: M1, name_manager: "Manager One" },
    ]);
    await updateClientExtendedSnapshot(
      databaseUrl,
      C1,
      baseSnapshot({ code1c: CODE_LEADING_ZEROS, code1cProvided: true }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C2,
      baseSnapshot({ code1c: CODE_ZERO, code1cProvided: true }),
    );
    await updateClientExtendedSnapshot(
      databaseUrl,
      C3,
      baseSnapshot({ code1c: MGR_ONLY_CODE, code1cProvided: true }),
    );
    await updateClientExtendedSnapshot(databaseUrl, C4, baseSnapshot({ omitClientCodeBlock: true }));
    await updateClientExtendedSnapshot(
      databaseUrl,
      C5,
      baseSnapshot({ code1c: "", code1cProvided: true }),
    );
  });

  after(async () => {
    await closePool();
  });

  it("onecCode1c exact match preserves leading zeros", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(CODE_LEADING_ZEROS)}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C1);
    assert.equal(res.body.items[0]?.code1c?.label, CODE_LEADING_ZEROS);
    assert.equal(res.body.items[0]?.code1c?.value, CODE_LEADING_ZEROS);
  });

  it("onecCode1cContains matches substring", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get("/api/clients?view=all&entity=clients&onecCode1cContains=12345")
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C1);
  });

  it('exact onecCode1c="0" matches literal zero code', async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(CODE_ZERO)}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C2);
    assert.equal(res.body.items[0]?.code1c?.label, "0");
  });

  it("detail card exposes clientCode DTO block", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app).get(`/api/clients/${C1}`).set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended?.clientCode?.code1c?.label, CODE_LEADING_ZEROS);
    assert.equal(res.body.client.extended?.clientCode?.code1c?.value, CODE_LEADING_ZEROS);
  });

  it("filled=code1c treats literal zero as filled within manager scope", async () => {
    const cookie = await login("manager-f5@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients?view=all&entity=clients&filled=code1c").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    const guids = res.body.items.map((item: { guid: string }) => item.guid).sort();
    assert.deepEqual(guids, [C1, C2].sort());
  });

  it("filled=code1c excludes no-source and explicit empty; SQL count matches API", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients?view=all&entity=clients&filled=code1c").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, await sqlCountCode1cFilled(databaseUrl));
    assert.equal(res.body.total, 3);
    const guids = new Set(res.body.items.map((item: { guid: string }) => item.guid));
    assert.ok(guids.has(C1));
    assert.ok(guids.has(C2));
    assert.ok(guids.has(C3));
    assert.ok(!guids.has(C4));
    assert.ok(!guids.has(C5));
    const zeroItem = res.body.items.find((item: { guid: string }) => item.guid === C2);
    assert.equal(zeroItem?.code1c?.label, "0");
    assert.equal(zeroItem?.code1c?.value, "0");
  });

  it("empty=code1c matches only explicit empty, not omitted block", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients?view=all&entity=clients&empty=code1c").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, await sqlCountCode1cEmpty(databaseUrl));
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.guid, C5);
    assert.equal(res.body.items[0]?.code1c?.label, "Не заполнено");
    assert.equal(res.body.items[0]?.code1c?.hasSource, true);
    assert.equal(res.body.items[0]?.code1c?.value, null);
  });

  it("list and card DTO omit code1c when snapshot has no clientCode block", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const list = await request(app).get("/api/clients?view=all&entity=clients").set(authHeaders(cookie));
    const row = list.body.items.find((item: { guid: string }) => item.guid === C4);
    assert.ok(row);
    assert.equal(row.code1c, undefined);
    const card = await request(app).get(`/api/clients/${C4}`).set(authHeaders(cookie));
    assert.equal(card.status, 200);
    assert.equal(card.body.client.extended?.clientCode, null);
  });

  it("card DTO shows Не заполнено for explicit empty code1c", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app).get(`/api/clients/${C5}`).set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.extended?.clientCode?.code1c?.label, "Не заполнено");
    assert.equal(res.body.client.extended?.clientCode?.code1c?.hasSource, true);
    assert.equal(res.body.client.extended?.clientCode?.code1c?.value, null);
  });

  it("rejects code filters on entity=outlets", async () => {
    const cookie = await login("admin-f5@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients?view=all&entity=outlets&onecCode1cContains=123`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 400);
  });

  it("manager scope hides hidden-client code from list and detail", async () => {
    const cookie = await login("manager-f5@example.com");
    const app = await loadApp();
    const list = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(MGR_ONLY_CODE)}`)
      .set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);
    const detail = await request(app).get(`/api/clients/${C3}`).set(authHeaders(cookie));
    assert.equal(detail.status, 404);
  });

  it("preview-as-manager: own client F5 visible, foreign hidden, writes blocked", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin-f5@example.com");
    const managerUser = (
      await request(app)
        .get("/api/admin/access/preview/candidates?q=manager-f5")
        .set(authHeaders(adminCookie))
    ).body.items.find((item: { email: string }) => item.email === "manager-f5@example.com");
    assert.ok(managerUser);

    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: managerUser.id });
    assert.equal(start.status, 200);

    const ownCard = await request(app).get(`/api/clients/${C1}`).set(authHeaders(adminCookie));
    assert.equal(ownCard.status, 200);
    assert.equal(ownCard.body.client.extended?.clientCode?.code1c?.label, CODE_LEADING_ZEROS);

    const foreignList = await request(app)
      .get(`/api/clients?view=all&entity=clients&onecCode1c=${encodeURIComponent(MGR_ONLY_CODE)}`)
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
