import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  ATTACHMENT_PREVIEW_MAX_PX,
  buildRasterPreviewBuffer,
  parseAttachmentServeMode,
  previewBlobStorageKey,
} from "../../src/tan-tracker/attachment-preview";

describe("tan-tracker attachment raster preview", () => {
  it("parseAttachmentServeMode maps query to download, thumb, or lightbox", () => {
    assert.equal(parseAttachmentServeMode({ download: "1" }, "image/jpeg"), "download");
    assert.equal(parseAttachmentServeMode({ preview: "thumb" }, "image/jpeg"), "thumb");
    assert.equal(parseAttachmentServeMode({ preview: "lightbox" }, "image/jpeg"), "lightbox");
    assert.equal(parseAttachmentServeMode({ preview: "1" }, "image/jpeg"), "lightbox");
    assert.equal(parseAttachmentServeMode({}, "image/jpeg"), "download");
    assert.equal(parseAttachmentServeMode({}, "application/pdf"), "download");
  });

  it("preview storage keys are derived from original storage key", () => {
    assert.equal(
      previewBlobStorageKey("staged/u1/x-photo.jpg", "thumb"),
      "staged/u1/x-photo.jpg.preview-v1-thumb.jpg",
    );
  });

  it("buildRasterPreviewBuffer bounds dimensions for large JPEG input", async () => {
    const original = await sharp({
      create: { width: 5712, height: 4284, channels: 3, background: { r: 40, g: 80, b: 120 } },
    })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    assert.ok(original.length > 8_000, "fixture JPEG should have non-trivial size");

    const thumb = await buildRasterPreviewBuffer(original, "thumb");
    const meta = await sharp(thumb).metadata();
    assert.ok((meta.width ?? 0) <= ATTACHMENT_PREVIEW_MAX_PX.thumb);
    assert.ok((meta.height ?? 0) <= ATTACHMENT_PREVIEW_MAX_PX.thumb);
    assert.ok(thumb.length < original.length / 4, "thumb bytes should be much smaller than original");

    const lightbox = await buildRasterPreviewBuffer(original, "lightbox");
    const lbMeta = await sharp(lightbox).metadata();
    assert.ok((lbMeta.width ?? 0) <= ATTACHMENT_PREVIEW_MAX_PX.lightbox);
    assert.ok((lbMeta.height ?? 0) <= ATTACHMENT_PREVIEW_MAX_PX.lightbox);
    assert.ok(lightbox.length < original.length, "lightbox bytes should be smaller than original");
    assert.ok(lightbox.length > thumb.length, "lightbox should be larger than thumb");
  });

  it("buildRasterPreviewBuffer rejects corrupt input without caching side effects", async () => {
    await assert.rejects(() => buildRasterPreviewBuffer(Buffer.from("not-a-image"), "thumb"), (err: unknown) => {
      assert.equal((err as { http?: number }).http, 422);
      return true;
    });
  });
});
