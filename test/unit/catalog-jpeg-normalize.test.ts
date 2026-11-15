import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import sharp from "sharp";
import { normalizeProgressiveJpeg, withNormalizedJpeg } from "../../src/catalog/jpeg-normalize";
import { CatalogImageDeferred, isImageResourceError } from "../../src/catalog/image-deferred";
import { createPhotoCache } from "../../src/internal-catalog/shared-images";

const runtime = { acquireLease: async () => async () => {} };
describe("isolated lossless progressive JPEG normalization", () => {
  it("keeps baseline JPEG/PNG on the original path, without a child or lease", async () => {
    const bytes = Buffer.from("unchanged");
    const acquireLease = async () => { throw Error("must not acquire"); };
    assert.equal(await normalizeProgressiveJpeg(bytes, { format: "jpeg", isProgressive: false }, { acquireLease }), bytes);
    assert.equal(await normalizeProgressiveJpeg(bytes, { format: "png" }, { acquireLease }), bytes);
  });
  it("produces sequential JPEG losslessly, preserving ICC, EXIF orientation and original bytes", async () => {
    const input = await sharp({ create: { width: 96, height: 180, channels: 3, background: "#427268" } })
      .jpeg({ progressive: true, chromaSubsampling: "4:4:4" }).withMetadata({ orientation: 6 }).toBuffer();
    const before = createHash("sha256").update(input).digest("hex");
    const meta = await sharp(input).metadata();
    assert.equal(meta.isProgressive, true);
    const output = await normalizeProgressiveJpeg(input, meta, runtime); assert.ok(output);
    const result = await sharp(output).metadata();
    assert.equal(result.isProgressive, false); assert.equal(result.orientation, 6);
    assert.deepEqual(result.icc, meta.icc);
    assert.equal(result.width, meta.width); assert.equal(result.height, meta.height);
    assert.deepEqual(await sharp(output).raw().toBuffer(), await sharp(input).raw().toBuffer());
    assert.equal(createHash("sha256").update(input).digest("hex"), before);
  });
  it("releases the lease and defers on missing executable without exposing subprocess errors", async () => {
    let released = 0;
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .jpeg({ progressive: true }).toBuffer();
    await assert.rejects(normalizeProgressiveJpeg(input, await sharp(input).metadata(), {
      acquireLease: async () => async () => { released++; },
      spawn: ((_command: string, _args: string[], options: object) =>
        spawn("/no-such-catalogue-jpeg-tool", [], options)) as typeof spawn,
    }), { name: "Error", message: "CATALOG_IMAGE_DEFERRED" });
    assert.equal(released, 1);
  });
  it("kills a stalled child and releases the lease on timeout", async () => {
    let released = 0, childPid: number | undefined;
    await assert.rejects(normalizeProgressiveJpeg(Buffer.from("fixture"), {
      format: "jpeg", isProgressive: true, width: 8, height: 8, channels: 3,
    }, {
      timeoutMs: 30, acquireLease: async () => async () => { released++; },
      spawn: ((_command: string, _args: string[], options: object) => {
        const child = spawn(process.execPath, ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], options);
        childPid = child.pid; return child;
      }) as typeof spawn,
    }), CatalogImageDeferred);
    assert.equal(released, 1);
    if (childPid) assert.throws(() => process.kill(childPid!, 0), { code: "ESRCH" });
  });
  it("does not classify decoder memory exhaustion as a corrupt source", async () => {
    await assert.rejects(normalizeProgressiveJpeg(Buffer.from("fixture"), {
      format: "jpeg", isProgressive: true, width: 8, height: 8, channels: 3,
    }, { ...runtime, spawn: ((_command: string, _args: string[], options: object) =>
      spawn(process.execPath, ["-e", 'process.stderr.write("Insufficient memory");process.exit(1)'], options)) as typeof spawn,
    }), CatalogImageDeferred);
  });
  it("rejects an invalid JPEG without publishing bytes", async () => {
    assert.equal(await normalizeProgressiveJpeg(Buffer.from("broken"), {
      format: "jpeg", isProgressive: true, width: 8, height: 8, channels: 3,
    }, runtime), null);
  });
  it("does not negative-cache a temporary resource failure", async () => {
    const cache = createPhotoCache();
    await assert.rejects(cache("same-photo", async () => { throw new CatalogImageDeferred(); }), CatalogImageDeferred);
    const bytes = Buffer.from("ready");
    assert.equal(await cache("same-photo", async () => bytes), bytes);
  });
  it("defers cache capacity and queue timeout without negative-caching the photo", async () => {
    for (const options of [{ maxPending: 1 }, { maxPending: 2, waitMs: 5 }]) {
      const cache = createPhotoCache({ concurrency: 1, ...options });
      let finish!: (bytes: Buffer) => void;
      const first = cache("first", () => new Promise<Buffer>(resolve => { finish = resolve; }));
      await assert.rejects(cache("second", async () => Buffer.from("second")), CatalogImageDeferred);
      finish(Buffer.from("first")); await first;
      assert.equal((await cache("second", async () => Buffer.from("second")))?.toString(), "second");
    }
  });
  it("classifies lease connection failures as deferred, not a missing image", async () => {
    await assert.rejects(normalizeProgressiveJpeg(Buffer.from("fixture"), {
      format: "jpeg", isProgressive: true,
    }, { acquireLease: async () => { throw new Error("private database connection"); } }),
    { message: "CATALOG_IMAGE_DEFERRED" });
  });
  it("separates resource and decoder deadlines from malformed image errors", () => {
    for (const message of ["Image processing timeout.", "timeout: 10 seconds", "timed out",
      "bad_alloc", "VipsJpeg: out of memory", "memory allocation failed"])
      assert.equal(isImageResourceError(new Error(message)), true, message);
    assert.equal(isImageResourceError(Object.assign(new Error("native failure"), { code: "ENOMEM" })), true);
    assert.equal(isImageResourceError(new Error("Input buffer contains unsupported image format")), false);
  });
  it("holds the scratch-buffer lease through consumption and releases it after consumer errors", async () => {
    const input = await sharp({ create: { width: 16, height: 32, channels: 3, background: "#427268" } })
      .jpeg({ progressive: true }).toBuffer();
    const metadata = await sharp(input).metadata();
    let entered!: () => void, finish!: () => void, released = 0;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const lease = { acquireLease: async () => async () => { released++; } };
    const first = withNormalizedJpeg(input, metadata, async bytes => {
      const hash = createHash("sha256").update(bytes).digest("hex");
      entered(); await gate;
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      return "finished";
    }, lease);
    await started;
    assert.equal(released, 0);
    await assert.rejects(normalizeProgressiveJpeg(input, metadata, lease), CatalogImageDeferred);
    finish(); assert.equal(await first, "finished"); assert.equal(released, 1);
    await assert.rejects(withNormalizedJpeg(input, metadata, async () => { throw Error("consumer failed"); }, lease),
      /consumer failed/);
    assert.equal(released, 2);
    assert.ok(await normalizeProgressiveJpeg(input, metadata, lease));
    assert.equal(released, 3);
  });
});
