import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { parseProductsJson } from "../../src/internal-catalog/model";
import { importSnapshot, loadSnapshot } from "../../src/internal-catalog/repository";
import { catalogueFixture, fixtureGuid } from "../helpers/internal-catalog-fixtures";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
const ORIGIN = "http://127.0.0.1:3000";
describe("internal catalogue API and import isolation", { concurrency: false }, () => {
  let pool: Pool, app: ReturnType<(typeof import("../../src/server"))["createApp"]>, cookie: string, staffCookie: string, deniedCookie: string, snapshotId: string;
  let imageRoot: string;
  const originalImageRoot = process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
  before(async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN); await prepareDatabase(databaseUrl); await resetPoolForTests();
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
    imageRoot = await mkdtemp(path.join(os.tmpdir(), "internal-catalog-api-images-"));
    await mkdir(path.join(imageRoot, "20240626"));
    await writeFile(path.join(imageRoot, "20240626/photo.jpg"),
      await sharp({ create: { width: 20, height: 10, channels: 3, background: "#426428" } }).jpeg().toBuffer());
    const admin = await createTestUser({ databaseUrl, email: "catalog-admin@test.local", fullName: "Catalog Admin", password: "StrongPass123!", role: "admin" });
    const staff = await createTestUser({ databaseUrl, email: "catalog-staff@test.local", fullName: "Catalog Staff", password: "StrongPass123!", role: "rop" });
    await linkUserToEmployee({ databaseUrl, userId: staff.id, employeeId: fixtureGuid(500), confirmedByUserId: admin.id });
    await createTestUser({ databaseUrl, email: "unlinked@test.local", fullName: "External User", password: "StrongPass123!", role: "manager" });
    app = (await import("../../src/server")).createApp();
    async function login(email: string) {
      const result = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email, password: "StrongPass123!" });
      assert.equal(result.status, 200);
      return (result.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    }
    cookie = await login("catalog-admin@test.local"); staffCookie = await login("catalog-staff@test.local"); deniedCookie = await login("unlinked@test.local");
  });
  after(async () => {
    if (originalImageRoot === undefined) delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
    else process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = originalImageRoot;
    if (imageRoot) await rm(imageRoot, { recursive: true, force: true });
    await closePool(); await pool?.end();
  });
  const get = (path: string) => request(app).get("/api/internal-catalog" + path).set("Cookie", cookie);
  it("has an explicit empty state before any import", async () => {
    const res = await get("/meta"); assert.equal(res.status, 200); assert.equal(res.body.snapshot, null);
    assert.equal((await get("/products")).body.total, 0);
  });
  it("does not leak catalogue existence or metadata to anonymous/unlinked external users", async () => {
    for (const path of ["/meta", "/products", "/products/" + fixtureGuid(1),
      "/products/" + fixtureGuid(1) + "/images/" + fixtureGuid(300)]) {
      assert.equal((await request(app).get("/api/internal-catalog" + path)).status, 401);
      const denied = await request(app).get("/api/internal-catalog" + path).set("Cookie", deniedCookie);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.snapshot, undefined);
    }
  });
  it("imports into separate tables, preserving existing XML state/counts exactly; same hash is a no-op", async () => {
    const before = await pool.query("SELECT * FROM onec_catalog_state");
    const count = await pool.query("SELECT COUNT(*) FROM onec_catalog_products");
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(catalogueFixture())));
    const result = await importSnapshot(pool, parsed, "synthetic.json", parsed.sha256);
    assert.equal(result.status, "imported"); snapshotId = result.snapshotId;
    const duplicate = await importSnapshot(pool, parsed, "same-content.json", parsed.sha256);
    assert.equal(duplicate.status, "unchanged"); assert.equal(duplicate.snapshotId, snapshotId);
    assert.deepEqual((await pool.query("SELECT * FROM onec_catalog_state")).rows, before.rows);
    assert.deepEqual((await pool.query("SELECT COUNT(*) FROM onec_catalog_products")).rows, count.rows);
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM internal_catalog_products")).rows[0].count), 30);
  });
  it("searches names, article, GUID, multiple words and ё without interpreting wildcards", async () => {
    const staffResult = await request(app).get("/api/internal-catalog/products").set("Cookie", staffCookie);
    assert.equal(staffResult.status, 200); assert.equal(staffResult.body.total, 30);
    for (const q of ["ЕЛКА", "100%_", "елка A/B", fixtureGuid(1)]) {
      const res = await get("/products").query({ q, version: snapshotId });
      assert.equal(res.status, 200); assert.equal(res.body.total, 1, q); assert.equal(res.body.items[0].guid, fixtureGuid(1));
    }
    assert.equal((await get("/products").query({ q: "ART-30" })).body.total, 1);
    assert.equal((await get("/products").query({ q: "несуществующий" })).body.total, 0);
    assert.equal((await get("/products").query({ q: "%" })).body.total, 1);
    assert.equal((await get("/products").query({ q: "_" })).body.total, 1);
  });
  it("combines filters, paginates deterministically, clamps an obsolete page", async () => {
    assert.equal((await get("/products").query({ section: fixtureGuid(100), brand: "Альфа" })).body.total, 15);
    assert.equal((await get("/products").query({ section: fixtureGuid(100), brand: "Бета" })).body.total, 0);
    const one = await get("/products"), two = await get("/products?page=2");
    assert.equal(one.body.items.length, 24); assert.equal(two.body.items.length, 6);
    assert.equal(new Set([...one.body.items, ...two.body.items].map(x => x.guid)).size, 30);
    assert.equal((await get("/products?page=999")).body.page, 2);
  });
  it("returns intact detail, rejects malformed queries and does not expose public import/file endpoints", async () => {
    const detail = await get("/products/" + fixtureGuid(1));
    assert.equal(detail.status, 200); assert.equal(detail.body.product.properties[2].value.length, 1024);
    assert.equal(detail.body.product.files[0].path, "20240626\\photo.jpg");
    assert.match(detail.headers["cache-control"], /no-store/);
    for (const path of ["/products?q[a]=x", "/products?section=bad", "/products?page=-1", "/products?version=bad", "/products?q=a+b+c+d+e+f+g+h+i"]) {
      assert.equal((await get(path)).status, 400, path);
    }
    assert.equal((await get("/products/" + fixtureGuid(999))).status, 404);
    assert.equal((await get("/products?version=" + fixtureGuid(999))).status, 404);
    assert.equal((await request(app).post("/api/internal-catalog/import").set("Cookie", cookie).send({})).status, 404);
  });
  it("serves photos only with opt-in source, existing access, product/file binding and pinned snapshot", async () => {
    const url = "/products/" + fixtureGuid(1) + "/images/" + fixtureGuid(300);
    assert.equal((await get("/meta")).body.imagesConfigured, false);
    assert.equal((await get(url)).status, 404);
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = imageRoot;
    try {
      assert.equal((await get("/meta")).body.imagesConfigured, true);
      const photo = await request(app).get("/api/internal-catalog" + url).set("Cookie", staffCookie).query({ version: snapshotId });
      assert.equal(photo.status, 200); assert.match(photo.headers["content-type"], /image\/webp/);
      assert.match(photo.headers["cache-control"], /no-store/);
      assert.equal(photo.headers["x-content-type-options"], "nosniff");
      assert.equal((await sharp(photo.body).metadata()).format, "webp");
      assert.equal((await get("/products/" + fixtureGuid(2) + "/images/" + fixtureGuid(300))).status, 404);
      assert.equal((await get(url.replace(fixtureGuid(300), fixtureGuid(301)))).status, 404);
      assert.equal((await get(url).query({ version: fixtureGuid(999) })).status, 404);
      assert.equal((await get(url).query({ version: "bad" })).status, 400);
      assert.equal((await get("/products/bad/images/" + fixtureGuid(300))).status, 400);
      assert.equal((await request(app).get("/api/internal-catalog" + url)).status, 401);
      assert.equal((await request(app).get("/api/internal-catalog" + url).set("Cookie", deniedCookie)).status, 403);
      await writeFile(path.join(imageRoot, "20240626/photo.jpg"), "<html>corrupt</html>");
      const unavailable = await get(url);
      assert.equal(unavailable.status, 404);
      assert.equal(JSON.stringify(unavailable.body).includes(imageRoot), false);
    } finally { delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR; }
  });
  it("pins reads to immutable snapshots and rejects mismatched hashes without partial changes", async () => {
    const products = catalogueFixture(); products[0].name = "Новая версия"; products[0].files = [];
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products)));
    await assert.rejects(importSnapshot(pool, parsed, "new.json", "0".repeat(64)), /HASH_MISMATCH/);
    assert.equal((await loadSnapshot(pool))?.id, snapshotId);
    const next = await importSnapshot(pool, parsed, "new.json", parsed.sha256);
    assert.notEqual(next.snapshotId, snapshotId);
    assert.equal((await get("/products/" + fixtureGuid(1)).query({ version: snapshotId })).body.product.name, "Ёлка 100%_ A/B");
    assert.equal((await get("/products/" + fixtureGuid(1))).body.product.name, "Новая версия");
    await writeFile(path.join(imageRoot, "20240626/photo.jpg"),
      await sharp({ create: { width: 20, height: 10, channels: 3, background: "#426428" } }).jpeg().toBuffer());
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = imageRoot;
    try {
      const image = "/products/" + fixtureGuid(1) + "/images/" + fixtureGuid(300);
      assert.equal((await get(image).query({ version: snapshotId })).status, 200);
      assert.equal((await get(image).query({ version: next.snapshotId })).status, 404);
    } finally { delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR; }
  });
  it("rolls back the new snapshot and every inserted row if a database write fails", async () => {
    const counts = () => pool.query("SELECT (SELECT COUNT(*) FROM internal_catalog_snapshots) AS versions,(SELECT COUNT(*) FROM internal_catalog_products) AS products");
    const before = (await counts()).rows, latest = (await loadSnapshot(pool))?.id;
    const products = catalogueFixture(); products[0].name = "Fault injection";
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products)));
    // The real parser would reject this. Inject an invalid row after parsing to exercise DB rollback.
    parsed.products[0].guid = "invalid-uuid";
    await assert.rejects(importSnapshot(pool, parsed, "fault.json", parsed.sha256));
    assert.deepEqual((await counts()).rows, before);
    assert.equal((await loadSnapshot(pool))?.id, latest);
  });
  it("rechecks a disabled account on every request, including an already issued session", async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    const user = await createTestUser({ databaseUrl, email: "catalog-disabled@test.local", fullName: "Disabled",
      password: "StrongPass123!", role: "admin" });
    const login = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({
      email: "catalog-disabled@test.local", password: "StrongPass123!",
    });
    assert.equal(login.status, 200);
    const session = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [user.id]);
    const result = await request(app).get("/api/internal-catalog/meta").set("Cookie", session);
    assert.equal(result.status, 401);
    assert.equal(result.body.snapshot, undefined);
    assert.equal((await request(app).get("/api/internal-catalog/products/" + fixtureGuid(1) +
      "/images/" + fixtureGuid(300)).set("Cookie", session)).status, 401);
  });
});
