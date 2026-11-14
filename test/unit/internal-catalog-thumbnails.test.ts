import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { Pool } from "pg";
import sharp from "sharp";
import { makeThumbnails, readThumbnail, thumbnailStatus } from "../../src/internal-catalog/thumbnails";

describe("persistent catalogue thumbnail encoding", () => {
  it("makes two bounded WebP sizes without crop/upscale or metadata", async () => {
    const source = await sharp({ create: { width: 1912, height: 4180, channels: 3,
      background: "#426428" } }).jpeg().withMetadata().toBuffer();
    const result = await makeThumbnails(source); assert.ok(result);
    for (const [name, edge, limit] of [["small", 240, 32768], ["list", 640, 131072]] as const) {
      const bytes = result[name], meta = await sharp(bytes).metadata();
      assert.equal(meta.format, "webp"); assert.equal(meta.height, edge);
      assert.ok(meta.width! < edge); assert.equal(meta.exif, undefined);
      assert.ok(bytes.length < limit);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), result[`${name}Hash`]);
    }
    const tiny = await sharp({ create: { width: 10, height: 20, channels: 3, background: "#fff" } }).png().toBuffer();
    assert.equal((await sharp((await makeThumbnails(tiny))!.list).metadata()).height, 20);
  });
  it("rejects corrupt and unsupported input", async () => {
    assert.equal(await makeThumbnails(Buffer.from("broken")), null);
    assert.equal(await makeThumbnails(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(await makeThumbnails(Buffer.alloc(0)), null);
  });
  it("reads stored bytes without a decoder/source and checks integrity/path/size", async () => {
    const bytes = Buffer.from("stored-synthetic-bytes"), sha = createHash("sha256").update(bytes).digest("hex");
    const calls: unknown[][] = [];
    let rows = [{ bytes, sha256: sha }];
    const db = { query: async (...args: unknown[]) => { calls.push(args); return { rows }; } } as unknown as Pool;
    assert.deepEqual(await readThumbnail(db, "snapshot", "folder\\photo.jpg", "small"), bytes);
    assert.deepEqual((calls[0][1] as string[]).slice(0, 2), ["snapshot", "folder/photo.jpg"]);
    assert.equal(await readThumbnail(db, "snapshot", "../private.jpg", "small"), null);
    assert.equal(calls.length, 1);
    rows = [{ bytes, sha256: "0".repeat(64) }];
    assert.equal(await readThumbnail(db, "snapshot", "photo.jpg", "list"), null);
    rows = [{ bytes: Buffer.alloc(32769), sha256: sha }];
    assert.equal(await readThumbnail(db, "snapshot", "photo.jpg", "small"), null);
  });
  it("keeps old photos if the additive migration has not been applied; does not hide other database errors", async () => {
    const db = { query: async () => { throw Object.assign(new Error("missing"), { code: "42P01" }); } } as unknown as Pool;
    assert.equal((await thumbnailStatus(db, "snapshot")).enabled, false);
    const broken = { query: async () => { throw new Error("database down"); } } as unknown as Pool;
    await assert.rejects(thumbnailStatus(broken, "snapshot"), /database down/);
  });
});
