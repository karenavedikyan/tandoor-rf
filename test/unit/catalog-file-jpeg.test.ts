import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import sharp from "sharp";
import { withNormalizedJpegFile } from "../../src/catalog/jpeg-normalize";
import { processCatalogReferenceFileToPreview, processCatalogReferenceToPreview, processImageToPreview } from "../../src/catalog/image-storage";
import { CatalogImageDeferred } from "../../src/catalog/image-deferred";
import { CATALOG_REFERENCE_MAX_SOURCE_BYTES } from "../../src/catalog/temporary-source";

describe("file-backed catalogue JPEG", { concurrency: false }, () => {
  let directory: string, sourcePath: string;
  const runtime = { acquireLease: async () => async () => {} };
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "catalog-file-test-"));
    sourcePath = path.join(directory, "source.jpg");
  });
  afterEach(async () => {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
    assert.deepEqual((await readdir(os.tmpdir())).filter(name => name.startsWith(`catalog-normalized-${process.pid}-`)), []);
  });
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  it("normalizes losslessly on disk with private permissions and preserves the original", async () => {
    const input = await sharp({ create: { width: 96, height: 180, channels: 3, background: "#427268" } })
      .jpeg({ progressive: true, chromaSubsampling: "4:4:4" }).withMetadata({ orientation: 6 }).toBuffer();
    await writeFile(sourcePath, input);
    const metadata = await sharp(input).metadata();
    let normalizedPath = "";
    assert.equal(await withNormalizedJpegFile(sourcePath, metadata, async file => {
      normalizedPath = file;
      assert.equal((await lstat(file)).mode & 0o777, 0o600);
      assert.equal((await lstat(path.dirname(file))).mode & 0o777, 0o700);
      const output = await sharp(file).metadata();
      assert.equal(output.isProgressive, false);
      assert.equal(output.orientation, 6);
      assert.deepEqual(output.icc, metadata.icc);
      assert.deepEqual(await sharp(file).raw().toBuffer(), await sharp(input).raw().toBuffer());
      return "consumed";
    }, runtime), "consumed");
    assert.equal(digest(await readFile(sourcePath)), digest(input));
    await assert.rejects(access(normalizedPath), { code: "ENOENT" });
  });
  it("holds one shared media lease for file consumption and cleans up after consumer errors", async () => {
    const input = await sharp({ create: { width: 16, height: 32, channels: 3, background: "#427268" } })
      .jpeg({ progressive: true }).toBuffer();
    await writeFile(sourcePath, input);
    let released = 0, normalizedPath = "";
    const lease = { acquireLease: async () => async () => { released++; } };
    await assert.rejects(withNormalizedJpegFile(sourcePath, await sharp(input).metadata(), async file => {
      normalizedPath = file;
      assert.equal(released, 0);
      await assert.rejects(withNormalizedJpegFile(sourcePath, {}, async () => {}, lease), CatalogImageDeferred);
      throw Error("consumer failed");
    }, lease), /consumer failed/);
    assert.equal(released, 1);
    await assert.rejects(access(normalizedPath), { code: "ENOENT" });
  });
  it("keeps file byte limits separate from upload/reference-buffer limits", async () => {
    await writeFile(sourcePath, "");
    await truncate(sourcePath, CATALOG_REFERENCE_MAX_SOURCE_BYTES + 1);
    assert.equal((await processCatalogReferenceFileToPreview(sourcePath)).ok, false);
    const largeBuffer = Buffer.alloc(8 * 1024 * 1024 + 1);
    assert.equal((await processCatalogReferenceToPreview(largeBuffer)).ok, false);
    assert.equal((await processImageToPreview(largeBuffer)).ok, false);
  });
  it("rejects catalogue files above 32 MP or 8192 px without widening the 24 MP buffer policy", async () => {
    const aboveBufferPixels = await sharp({ create: {
      width: 4000, height: 7000, channels: 3, background: "#ffffff",
    } }).jpeg().toBuffer();
    assert.equal((await processCatalogReferenceToPreview(aboveBufferPixels)).ok, false);
    for (const [width, height] of [[8000, 4001], [8193, 1]]) {
      await sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).jpeg().toFile(sourcePath);
      assert.equal((await processCatalogReferenceFileToPreview(sourcePath)).ok, false);
    }
  });
  it("defers absent or symlinked temporary files instead of publishing unavailable", async () => {
    await assert.rejects(processCatalogReferenceFileToPreview(sourcePath), CatalogImageDeferred);
    await writeFile(path.join(directory, "target"), "source");
    await symlink(path.join(directory, "target"), sourcePath);
    await assert.rejects(processCatalogReferenceFileToPreview(sourcePath), CatalogImageDeferred);
  });
  it("defers file decoding when Node RSS is already above the unchanged 160 MiB cap", async () => {
    const input = await sharp({ create: { width: 16, height: 32, channels: 3, background: "#427268" } }).png().toBuffer();
    await writeFile(sourcePath, input);
    const original = process.memoryUsage.bind(process);
    mock.method(process, "memoryUsage", () => ({ ...original(), rss: 161 * 1024 * 1024 }));
    await assert.rejects(processCatalogReferenceFileToPreview(sourcePath), CatalogImageDeferred);
  });
  it("rejects a corrupt progressive JPEG without consuming a partial normalized file", async () => {
    await writeFile(sourcePath, "broken");
    let consumed = false;
    assert.equal(await withNormalizedJpegFile(sourcePath, {
      format: "jpeg", isProgressive: true, width: 8, height: 8, channels: 3,
    }, async () => { consumed = true; }, runtime), null);
    assert.equal(consumed, false);
    assert.equal((await readFile(sourcePath)).toString(), "broken");
  });
  it("kills a stalled file normalizer and releases the lease without consuming output", async () => {
    await writeFile(sourcePath, "fixture");
    let released = 0, pid: number | undefined, consumed = false;
    await assert.rejects(withNormalizedJpegFile(sourcePath, {
      format: "jpeg", isProgressive: true, width: 8, height: 8, channels: 3,
    }, async () => { consumed = true; }, {
      timeoutMs: 30, acquireLease: async () => async () => { released++; },
      spawn: ((_command: string, _args: string[], options: object) => {
        const child = spawn(process.execPath, ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], options);
        pid = child.pid; return child;
      }) as typeof spawn,
    }), CatalogImageDeferred);
    assert.equal(released, 1); assert.equal(consumed, false);
    if (pid) assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  });
  it("caps normalized output at 64 MiB before the file consumer runs", async () => {
    await writeFile(sourcePath, "fixture");
    let consumed = false;
    await assert.rejects(withNormalizedJpegFile(sourcePath, {
      format: "jpeg", isProgressive: true, width: 8, height: 8, channels: 3,
    }, async () => { consumed = true; }, {
      ...runtime,
      spawn: ((_command: string, _args: string[], options: object) =>
        spawn(process.execPath, ["-e",
          "process.stdin.resume();const b=Buffer.alloc(65536);let n=0;function write(){while(n++<1040){if(!process.stdout.write(b)){process.stdout.once('drain',write);return}}process.stdout.end()}write();",
        ], options)) as typeof spawn,
    }), CatalogImageDeferred);
    assert.equal(consumed, false);
  });
});
