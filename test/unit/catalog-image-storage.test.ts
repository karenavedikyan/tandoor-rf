import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSourcePath,
  resolveStoragePath,
  validateImageBytes,
} from "../../src/catalog/image-storage";

describe("catalog image storage", () => {
  it("rejects path traversal in source resolution", () => {
    const root = "/tmp/catalog-source";
    assert.equal(resolveSourcePath(root, "../secret.jpg"), null);
    assert.equal(resolveSourcePath(root, "images/ok.jpg"), "/tmp/catalog-source/images/ok.jpg");
  });

  it("normalizes storage paths", () => {
    assert.match(resolveStoragePath("/data/storage", "/images/a.jpg"), /images[/\\]a\.jpg$/);
  });

  it("validates png header and rejects unknown bytes", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const ok = await validateImageBytes(png);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.mimeType, "image/png");

    const bad = await validateImageBytes(Buffer.from("not-an-image"));
    assert.equal(bad.ok, false);
  });
});
