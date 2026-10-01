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
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
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

async function seedDistributionCatalog(databaseUrl: string): Promise<void> {
  const xmlSet = buildMinimalDistributionXmlSet();
  xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
    'Группа="g1"',
    'Группа="ghost-group"',
  );
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
}

describe("client catalog API integration", { concurrency: false }, () => {
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
    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
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
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?q=p1`)
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
});
