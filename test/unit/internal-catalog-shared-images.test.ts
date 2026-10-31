import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Client } from "basic-ftp";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import sharp from "sharp";
import { readFtpPhoto } from "../../src/internal-catalog/ftp-image";
import { createPhotoCache, readExistingCatalogPhoto } from "../../src/internal-catalog/shared-images";
import { internalCatalogImagesConfigured, readInternalCatalogImage } from "../../src/internal-catalog/images";

describe("internal catalogue shared photo source", { concurrency: false }, () => {
  let saved: NodeJS.ProcessEnv, jpeg: Buffer, webp: Buffer, root: string;
  beforeEach(async () => {
    saved = { ...process.env };
    Object.assign(process.env, { ONEC_FTP_ENABLED: "true", ONEC_FTP_HOST: "ftp.test.local",
      ONEC_FTP_USER: "test", ONEC_FTP_PASSWORD: "synthetic-secret", ONEC_FTP_BASE_PATH: "/LC",
      ONEC_FTP_SECURITY: "plain", INTERNAL_CATALOG_IMAGE_BACKEND: "shared" });
    delete process.env.CATALOG_IMAGE_STORAGE_BACKEND;
    delete process.env.CATALOG_IMAGE_MAX_BYTES;
    root = await mkdtemp(path.join(os.tmpdir(), "catalog-shared-"));
    process.env.CATALOG_IMAGE_STORAGE_DIR = root;
    jpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#426428" } }).jpeg().toBuffer();
    webp = await sharp(jpeg).webp().toBuffer();
  });
  afterEach(async () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(root, { recursive: true, force: true });
  });
  function fake(bytes = jpeg, expected = bytes.length) {
    const paths: string[] = [];
    let closed = false, downloaded = false;
    const client = {
      access: async () => {},
      size: async (remote: string) => { paths.push(remote); return expected; },
      downloadTo: async (target: Writable, remote: string) => {
        paths.push(remote); downloaded = true;
        target.on("error", () => {});
        await new Promise<void>((resolve, reject) => target.end(bytes,
          (error?: Error | null) => error ? reject(error) : resolve()));
      },
      close: () => { closed = true; },
    };
    return { client: client as unknown as Client, paths, closed: () => closed, downloaded: () => downloaded };
  }
  it("reads only a normalized path under the fixed FTP photo root and closes the client", async () => {
    const ftp = fake();
    const bytes = await readFtpPhoto("20250915\\Фото 1.jpg", () => ftp.client);
    assert.ok(bytes);
    assert.deepEqual(ftp.paths, ["/s3/IMG/20250915/Фото 1.jpg", "/s3/IMG/20250915/Фото 1.jpg"]);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "webp"); assert.equal(meta.width, 20); assert.equal(meta.exif, undefined);
    assert.equal(ftp.closed(), true);
  });
  it("rejects unsafe paths before opening a connection, including FTP command injection", async () => {
    let clients = 0;
    for (const value of ["../private.jpg", "/photo.jpg", "C:\\photo.jpg", "https://evil/photo.jpg",
      "a/./x.png", "a/../../x.jpg", "x.jpg\r\nDELE x", "x.svg", "\\\\host\\x.jpg"]) {
      assert.equal(await readFtpPhoto(value, () => { clients++; return fake().client; }), null);
    }
    assert.equal(clients, 0);
    process.env.ONEC_FTP_ENABLED = "false";
    assert.equal(await readFtpPhoto("ok.jpg", () => { clients++; return fake().client; }), null);
    assert.equal(clients, 0);
  });
  it("rejects invalid announced sizes without downloading", async () => {
    for (const size of [0, -1, NaN, Infinity, 1.5, 8 * 1024 * 1024 + 1]) {
      const ftp = fake(jpeg, size);
      assert.equal(await readFtpPhoto("photo.jpg", () => ftp.client), null);
      assert.equal(ftp.downloaded(), false); assert.equal(ftp.closed(), true);
    }
  });
  it("rejects corrupt, truncated and growing transfers without leaking upstream errors", async () => {
    for (const ftp of [fake(Buffer.from("<html>private error</html>")), fake(jpeg, jpeg.length + 1),
      fake(jpeg, jpeg.length - 1)]) {
      assert.equal(await readFtpPhoto("photo.jpg", () => ftp.client), null);
      assert.equal(ftp.closed(), true);
    }
    const ftp = fake();
    ftp.client.access = async () => { throw new Error("synthetic-secret/private/path"); };
    assert.equal(await readFtpPhoto("photo.jpg", () => ftp.client), null);
    assert.equal(ftp.closed(), true);
  });
  it("enforces an overall transfer deadline and closes a stalled connection", async () => {
    const ftp = fake();
    ftp.client.access = () => new Promise(() => {});
    assert.equal(await readFtpPhoto("photo.jpg", () => ftp.client, 10), null);
    assert.equal(ftp.closed(), true);
  });
  function db(rows: unknown[]) {
    const calls: unknown[][] = [];
    return {
      calls,
      pool: { query: async (...args: unknown[]) => { calls.push(args); return { rows }; } } as unknown as Pool,
    };
  }
  it("reuses a ready private preview by exact source path with a single SELECT and hash verification", async () => {
    const stored = path.join(root, "preview.webp");
    await writeFile(stored, webp);
    const database = db([{ storage_path: stored, content_sha256: createHash("sha256").update(webp).digest("hex"), mime_type: "image/webp" }]);
    const bytes = await readExistingCatalogPhoto(database.pool, "20250915\\Фото 1.jpg");
    assert.ok(bytes); assert.equal((await sharp(bytes).metadata()).format, "webp");
    assert.equal(database.calls.length, 1);
    assert.match(String(database.calls[0][0]), /^\s*SELECT/);
    assert.deepEqual(database.calls[0][1], [["20250915/Фото 1.jpg", "20250915\\Фото 1.jpg"]]);
  });
  it("does not read a file outside configured private storage or accept a mismatched hash", async () => {
    const stored = path.join(root, "preview.webp");
    await writeFile(stored, webp);
    assert.equal(await readExistingCatalogPhoto(db([{ storage_path: stored, content_sha256: "0".repeat(64), mime_type: "image/webp" }]).pool, "photo.jpg"), null);
    process.env.CATALOG_IMAGE_STORAGE_DIR = path.join(root, "different-root");
    assert.equal(await readExistingCatalogPhoto(db([{ storage_path: stored,
      content_sha256: createHash("sha256").update(webp).digest("hex"), mime_type: "image/webp" }]).pool, "photo.jpg"), null);
  });
  it("uses existing storage first through the catalogue adapter, without invoking FTP", async () => {
    const stored = path.join(root, "preview.webp");
    await writeFile(stored, webp);
    const database = db([{ storage_path: stored, content_sha256: createHash("sha256").update(webp).digest("hex"), mime_type: "image/webp" }]);
    assert.equal(internalCatalogImagesConfigured(), true);
    assert.ok(await readInternalCatalogImage({ guid: "synthetic", name: "test", path: "photo.jpg" }, database.pool, "test-version"));
    assert.equal(database.calls.length, 1);
  });
  it("falls back to the existing FTP connection when no stored preview is ready", async () => {
    const paths: string[] = [];
    const access = mock.method(Client.prototype, "access", async () => ({ code: 230, message: "synthetic" }));
    const size = mock.method(Client.prototype, "size", async (remote: string) => { paths.push(remote); return jpeg.length; });
    const transfer = mock.method(Client.prototype, "downloadTo", async (target: Writable) => {
      await new Promise<void>(resolve => target.end(jpeg, resolve));
      return { code: 226, message: "synthetic" };
    });
    try {
      const file = { guid: "synthetic", name: "test", path: "20250915\\fallback.jpg" };
      assert.ok(await readInternalCatalogImage(file, db([]).pool, "fallback-version"));
      assert.ok(await readInternalCatalogImage(file, db([]).pool, "fallback-version"));
      assert.deepEqual(paths, ["/s3/IMG/20250915/fallback.jpg"]);
      assert.equal(access.mock.callCount(), 1);
      assert.equal(transfer.mock.callCount(), 1);
    } finally { access.mock.restore(); size.mock.restore(); transfer.mock.restore(); }
  });
  it("reuses private S3 with a GET only and rejects foreign buckets and corrupt objects", async () => {
    Object.assign(process.env, { CATALOG_IMAGE_STORAGE_BACKEND: "s3",
      CATALOG_IMAGE_S3_BUCKET: "tandoor-rf-catalog", CATALOG_IMAGE_S3_ENDPOINT: "https://s3.twcstorage.ru",
      CATALOG_IMAGE_S3_ACCESS_KEY: "synthetic", CATALOG_IMAGE_S3_SECRET_KEY: "synthetic" });
    const hash = createHash("sha256").update(webp).digest("hex");
    const stored = `s3://tandoor-rf-catalog/previews/${hash.slice(0, 2)}/${hash}.webp`;
    let returned = webp, calls = 0;
    const stub = mock.method(S3Client.prototype, "send", async (command: unknown) => {
      assert.ok(command instanceof GetObjectCommand);
      assert.equal(command.input.Bucket, "tandoor-rf-catalog"); calls++;
      return { Body: Readable.from([returned]), ContentLength: returned.length };
    });
    try {
      const row = { storage_path: stored, content_sha256: hash, mime_type: "image/webp" };
      assert.ok(await readExistingCatalogPhoto(db([row]).pool, "photo.jpg"));
      assert.equal(calls, 1);
      assert.equal(await readExistingCatalogPhoto(db([{ ...row,
        storage_path: stored.replace("tandoor-rf-catalog", "other-private-bucket") }]).pool, "photo.jpg"), null);
      assert.equal(calls, 1);
      returned = Buffer.from("corrupt");
      assert.equal(await readExistingCatalogPhoto(db([row]).pool, "photo.jpg"), null);
    } finally { stub.mock.restore(); }
  });
  it("does not opt in merely because FTP or shared storage credentials exist", async () => {
    delete process.env.INTERNAL_CATALOG_IMAGE_BACKEND;
    delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
    assert.equal(internalCatalogImagesConfigured(), false);
    assert.equal(await readInternalCatalogImage({ guid: "test", name: "test", path: "photo.jpg" }), null);
  });
});

describe("bounded photo preview cache", () => {
  it("coalesces concurrent requests, caches failures briefly, and retries after expiry", async () => {
    let time = 0, calls = 0;
    const cache = createPhotoCache({ now: () => time, negativeTtlMs: 10 });
    const read = async () => { calls++; return null; };
    await Promise.all([cache("a", read), cache("a", read), cache("a", read)]);
    assert.equal(calls, 1);
    await cache("a", read); assert.equal(calls, 1);
    time = 11; await cache("a", read); assert.equal(calls, 2);
  });
  it("evicts by bytes and entries, applies TTL, and separates versions/sources", async () => {
    let time = 0, calls = 0;
    const cache = createPhotoCache({ maxBytes: 4, maxEntries: 2, ttlMs: 10, now: () => time });
    const read = async () => { calls++; return Buffer.from("abc"); };
    await cache("v1:a", read); await cache("v1:a", read); assert.equal(calls, 1);
    await cache("v2:a", read); await cache("v1:a", read); assert.equal(calls, 3);
    time = 11; await cache("v1:a", read); assert.equal(calls, 4);
    const entries = createPhotoCache({ maxEntries: 1 });
    await entries("a", read); await entries("b", read); await entries("a", read);
    assert.equal(calls, 7);
  });
  it("bounds active and queued requests without unbounded work and releases slots after errors", async () => {
    const cache = createPhotoCache({ concurrency: 1, maxPending: 2 });
    let release!: (value: Buffer) => void, active = 0, peak = 0;
    const first = cache("a", async () => { active++; peak = Math.max(peak, active);
      const bytes = await new Promise<Buffer>(resolve => { release = resolve; }); active--; return bytes; });
    const second = cache("b", async () => { active++; peak = Math.max(peak, active); active--; throw new Error("private"); });
    assert.equal(await cache("c", async () => { throw new Error("must not run"); }), null);
    release(Buffer.from("ok")); await first; assert.equal(await second, null);
    assert.equal(peak, 1); assert.ok(await cache("d", async () => Buffer.from("ok")));
  });
  it("drops expired queue entries rather than starting their downloads", async () => {
    const cache = createPhotoCache({ concurrency: 1, waitMs: 10 });
    let release!: (value: null) => void, ran = false;
    const first = cache("a", () => new Promise(resolve => { release = resolve; }));
    assert.equal(await cache("b", async () => { ran = true; return null; }), null);
    assert.equal(ran, false); release(null); await first;
  });
});
