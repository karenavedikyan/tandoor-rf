import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { internalCatalogImagesConfigured, readInternalCatalogImage } from "../../src/internal-catalog/images";
import { fixtureGuid } from "../helpers/internal-catalog-fixtures";

describe("internal catalogue opt-in, read-only image previews", { concurrency: false }, () => {
  let root: string, original: string | undefined, limit: string | undefined;
  const file = { guid: fixtureGuid(300), name: "Synthetic test image", path: "20240626\\photo.jpg" };
  beforeEach(async () => {
    original = process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
    limit = process.env.CATALOG_IMAGE_MAX_BYTES;
    delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
    root = await mkdtemp(path.join(os.tmpdir(), "internal-catalog-photos-"));
    await mkdir(path.join(root, "20240626"));
    await writeFile(path.join(root, "20240626/photo.jpg"),
      await sharp({ create: { width: 20, height: 10, channels: 3, background: "#426428" } }).jpeg().toBuffer());
  });
  afterEach(async () => {
    if (original === undefined) delete process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR;
    else process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = original;
    if (limit === undefined) delete process.env.CATALOG_IMAGE_MAX_BYTES;
    else process.env.CATALOG_IMAGE_MAX_BYTES = limit;
    await rm(root, { recursive: true, force: true });
  });
  it("does not attach either an unconfigured or a relative source root", async () => {
    assert.equal(internalCatalogImagesConfigured(), false);
    assert.equal(await readInternalCatalogImage(file), null);
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = "./images";
    assert.equal(internalCatalogImagesConfigured(), false);
    assert.equal(await readInternalCatalogImage(file), null);
  });
  it("uses Windows-relative paths and returns a decoded WebP preview, not the source bytes", async () => {
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = root;
    const image = await readInternalCatalogImage(file);
    assert.ok(image);
    const meta = await sharp(image).metadata();
    assert.equal(meta.format, "webp"); assert.equal(meta.width, 20); assert.equal(meta.height, 10);
    assert.equal(meta.exif, undefined);
  });
  it("does not reveal missing or corrupt sources and does not modify them", async () => {
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = root;
    assert.equal(await readInternalCatalogImage({ ...file, path: "missing.png" }), null);
    await writeFile(path.join(root, "20240626/photo.jpg"), "<html>not an image</html>");
    assert.equal(await readInternalCatalogImage(file), null);
  });
  it("renders tall catalogue references from the opt-in local source", async () => {
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = root;
    await writeFile(path.join(root, "20240626/photo.jpg"),
      await sharp({ create: { width: 1912, height: 4180, channels: 3, background: "#eee8de" } }).jpeg().toBuffer());
    const bytes = await readInternalCatalogImage(file);
    assert.ok(bytes);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.height, 1200);
    assert.ok(meta.width! <= 1200);
  });
  it("rejects absolute, remote, traversal, control-character and unsupported paths", async () => {
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = root;
    for (const unsafe of ["../secret.jpg", "/secret.jpg", "C:\\secret.jpg", "https://example.com/photo.jpg",
      "x/../../secret.png", "photo.svg", "bad\0photo.png"]) {
      assert.equal(await readInternalCatalogImage({ ...file, path: unsafe }), null, unsafe);
    }
  });
  it("rejects file symlinks and directory symlinks escaping the explicitly configured root", async () => {
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = path.join(root, "20240626");
    await writeFile(path.join(root, "secret.jpg"), "private outside root");
    await symlink(path.join(root, "secret.jpg"), path.join(root, "20240626/link.jpg"));
    await symlink(root, path.join(root, "20240626/outside"));
    assert.equal(await readInternalCatalogImage({ ...file, path: "link.jpg" }), null);
    assert.equal(await readInternalCatalogImage({ ...file, path: "outside/secret.jpg" }), null);
  });
  it("preserves the existing bounded read limit", async () => {
    process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR = root;
    process.env.CATALOG_IMAGE_MAX_BYTES = "32";
    assert.equal(await readInternalCatalogImage(file), null);
  });
});
