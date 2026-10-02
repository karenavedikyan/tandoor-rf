import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import {
  createDelegationRecord,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "33333333-3333-4333-8333-333333333333";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "44444444-4444-4444-8444-444444444444";
const UNKNOWN_CLIENT = "00000000-0000-4000-8000-000000000099";
async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
}

async function applyDistributionFromXml(
  databaseUrl: string,
  xmlSet: ReturnType<typeof buildMinimalDistributionXmlSet>,
): Promise<{ versionId: string }> {
  const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
  const parsed = await parseCatalogSet(
    entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    "distribution",
  );
  assert.equal(parsed.ok, true);
  const validated = validateCatalogSet(parsed.data!, { profile: "distribution" });
  assert.equal(validated.ok, true);
  const applied = await applyCatalogImport(databaseUrl, validated.data!);
  assert.equal(applied.ok, true);
  return { versionId: applied.versionId };
}

async function seedDistributionCatalog(databaseUrl: string): Promise<{ versionId: string }> {
  const xmlSet = buildMinimalDistributionXmlSet();
  xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
    'Группа="g1"',
    'Группа="ghost-group"',
  );
  return applyDistributionFromXml(databaseUrl, xmlSet);
}

async function seedPagedCatalog(databaseUrl: string): Promise<void> {
  const xmlSet = buildMinimalDistributionXmlSet();
  const baseProducts = xmlSet["catalog/products/data.xml"].replace(
    "</Товары>",
    `<Товар Код="dup-a" Группа="g1" Активность="Y" Название="Same name">
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
  <Товар Код="dup-b" Группа="ghost-group" Активность="Y" Название="Same name">
    <Разделы><Раздел Код="s2"/></Разделы>
  </Товар>
  <Товар Код="dup-c" Группа="g1" Активность="Y" Название="Same name">
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар></Товары>`,
  );
  xmlSet["catalog/products/data.xml"] = baseProducts.replace(
    'Группа="g1"',
    'Группа="ghost-group"',
    1,
  );
  await applyDistributionFromXml(databaseUrl, xmlSet);
}

describe("client catalog API integration", { concurrency: false }, () => {
  let databaseUrl = "";
  let adminUserId = "";
  let managerUserId = "";

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
    managerUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager User",
        role: "manager",
      })
    ).id;
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUserId,
      employeeId: MANAGER_A,
      confirmedByUserId: adminUserId,
    });
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Альфа Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "Москва, ул. Пример 1",
        telephone: ["+7 (999) 000-11-22"],
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Бета Клиент",
        guid_manager: MANAGER_B,
        name_manager: "Менеджер Петров",
        address: "Санкт-Петербург, ул. Пример 2",
        telephone: ["+7 (999) 000-33-44"],
      },
    ]);
    await seedDistributionCatalog(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("returns catalog meta for authorized client reader", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, "ready");
    assert.ok(res.body.versionId);
    assert.equal(res.body.distributionReady, true);
    assert.equal(res.body.classificationIncomplete, true);
    assert.ok(Array.isArray(res.body.sections));
    assert.equal(res.body.outletConfirmed, false);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("searches products and preserves missing group references", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?q=Product`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, "ready");
    assert.ok(res.body.total >= 1);
    const p1 = res.body.items.find((item: { code: string }) => item.code === "p1");
    assert.ok(p1);
    assert.equal(p1.groupCode, "ghost-group");
    assert.equal(p1.groupStatus, "missing_reference");
  });

  it("loads product detail with properties on demand", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const meta = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    const list = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?q=p1&versionId=${meta.body.versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    const detail = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products/p1?versionId=${meta.body.versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.product.code, "p1");
    assert.ok(detail.body.product.properties.length >= 1);
    assert.equal(detail.body.selectionPersisted, false);
    assert.equal(list.body.items[0]?.code, "p1");
  });

  it("blocks anonymous and unknown client access", async () => {
    const app = await loadApp();
    const anon = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN });
    assert.equal(anon.status, 401);

    const cookie = await login("admin@example.com");
    const missing = await request(app)
      .get(`/api/clients/${UNKNOWN_CLIENT}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers["cache-control"], "no-store");
    assert.equal(missing.body.error?.code, "NOT_FOUND");
  });

  it("returns empty state when active catalog is absent", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`
      UPDATE onec_catalog_state SET active_version_id = NULL WHERE id = 1;
      UPDATE onec_catalog_versions SET is_active = FALSE;
    `);
    await pool.end();

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, "empty");
    assert.equal(res.body.versionId, null);
  });

  it("allows linked manager to read own client catalog on all endpoints", async () => {
    const cookie = await login("manager@example.com");
    const app = await loadApp();
    const meta = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(meta.status, 200);
    assert.equal(meta.headers["cache-control"], "no-store");

    const list = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?versionId=${meta.body.versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    assert.ok(list.body.total >= 1);

    const detail = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products/p1?versionId=${meta.body.versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.product.code, "p1");
  });

  it("denies manager access to foreign client without leaking data", async () => {
    const cookie = await login("manager@example.com");
    const app = await loadApp();
    for (const suffix of ["meta", "products", "products/p1"]) {
      const res = await request(app)
        .get(`/api/clients/${CLIENT_TWO}/catalog/${suffix}`)
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(res.status, 404, suffix);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(res.body.error?.code, "NOT_FOUND");
    }
  });

  it("denies manager after employee link is revoked on all catalog endpoints", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid`,
      [managerUserId],
    );
    await pool.end();

    const cookie = await login("manager@example.com");
    const app = await loadApp();
    for (const suffix of ["meta", "products", "products/p1"]) {
      const res = await request(app)
        .get(`/api/clients/${CLIENT_ONE}/catalog/${suffix}`)
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(res.status, 403, suffix);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.ok(!res.body.versionId);
      assert.ok(!res.body.product);
      assert.ok(!res.body.items);
    }
  });

  it("denies assistant after delegation expires on all catalog endpoints", async () => {
    const assistantUserId = (
      await createTestUser({
        databaseUrl,
        email: "assistant@example.com",
        password: TEST_PASSWORD,
        fullName: "Assistant User",
        role: "assistant",
      })
    ).id;
    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerUserId,
      assistantUserId,
      clientGuids: [CLIENT_ONE],
      status: "active",
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() - 3_600_000).toISOString(),
      approvedByUserId: adminUserId,
    });

    const cookie = await login("assistant@example.com");
    const app = await loadApp();
    for (const suffix of ["meta", "products", "products/p1"]) {
      const res = await request(app)
        .get(`/api/clients/${CLIENT_ONE}/catalog/${suffix}`)
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(res.status, 403, suffix);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.ok(!res.body.versionId);
      assert.ok(!res.body.product);
      assert.ok(!res.body.items);
    }
  });

  it("returns 404 for missing product while client access remains", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const meta = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(meta.status, 200);

    const missing = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products/missing-product-code`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers["cache-control"], "no-store");
    assert.equal(missing.body.error?.code, "NOT_FOUND");

    const metaAfter = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(metaAfter.status, 200);
    assert.ok(metaAfter.body.versionId);
  });

  it("returns 409 when list versionId does not match active catalog", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const metaBefore = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    const firstVersionId = metaBefore.body.versionId as string;

    const xmlSet = buildMinimalDistributionXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"]
      .replace('Группа="g1"', 'Группа="ghost-group"')
      .replace('Название="Product one"', 'Название="Product one updated"');
    const second = await applyDistributionFromXml(databaseUrl, xmlSet);

    const stale = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?versionId=${firstVersionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "CATALOG_VERSION_CHANGED");
    assert.equal(stale.body.currentVersionId, second.versionId);

    const current = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?versionId=${second.versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(current.status, 200);
  });

  it("rejects invalid query parameters with 400", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const invalidPage = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?page=1abc`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(invalidPage.status, 400);
    assert.equal(invalidPage.headers["cache-control"], "no-store");

    const invalidVersion = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?versionId=not-a-uuid`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(invalidVersion.status, 400);
  });

  it("filters by section and paginates without duplicates or missing groups", async () => {
    await seedPagedCatalog(databaseUrl);
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const meta = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/meta`)
      .set({ Origin: ORIGIN, Cookie: cookie });

    const sectionOne = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/products?q=Same&section=s1&pageSize=1&page=1&versionId=${meta.body.versionId}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(sectionOne.status, 200);
    assert.equal(sectionOne.body.total, 3);
    assert.equal(sectionOne.body.items.length, 1);

    const sectionOnePageTwo = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/products?q=Same&section=s1&pageSize=1&page=2&versionId=${meta.body.versionId}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(sectionOnePageTwo.body.items.length, 1);
    assert.notEqual(sectionOne.body.items[0].code, sectionOnePageTwo.body.items[0].code);

    const sectionTwo = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/products?q=Same&section=s2&versionId=${meta.body.versionId}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(sectionTwo.body.total, 1);
    assert.equal(sectionTwo.body.items[0].code, "dup-b");
    assert.equal(sectionTwo.body.items[0].groupStatus, "missing_reference");
  });

  it("treats percent and underscore as literal search characters", async () => {
    const xmlSet = buildMinimalDistributionXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
      "</Товары>",
      `<Товар Код="pct" Группа="g1" Активность="Y" Название="100% скидка"/>
  <Товар Код="us" Группа="g1" Активность="Y" Название="model_x"/>
  <Товар Код="plain" Группа="g1" Активность="Y" Название="plain product"/></Товары>`,
    );
    await applyDistributionFromXml(databaseUrl, xmlSet);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const percent = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?q=${encodeURIComponent("100%")}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(percent.status, 200);
    assert.equal(percent.body.total, 1);
    assert.equal(percent.body.items[0].code, "pct");

    const underscore = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?q=_`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(underscore.status, 200);
    assert.equal(underscore.body.total, 1);
    assert.equal(underscore.body.items[0].code, "us");
  });
});
