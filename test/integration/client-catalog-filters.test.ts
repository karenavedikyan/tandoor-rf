import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
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

async function applyDistributionXml(
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

function catalogWithColorFilterValues(): ReturnType<typeof buildMinimalDistributionXmlSet> {
  const xmlSet = buildMinimalDistributionXmlSet();
  xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
    "<Свойства>",
    `<Свойства><Свойство Код="color" Название="Цвет" Значение="Белый, матовый"/>`,
  );
  return xmlSet;
}

describe("client catalog filter contract integration", { concurrency: false }, () => {
  let databaseUrl = "";
  let versionId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    const adminUserId = (
      await createTestUser({
        databaseUrl,
        email: "admin@example.com",
        password: TEST_PASSWORD,
        fullName: "Admin User",
        role: "admin",
      })
    ).id;
    const managerUserId = (
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
        address: "Москва",
        telephone: ["+7"],
      },
    ]);
    const applied = await applyDistributionXml(databaseUrl, catalogWithColorFilterValues());
    versionId = applied.versionId;
  });

  after(async () => {
    await closePool();
  });

  it("matches comma-containing filter values exactly", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/products?versionId=${versionId}&filterColor=${encodeURIComponent("Белый, матовый")}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].code, "p1");
  });

  it("returns 422 when requested filter property is absent in snapshot", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    for (const suffix of ["products", "facets"]) {
      const res = await request(app)
        .get(
          `/api/clients/${CLIENT_ONE}/catalog/${suffix}?versionId=${versionId}&filterOpening=Left`,
        )
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(res.status, 422, suffix);
      assert.equal(res.body.code, "CATALOG_FILTER_UNAVAILABLE");
      assert.deepEqual(res.body.filters, ["opening"]);
    }
  });

  it("searches facet values beyond the first page", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/facet-values?versionId=${versionId}&facetKey=color&facetQ=мат`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.ok(res.body.values.some((item: { value: string }) => item.value === "Белый, матовый"));
  });

  it("keeps facets and product totals aligned for comma-containing values", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const color = encodeURIComponent("Белый, матовый");
    const products = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/products?versionId=${versionId}&filterColor=${color}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(products.status, 200);
    const facets = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/facets?versionId=${versionId}&filterColor=${color}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(facets.status, 200);
    assert.equal(facets.body.total, products.body.total);
    const colorFacet = facets.body.facets.find((item: { key: string }) => item.key === "color");
    assert.ok(colorFacet);
    const matched = colorFacet.values.find(
      (item: { value: string }) => item.value === "Белый, матовый",
    );
    assert.ok(matched);
    assert.equal(matched.count, products.body.total);
  });
});
