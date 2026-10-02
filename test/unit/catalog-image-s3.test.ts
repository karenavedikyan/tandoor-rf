import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { s3PreviewKey, collectBoundedBody } from "../../src/catalog/image-s3";
import { safePhotoRelativePath } from "../../src/cli/catalog-photo-ftp-load";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { writeImmutablePreview, verifyStoredPreview, readStoredImage } from "../../src/catalog/image-storage";
import { createHash } from "node:crypto";

test("S3 paths are restricted to configured private bucket and hash layout", () => {
  const before = { ...process.env };
  Object.assign(process.env, { CATALOG_IMAGE_STORAGE_BACKEND: "s3",
    CATALOG_IMAGE_S3_BUCKET: "tandoor-rf-catalog", CATALOG_IMAGE_S3_ENDPOINT: "https://s3.twcstorage.ru",
    CATALOG_IMAGE_S3_ACCESS_KEY: "test", CATALOG_IMAGE_S3_SECRET_KEY: "test" });
  try {
    const hash = "a".repeat(64);
    assert.equal(s3PreviewKey(`s3://tandoor-rf-catalog/previews/aa/${hash}.webp`).hash, hash);
    for (const p of [`s3://other/previews/aa/${hash}.webp`, `s3://tandoor-rf-catalog/../key`,
      `s3://tandoor-rf-catalog/previews/bb/${hash}.webp`, "https://example.com/image"]) {
      assert.throws(() => s3PreviewKey(p));
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
});

test("S3 body reader rejects oversized, truncated and unknown size bodies", async () => {
  assert.equal((await collectBoundedBody(Readable.from([Buffer.from("ok")]), 2, 4)).toString(), "ok");
  await assert.rejects(collectBoundedBody(Readable.from([Buffer.from("abc")]), 2, 4));
  await assert.rejects(collectBoundedBody(Readable.from([Buffer.from("a")]), 2, 4));
  await assert.rejects(collectBoundedBody(Readable.from([Buffer.from("a")]), 0, 4));
});

test("FTP photo path preserves Cyrillic and blocks traversal, URLs and command injection", () => {
  assert.equal(safePhotoRelativePath("20220425\\A\\Дверь.jpg"), "20220425/A/Дверь.jpg");
  for (const p of ["../a", "/etc/a", "C:\\a", "https://example.org/a", "a\r\nDELE x", "a/./b", "\\..\\a"]) {
    assert.throws(() => safePhotoRelativePath(p));
  }
});

test("private S3 publication verifies readback; corrupt and missing objects fail closed", async () => {
  const before = { ...process.env };
  Object.assign(process.env, { CATALOG_IMAGE_STORAGE_BACKEND: "s3",
    CATALOG_IMAGE_S3_BUCKET: "tandoor-rf-catalog", CATALOG_IMAGE_S3_ENDPOINT: "https://s3.twcstorage.ru",
    CATALOG_IMAGE_S3_ACCESS_KEY: "test", CATALOG_IMAGE_S3_SECRET_KEY: "test" });
  const objects = new Map<string, Buffer>();
  const stub = mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.Bucket, "tandoor-rf-catalog");
      assert.equal(command.input.ACL, undefined);
      objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const b = objects.get(command.input.Key!);
      if (!b) throw new Error("NoSuchKey");
      return { Body: Readable.from([b]), ContentLength: b.length };
    }
    return {};
  });
  try {
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).webp().toBuffer();
    const hash = createHash("sha256").update(buffer).digest("hex");
    const storagePath = await writeImmutablePreview("s3://tandoor-rf-catalog", hash, buffer);
    assert.equal((await verifyStoredPreview(storagePath, hash)).ok, true);
    assert.deepEqual(await readStoredImage(storagePath), buffer);
    const key = s3PreviewKey(storagePath).key;
    objects.set(key, Buffer.from("corrupt"));
    assert.equal((await verifyStoredPreview(storagePath, hash)).ok, false);
    objects.clear();
    assert.equal((await verifyStoredPreview(storagePath, hash)).ok, false);
  } finally {
    stub.mock.restore();
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
});
