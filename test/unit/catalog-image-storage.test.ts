import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  isRemoteOrAbsoluteSourcePath,
  processImageToPreview,
  readBoundedFile,
  resolveSafeSourcePath,
  writeImmutablePreview,
} from "../../src/catalog/image-storage";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("catalog image storage", () => {
  let sourceDir = "";
  let storageDir = "";
  let outsideFile = "";

  before(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-src-"));
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-store-"));
    outsideFile = path.join(os.tmpdir(), `catalog-outside-${Date.now()}.png`);
    await fs.writeFile(outsideFile, VALID_PNG);
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/p1.png"), VALID_PNG);
  });

  after(async () => {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(storageDir, { recursive: true, force: true });
    await fs.rm(outsideFile, { force: true });
  });

  it("rejects remote and absolute source paths", () => {
    assert.equal(isRemoteOrAbsoluteSourcePath("https://example.com/a.png"), true);
    assert.equal(isRemoteOrAbsoluteSourcePath("/etc/passwd"), true);
    assert.equal(isRemoteOrAbsoluteSourcePath("images/a.png"), false);
  });

  it("rejects path traversal in source resolution", async () => {
    assert.equal(await resolveSafeSourcePath(sourceDir, "../secret.jpg"), null);
    assert.ok(await resolveSafeSourcePath(sourceDir, "images/p1.png"));
  });

  it("rejects symlinks that escape source dir", async () => {
    const linkPath = path.join(sourceDir, "images", "escape.png");
    await fs.symlink(outsideFile, linkPath);
    assert.equal(await resolveSafeSourcePath(sourceDir, "images/escape.png"), null);
    await fs.rm(linkPath);
  });

  it("rejects truncated png and decodes valid png into preview", async () => {
    const truncated = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const bad = await processImageToPreview(truncated);
    assert.equal(bad.ok, false);

    const ok = await processImageToPreview(VALID_PNG);
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.mimeType, "image/webp");
    assert.ok(ok.width >= 1);
    assert.ok(ok.height >= 1);
    assert.ok(ok.previewBuffer.length > 0);
  });

  it("writes immutable preview objects once", async () => {
    const processed = await processImageToPreview(VALID_PNG);
    assert.equal(processed.ok, true);
    if (!processed.ok) return;
    const first = await writeImmutablePreview(storageDir, processed.contentSha256, processed.previewBuffer);
    const second = await writeImmutablePreview(storageDir, processed.contentSha256, processed.previewBuffer);
    assert.equal(first, second);
    const bytes = await readBoundedFile(first, processed.previewBuffer.length + 1);
    assert.ok(bytes.length > 0);
  });
});
