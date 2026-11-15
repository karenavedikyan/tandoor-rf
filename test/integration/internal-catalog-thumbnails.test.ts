import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, describe, it, mock } from "node:test";
import { Client } from "basic-ftp";
import { Pool } from "pg";
import request from "supertest";
import sharp from "sharp";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { importSnapshot } from "../../src/internal-catalog/repository";
import { parseProductsJson } from "../../src/internal-catalog/model";
import { prepareThumbnails } from "../../src/internal-catalog/prepare-thumbnails";
import { readThumbnail, thumbnailStatus } from "../../src/internal-catalog/thumbnails";
import { catalogueFixture, fixtureGuid } from "../helpers/internal-catalog-fixtures";
import { CatalogImageDeferred } from "../../src/catalog/image-deferred";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

describe("durable catalogue thumbnails (isolated synthetic PostgreSQL)", { concurrency: false }, () => {
  let pool: Pool, snapshot: string, source: Buffer, cookie: string;
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  let recordsBefore: string, sourceCalls = 0;
  const products = catalogueFixture(4);
  products[1].files = [{ guid: fixtureGuid(301), name: "Second", path: "second.jpg" }];
  products[2].files = [{ guid: fixtureGuid(302), name: "Missing", path: "missing.jpg" }];
  products[3].files = [{ guid: fixtureGuid(303), name: "Shared", path: "20240626/photo.jpg" }];
  const path = (n = 1, file = 300, size = "small") =>
    `/api/internal-catalog/products/${fixtureGuid(n)}/images/${fixtureGuid(file)}?version=${snapshot}&preview=${size}`;
  before(async () => {
    const url = getIntegrationDatabaseUrl(); setIntegrationEnv(url);
    await prepareDatabase(url); await resetPoolForTests();
    pool = new Pool({ connectionString: url, max: 3 });
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products)));
    snapshot = (await importSnapshot(pool, parsed, "synthetic.json", parsed.sha256)).snapshotId;
    recordsBefore = JSON.stringify((await pool.query("SELECT guid,record FROM internal_catalog_products ORDER BY guid")).rows);
    source = await sharp({ create: { width: 800, height: 1600, channels: 3, background: "#426428" } }).jpeg().toBuffer();
    await createTestUser({ databaseUrl: url, email: "thumb-admin@test.local", fullName: "Admin",
      password: "StrongPass123!", role: "admin" });
    app = (await import("../../src/server")).createApp();
    const login = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000")
      .send({ email: "thumb-admin@test.local", password: "StrongPass123!" });
    assert.equal(login.status, 200); cookie = login.headers["set-cookie"][0].split(";")[0];
  });
  after(async () => { await pool?.end(); await closePool(); });
  const readSource = async (relative: string) => { sourceCalls++; return relative === "missing.jpg" ? null : source; };
  const rows = async () => Number((await pool.query("SELECT count(*) FROM internal_catalog_thumbnails")).rows[0].count);
  it("dry-run validates and deduplicates sources without writes", async () => {
    let beforeFiles = 0;
    const result = await prepareThumbnails(pool, { apply: false, maxFiles: 10, readSource,
      beforeFile: () => { beforeFiles++; } });
    assert.equal(beforeFiles, 3);
    assert.equal(result.total, 3); assert.equal(result.attempted, 3);
    assert.equal(result.prepared, 2); assert.equal(result.unavailable, 1);
    assert.equal(result.visitedAll, true); assert.equal(await rows(), 0);
    assert.equal(result.status.enabled, false);
  });
  it("bounded apply is resumable and keeps the old frontend until the full pass", async () => {
    const result = await prepareThumbnails(pool, { apply: true, maxFiles: 1, readSource });
    assert.equal(result.prepared, 1); assert.equal(await rows(), 1);
    assert.equal(result.status.enabled, false);
    const meta = await request(app).get("/api/internal-catalog/meta").set("Cookie", cookie);
    assert.equal(meta.status, 200); assert.equal(meta.body.thumbnailsReady, false);
    const image = await request(app).get(path()).set("Cookie", cookie);
    assert.equal(image.status, 200); assert.match(image.headers["content-type"], /image\/webp/);
    assert.equal((await sharp(image.body).metadata()).height, 240);
    assert.match(image.headers["cache-control"], /no-store/);
  });
  it("resumes, records unavailable sources and survives a new database connection", async () => {
    const result = await prepareThumbnails(pool, { apply: true, maxFiles: 10, readSource });
    assert.equal(result.skipped, 1); assert.equal(result.prepared, 1);
    assert.equal(result.unavailable, 1); assert.equal(result.status.enabled, true);
    assert.equal(result.status.ready, 2); assert.equal(await rows(), 3);
    const fresh = new Pool({ connectionString: getIntegrationDatabaseUrl(), max: 1 });
    try {
      const bytes = await readThumbnail(fresh, snapshot, products[0].files[0].path, "list");
      assert.ok(bytes); assert.equal((await sharp(bytes).metadata()).height, 640);
    } finally { await fresh.end(); }
    const meta = await request(app).get("/api/internal-catalog/meta").set("Cookie", cookie);
    assert.equal(meta.body.thumbnailsReady, true);
    // The same path belongs to two original SKUs; neither original record is rewritten.
    assert.equal((await request(app).get(path(4, 303)).set("Cookie", cookie)).status, 200);
    assert.equal((await request(app).get(path(3, 302)).set("Cookie", cookie)).status, 404);
    assert.equal(JSON.stringify((await pool.query("SELECT guid,record FROM internal_catalog_products ORDER BY guid")).rows), recordsBefore);
  });
  it("serves only the authorized bound file and validates parameters without source reads", async () => {
    const before = sourceCalls;
    assert.equal((await request(app).get(path())).status, 401);
    for (const size of ["original", "small&preview=list", "../private"]) {
      assert.equal((await request(app).get(path(1, 300, size)).set("Cookie", cookie)).status, 400);
    }
    assert.equal((await request(app).get(path(1, 301)).set("Cookie", cookie)).status, 404);
    assert.equal((await request(app).get(path(1, 300).replace(snapshot, fixtureGuid(999))).set("Cookie", cookie)).status, 404);
    const access = mock.method(Client.prototype, "access", async () => { throw new Error("NO_FTP_DURING_GET"); });
    try {
      for (const size of ["small", "list"]) assert.equal(
        (await request(app).get(path(1, 300, size)).set("Cookie", cookie)).status, 200);
      assert.equal(access.mock.callCount(), 0);
    } finally { access.mock.restore(); }
    assert.equal(sourceCalls, before); assert.equal(await rows(), 3);
  });
  it("skips known unavailable sources unless explicitly retried", async () => {
    sourceCalls = 0;
    const skipped = await prepareThumbnails(pool, { apply: true, maxFiles: 10, readSource });
    assert.equal(sourceCalls, 0); assert.equal(skipped.skipped, 2);
    const result = await prepareThumbnails(pool, { apply: true, maxFiles: 10, retryFailed: true,
      readSource: async () => { sourceCalls++; return source; } });
    assert.equal(sourceCalls, 1); assert.equal(result.prepared, 1);
    assert.equal(result.status.ready, 3); assert.equal(result.status.unavailable, 0);
  });
  it("detects corrupt bytes and repairs only the affected derived entry", async () => {
    await pool.query("UPDATE internal_catalog_thumbnails SET small_bytes=$1 WHERE source_path=$2",
      [Buffer.from("corrupt"), "second.jpg"]);
    assert.equal(await readThumbnail(pool, snapshot, "second.jpg", "small"), null);
    const result = await prepareThumbnails(pool, { apply: true, maxFiles: 10, readSource });
    assert.equal(result.attempted, 1); assert.equal(result.prepared, 1);
    const bytes = await readThumbnail(pool, snapshot, "second.jpg", "small"); assert.ok(bytes);
    assert.equal((await sharp(bytes).metadata()).format, "webp");
  });
  it("rejects overlapping batches and invalid limits", async () => {
    const lock = await pool.connect();
    try {
      await lock.query("SELECT pg_advisory_lock(718332020)");
      await assert.rejects(prepareThumbnails(pool, { apply: true, maxFiles: 1, readSource }), /PREPARATION_RUNNING/);
    } finally { await lock.query("SELECT pg_advisory_unlock(718332020)"); lock.release(); }
    await assert.rejects(prepareThumbnails(pool, { apply: true, maxFiles: 0 }), /INVALID_LIMIT/);
  });
  it("keeps a deferred source pending and releases the preparation lock", async () => {
    await pool.query("DELETE FROM internal_catalog_thumbnails WHERE source_path='second.jpg'");
    const before = await rows();
    await assert.rejects(prepareThumbnails(pool, { apply: true, maxFiles: 3,
      readSource: async () => { throw new CatalogImageDeferred(); } }), CatalogImageDeferred);
    assert.equal(await rows(), before);
    assert.equal((await thumbnailStatus(pool, snapshot)).unavailable, 0);
    const lock = await pool.connect();
    try {
      assert.equal((await lock.query("SELECT pg_try_advisory_lock(718332020) AS ok")).rows[0].ok, true);
      await lock.query("SELECT pg_advisory_unlock(718332020)");
    } finally { lock.release(); }
    assert.equal((await prepareThumbnails(pool, { apply: true, maxFiles: 3, readSource })).prepared, 1);
  });
  it("serializes native JPEG work across database clients and releases the lease after success", async () => {
    const jpeg = await sharp({ create: { width: 40, height: 80, channels: 3, background: "#426428" } })
      .jpeg({ progressive: true }).toBuffer();
    // The TSX + HTTP integration runner itself can exceed the real 160 MiB
    // admission threshold. Exercise a separate CLI-sized process, not a bypass.
    const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", "-e",
      `const {processCatalogReferenceToPreview}=require('./src/catalog/image-storage');
       const {closePool}=require('./src/db/pool');
       processCatalogReferenceToPreview(Buffer.from('${jpeg.toString("base64")}','base64'))
         .then(v=>console.log(v.ok?'ready':'invalid'),e=>console.log(e.message)).finally(closePool);`],
      { timeout: 15_000, env: { DATABASE_URL: getIntegrationDatabaseUrl(),
        PGSSLMODE: "disable", NODE_ENV: "test", PATH: process.env.PATH } });
    const lock = await pool.connect();
    try {
      await lock.query("SELECT pg_advisory_lock(718332021)");
      assert.equal((await run()).stdout.trim(), "CATALOG_IMAGE_DEFERRED");
    } finally { await lock.query("SELECT pg_advisory_unlock(718332021)"); lock.release(); }
    assert.equal((await run()).stdout.trim(), "ready");
    const check = await pool.connect();
    try {
      assert.equal((await check.query("SELECT pg_try_advisory_lock(718332021) AS ok")).rows[0].ok, true);
      await check.query("SELECT pg_advisory_unlock(718332021)");
    } finally { check.release(); }
  });
  it("uses the verified list image for the full gallery when source decoding is deferred", async () => {
    const env = { ...process.env };
    Object.assign(process.env, { INTERNAL_CATALOG_IMAGE_BACKEND: "shared",
      ONEC_FTP_ENABLED: "true", ONEC_FTP_HOST: "synthetic.invalid", ONEC_FTP_USER: "synthetic",
      ONEC_FTP_PASSWORD: "synthetic-not-a-credential", ONEC_FTP_BASE_PATH: "/LC", ONEC_FTP_SECURITY: "plain" });
    delete process.env.CATALOG_IMAGE_STORAGE_DIR;
    const access = mock.method(Client.prototype, "access", async () => { throw new CatalogImageDeferred(); });
    try {
      const url = path().split("&preview=")[0];
      assert.equal((await request(app).get(url)).status, 401);
      assert.equal(access.mock.callCount(), 0);
      const result = await request(app).get(url).set("Cookie", cookie);
      assert.equal(result.status, 200);
      assert.equal(result.headers["x-catalog-image-preview"], "list");
      assert.match(result.headers["content-type"], /image\/webp/);
      assert.equal((await sharp(result.body).metadata()).height, 640);
      assert.equal(result.headers["retry-after"], undefined);
      assert.equal((await request(app).get(path(1, 301).split("&preview=")[0]).set("Cookie", cookie)).status, 404);
      assert.equal((await request(app).get(url.replace(snapshot, fixtureGuid(999))).set("Cookie", cookie)).status, 404);
      assert.equal(JSON.stringify((await pool.query("SELECT guid,record FROM internal_catalog_products ORDER BY guid")).rows), recordsBefore);
    } finally {
      access.mock.restore();
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
      Object.assign(process.env, env);
    }
  });
  it("uses a verified list image when the original is absent without attempting an import", async () => {
    const env = { ...process.env };
    delete process.env.INTERNAL_CATALOG_IMAGE_BACKEND;
    delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
    const access = mock.method(Client.prototype, "access", async () => { throw new Error("NO_FTP"); });
    try {
      const result = await request(app).get(path().split("&preview=")[0]).set("Cookie", cookie);
      assert.equal(result.status, 200);
      assert.equal(result.headers["x-catalog-image-preview"], "list");
      assert.equal((await sharp(result.body).metadata()).height, 640);
      assert.equal(access.mock.callCount(), 0);
      await pool.query("ALTER TABLE internal_catalog_thumbnails RENAME TO thumbnail_schema_not_applied");
      try {
        assert.equal((await request(app).get(path().split("&preview=")[0]).set("Cookie", cookie)).status, 404);
      } finally {
        await pool.query("ALTER TABLE thumbnail_schema_not_applied RENAME TO internal_catalog_thumbnails");
      }
    } finally {
      access.mock.restore();
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
      Object.assign(process.env, env);
    }
  });
  it("keeps retryable 503 when neither the original nor a valid prepared list is available", async () => {
    const env = { ...process.env };
    Object.assign(process.env, { INTERNAL_CATALOG_IMAGE_BACKEND: "shared",
      ONEC_FTP_ENABLED: "true", ONEC_FTP_HOST: "synthetic.invalid", ONEC_FTP_USER: "synthetic",
      ONEC_FTP_PASSWORD: "synthetic-not-a-credential", ONEC_FTP_BASE_PATH: "/LC", ONEC_FTP_SECURITY: "plain" });
    delete process.env.CATALOG_IMAGE_STORAGE_DIR;
    const access = mock.method(Client.prototype, "access", async () => { throw new CatalogImageDeferred(); });
    const saved = (await pool.query("SELECT list_bytes FROM internal_catalog_thumbnails WHERE source_path=$1",
      ["20240626/photo.jpg"])).rows[0].list_bytes;
    await pool.query("UPDATE internal_catalog_thumbnails SET list_bytes=$1 WHERE source_path=$2",
      [Buffer.from("corrupt"), "20240626/photo.jpg"]);
    try {
      const result = await request(app).get(path().split("&preview=")[0]).set("Cookie", cookie);
      assert.equal(result.status, 503); assert.equal(result.headers["retry-after"], "3");
      assert.equal(result.body.error.code, "IMAGE_RETRY_LATER");
      assert.doesNotMatch(JSON.stringify(result.body), /synthetic|password|ftp|private/i);
      assert.equal(result.headers["x-catalog-image-preview"], undefined);
    } finally {
      await pool.query("UPDATE internal_catalog_thumbnails SET list_bytes=$1 WHERE source_path=$2",
        [saved, "20240626/photo.jpg"]);
      access.mock.restore();
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
      Object.assign(process.env, env);
    }
  });
  it("stops before publishing if the active snapshot changes during source reading", async () => {
    const parsed = parseProductsJson(Buffer.from(JSON.stringify([{ ...products[0], name: "New snapshot" }])));
    const current = await importSnapshot(pool, parsed, "new.json", parsed.sha256);
    const before = await rows();
    const result = await prepareThumbnails(pool, { apply: true, maxFiles: 10, readSource: async () => {
      const next = parseProductsJson(Buffer.from(JSON.stringify([{ ...products[0], name: "Newest snapshot" }])));
      await importSnapshot(pool, next, "newest.json", next.sha256); return source;
    } });
    assert.equal(result.snapshotId, current.snapshotId); assert.equal(result.snapshotChanged, true);
    assert.equal(await rows(), before);
    assert.equal((await thumbnailStatus(pool, current.snapshotId)).enabled, false);
    assert.equal(createHash("sha256").update(source).digest("hex").length, 64);
  });
});
