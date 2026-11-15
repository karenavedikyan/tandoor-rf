import assert from "node:assert/strict";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { CATALOG_REFERENCE_MAX_SOURCE_BYTES, withTemporaryCatalogSource } from "../../src/catalog/temporary-source";
import { CatalogImageDeferred } from "../../src/catalog/image-deferred";

describe("private bounded catalogue source staging", () => {
  afterEach(async () => {
    assert.deepEqual((await readdir(os.tmpdir())).filter(name => name.startsWith(`catalog-source-${process.pid}-`)), []);
  });
  it("streams an original larger than the upload cap without retaining its chunks", async () => {
    const part = Buffer.alloc(65536, 42), count = 145;
    let sourcePath = "", accounted = 0;
    const result = await withTemporaryCatalogSource(part.length * count, async target => {
      for (let i = 0; i < count; i++)
        await new Promise<void>((resolve, reject) => target.write(part, error => error ? reject(error) : resolve()));
      target.end();
    }, async file => {
      sourcePath = file;
      assert.equal((await lstat(file)).mode & 0o777, 0o600);
      assert.equal((await lstat(path.dirname(file))).mode & 0o777, 0o700);
      assert.equal((await lstat(file)).size, part.length * count);
      return "consumed";
    }, bytes => { accounted += bytes; });
    assert.equal(result, "consumed");
    assert.equal(accounted, part.length * count);
    await assert.rejects(access(sourcePath), { code: "ENOENT" });
  });
  it("checks invalid announced lengths before opening a source", async () => {
    for (const expected of [0, -1, NaN, Infinity, 1.5, CATALOG_REFERENCE_MAX_SOURCE_BYTES + 1]) {
      let downloaded = false;
      await assert.rejects(withTemporaryCatalogSource(expected, async () => { downloaded = true; },
        async () => "must not consume"), CatalogImageDeferred);
      assert.equal(downloaded, false);
    }
  });
  it("defers incomplete or growing transfers without consuming them", async () => {
    for (const actual of [2, 4]) {
      let consumed = false;
      await assert.rejects(withTemporaryCatalogSource(3, async target => {
        await new Promise<void>((resolve, reject) => target.end(Buffer.alloc(actual),
          (error?: Error | null) => error ? reject(error) : resolve()));
      }, async () => { consumed = true; }), CatalogImageDeferred);
      assert.equal(consumed, false);
    }
  });
  it("removes source bytes after a consumer failure and does not change them", async () => {
    let sourcePath = "";
    await assert.rejects(withTemporaryCatalogSource(3, async target => {
      target.end(Buffer.from("abc"));
    }, async file => {
      sourcePath = file;
      assert.equal((await readFile(file)).toString(), "abc");
      throw Error("consumer failure");
    }), /consumer failure/);
    await assert.rejects(access(sourcePath), { code: "ENOENT" });
  });
  it("settles a transfer error without leaving an open file or invoking the consumer", async () => {
    let consumed = false;
    await assert.rejects(withTemporaryCatalogSource(3, async target => {
      target.write(Buffer.from("a"));
      throw new CatalogImageDeferred();
    }, async () => { consumed = true; }), CatalogImageDeferred);
    assert.equal(consumed, false);
  });
});
