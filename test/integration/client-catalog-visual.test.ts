import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { runCatalogImageSync } from "../../src/catalog/image-sync";
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
const CLIENT_TWO = "44444444-4444-4444-8444-444444444444";

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

function catalogWithFilters(): ReturnType<typeof buildMinimalDistributionXmlSet> {
  const xmlSet = buildMinimalDistributionXmlSet();
  xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
    "<Свойства>",
    `<Свойства>
      <Свойство Код="brand" Название="Бренд" Значение="Tandoor"/>
      <Свойство Код="series" Название="Серия" Значение="Classic"/>`,
  );
  return xmlSet;
}

describe("client catalog visual API integration", { concurrency: false }, () => {
  let databaseUrl = "";
  let adminUserId = "";
  let managerUserId = "";
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
        address: "Москва",
        telephone: ["+7"],
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Бета Клиент",
        guid_manager: "33333333-3333-4333-8333-333333333333",
        name_manager: "Менеджер Петров",
        address: "СПб",
        telephone: ["+7"],
      },
    ]);
    const applied = await applyDistributionXml(databaseUrl, catalogWithFilters());
    versionId = applied.versionId;
  });

  after(async () => {
    await closePool();
  });

  it("returns hierarchical sections tree", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/sections-tree?versionId=${versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, "ready");
    assert.ok(Array.isArray(res.body.tree));
    const root = res.body.tree.find((node: { code: string }) => node.code === "s1");
    assert.ok(root);
    assert.ok(root.children.some((child: { code: string }) => child.code === "s2"));
  });

  it("returns facets and filters products by brand with counts", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const facets = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/facets?versionId=${versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(facets.status, 200);
    assert.ok(facets.body.total >= 1);
    const brandFacet = facets.body.facets.find((item: { key: string }) => item.key === "brand");
    assert.ok(brandFacet);
    assert.ok(brandFacet.values.some((entry: { value: string }) => entry.value === "Tandoor"));

    const filtered = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/catalog/products?filterBrand=Tandoor&versionId=${versionId}`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.items[0].code, "p1");
    assert.equal(filtered.body.items[0].keyProperties.length >= 1, true);
  });

  it("expands parent section to child products without duplicates", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/catalog/products?section=s1&versionId=${versionId}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    const codes = res.body.items.map((item: { code: string }) => item.code);
    assert.ok(codes.includes("p1"));
    assert.equal(new Set(codes).size, codes.length);
  });

  it("returns 409 for stale version on facets and sections-tree", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const staleId = "00000000-0000-4000-8000-000000000001";
    for (const suffix of ["facets", "sections-tree"]) {
      const res = await request(app)
        .get(`/api/clients/${CLIENT_ONE}/catalog/${suffix}?versionId=${staleId}`)
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(res.status, 409, suffix);
      assert.equal(res.body.code, "CATALOG_VERSION_CHANGED");
    }
  });

  it("enforces access on visual endpoints", async () => {
    const cookie = await login("manager@example.com");
    const app = await loadApp();
    for (const suffix of ["sections-tree", "facets", "media/not-a-uuid"]) {
      const own = await request(app)
        .get(`/api/clients/${CLIENT_ONE}/catalog/${suffix}`)
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(own.status, suffix.startsWith("media") ? 400 : 200, `own ${suffix}`);

      const foreign = await request(app)
        .get(`/api/clients/${CLIENT_TWO}/catalog/${suffix}`)
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(foreign.status, 404, `foreign ${suffix}`);
    }
  });

  it("syncs images dry-run and apply with security checks", async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-src-"));
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-store-"));
    const imagePath = "images/p1.jpg";
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
      0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    await fs.writeFile(path.join(sourceDir, imagePath), png);

    process.env.CATALOG_IMAGE_SOURCE_DIR = sourceDir;
    process.env.CATALOG_IMAGE_STORAGE_DIR = storageDir;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      const dry = await runCatalogImageSync(client, { apply: false });
      assert.equal(dry.mode, "dry_run");
      assert.equal(dry.filesPrepared, 1);

      const apply = await runCatalogImageSync(client, { apply: true });
      assert.equal(apply.filesPrepared, 1);

      const asset = await client.query<{ id: string }>(
        `SELECT id::text FROM onec_catalog_image_assets WHERE source_path = $1`,
        [imagePath],
      );
      const assetId = asset.rows[0]!.id;

      const adminCookie = await login("admin@example.com");
      const managerCookie = await login("manager@example.com");
      const app = await loadApp();
      const media = await request(app)
        .get(`/api/clients/${CLIENT_ONE}/catalog/media/${assetId}`)
        .set({ Origin: ORIGIN, Cookie: adminCookie });
      assert.equal(media.status, 200);
      assert.equal(media.headers["content-type"], "image/png");
      assert.equal(media.headers["cache-control"], "no-store");

      const foreign = await request(app)
        .get(`/api/clients/${CLIENT_TWO}/catalog/media/${assetId}`)
        .set({ Origin: ORIGIN, Cookie: managerCookie });
      assert.equal(foreign.status, 404);

      await fs.writeFile(path.join(sourceDir, imagePath), Buffer.from("broken"));
      const bad = await runCatalogImageSync(client, { apply: true });
      assert.ok(bad.filesFailed >= 1);
    } finally {
      client.release();
      await pool.end();
      delete process.env.CATALOG_IMAGE_SOURCE_DIR;
      delete process.env.CATALOG_IMAGE_STORAGE_DIR;
    }
  });
});
