import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { parseProductsJson } from "../../src/internal-catalog/model";
import { prepareThumbnails } from "../../src/internal-catalog/prepare-thumbnails";
import { importSnapshot } from "../../src/internal-catalog/repository";
import { catalogueFixture, fixtureGuid } from "../helpers/internal-catalog-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

describe("bounded catalogue photo path reads (isolated synthetic PostgreSQL)", { concurrency: false }, () => {
  let pool: Pool, snapshot: string, source: Buffer, recordsBefore: string;
  let pages: string[][] = [], failPage = 0;
  const products = catalogueFixture(140).map((p, i) => ({
    ...p,
    properties: p.properties.map(prop => prop.name === "Описание" ?
      { ...prop, value: "Wide synthetic catalogue description. ".repeat(1024) } : prop),
    files: [{ guid: fixtureGuid(10000 + i), name: "Photo", path: `p${String(i).padStart(3, "0")}.jpg` }],
  }));
  products[0].files[0].path = "folder\\shared.jpg";
  products[139].files.push({ guid: fixtureGuid(11000), name: "Shared", path: "folder/shared.jpg" });
  for (const [i, path] of ["Зима/дверь.jpg", "\ue000.jpg", "😀.jpg"].entries()) {
    products[139].files.push({ guid: fixtureGuid(11001 + i), name: "Unicode photo", path });
  }
  const expectedPaths = [...new Set(products.flatMap(p => p.files.map(f => f.path.replace(/\\/g, "/"))))]
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

  // Observe the real PostgreSQL result contract, not a simulated SQL implementation.
  // A regression to SELECT record fails even with a tiny --max-files limit.
  const observedPool = {
    connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, key) {
          if (key !== "query") return Reflect.get(target, key);
          return async (sql: string, values?: unknown[]) => {
            const page = /SELECT path FROM paths/.test(sql);
            if (page && failPage && pages.length + 1 === failPage) throw new Error("SYNTHETIC_PAGE_FAILURE");
            const result = await target.query(sql, values);
            assert.ok(!result.fields.some(field => field.name === "record"), "must not load product JSON");
            if (page) {
              assert.deepEqual(result.fields.map(f => f.name), ["path"]);
              assert.equal(values?.[2], 64);
              assert.ok(result.rows.length <= 64);
              pages.push(result.rows.map(row => row.path));
            }
            return result;
          };
        },
      }) as PoolClient;
    },
  } as unknown as Pool;
  const fingerprint = async () => (await pool.query(
    "SELECT md5(string_agg(record::text,'' ORDER BY guid)) AS hash FROM internal_catalog_products")).rows[0].hash;

  before(async () => {
    const url = getIntegrationDatabaseUrl(); setIntegrationEnv(url);
    await prepareDatabase(url);
    pool = new Pool({ connectionString: url, max: 3 });
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products)));
    snapshot = (await importSnapshot(pool, parsed, "synthetic-wide.json", parsed.sha256)).snapshotId;
    recordsBefore = await fingerprint();
    source = await sharp({ create: { width: 20, height: 40, channels: 3, background: "#426428" } }).jpeg().toBuffer();
  });
  after(async () => { await pool?.end(); });

  it("reads only one bounded path page for a three-file dry-run, without writes", async () => {
    pages = [];
    const calls: string[] = [];
    const result = await prepareThumbnails(observedPool, { apply: false, maxFiles: 3,
      readSource: async path => { calls.push(path); return source; } });
    assert.equal(result.total, expectedPaths.length);
    assert.equal(result.attempted, 3); assert.equal(result.prepared, 3);
    assert.equal(result.visitedAll, false);
    assert.deepEqual(calls, expectedPaths.slice(0, 3));
    assert.equal(pages.length, 1); assert.equal(pages[0].length, 64);
    assert.equal(Number((await pool.query("SELECT count(*) FROM internal_catalog_thumbnails")).rows[0].count), 0);
    assert.equal(await fingerprint(), recordsBefore);
  });

  it("traverses all pages once with normalized deduplication and stable Unicode ordering", async () => {
    pages = [];
    const calls: string[] = [];
    const result = await prepareThumbnails(observedPool, { apply: false, maxFiles: 1000,
      readSource: async path => { calls.push(path); return source; } });
    assert.equal(result.visitedAll, true);
    assert.equal(result.attempted, expectedPaths.length);
    assert.deepEqual(calls, expectedPaths);
    assert.deepEqual(pages.flat(), expectedPaths);
    assert.deepEqual(pages.map(page => page.length), [64, 64, expectedPaths.length - 128]);
    assert.equal(calls.filter(path => path === "folder/shared.jpg").length, 1);
  });

  it("resumes past two pages of ready sources and attempts only three new files", async () => {
    const first = await prepareThumbnails(observedPool, { apply: true, maxFiles: 128, readSource: async () => source });
    assert.equal(first.prepared, 128);
    pages = [];
    const calls: string[] = [];
    const resumed = await prepareThumbnails(observedPool, { apply: true, maxFiles: 3,
      readSource: async path => { calls.push(path); return source; } });
    assert.equal(resumed.skipped, 128);
    assert.equal(resumed.attempted, 3); assert.equal(resumed.prepared, 3);
    assert.equal(resumed.visitedAll, false); assert.equal(resumed.status.ready, 131);
    assert.deepEqual(calls, expectedPaths.slice(128, 131));
    assert.equal(pages.length, 3);
    assert.equal(await fingerprint(), recordsBefore);
  });

  it("releases the connection and advisory lock if a later page query fails", async () => {
    pages = []; failPage = 2;
    try {
      await assert.rejects(prepareThumbnails(observedPool, { apply: false, maxFiles: 1000,
        readSource: async () => source }), /SYNTHETIC_PAGE_FAILURE/);
    } finally { failPage = 0; }
    const client = await pool.connect();
    try {
      assert.equal((await client.query("SELECT pg_try_advisory_lock(718332020) AS ok")).rows[0].ok, true);
      await client.query("SELECT pg_advisory_unlock(718332020)");
    } finally { client.release(); }
  });

  it("reports a complete pass for exactly one full page at the attempt limit", async () => {
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products.slice(0, 64))));
    const current = await importSnapshot(pool, parsed, "synthetic-page.json", parsed.sha256);
    assert.notEqual(current.snapshotId, snapshot);
    pages = [];
    const result = await prepareThumbnails(observedPool, { apply: true, maxFiles: 64, readSource: async () => source });
    assert.equal(result.attempted, 64); assert.equal(result.visitedAll, true);
    assert.deepEqual(pages.map(page => page.length), [64, 0]);
    assert.equal(result.status.enabled, true);
  });

  it("does not fetch a path page or read a source when the time budget is exhausted", async () => {
    pages = [];
    let calls = 0;
    const result = await prepareThumbnails(observedPool, { apply: false, maxFiles: 3, maxRunMs: 0,
      readSource: async () => { calls++; return source; } });
    assert.equal(result.attempted, 0); assert.equal(result.visitedAll, false);
    assert.equal(calls, 0); assert.equal(pages.length, 0);
  });
});
