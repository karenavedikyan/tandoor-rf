import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSafeInlinePreviewMime,
  resolveAttachmentContentDisposition,
} from "../../src/tan-tracker/attachments";

describe("tan-tracker attachment preview disposition", () => {
  it("allows inline only for safe raster preview query", () => {
    assert.equal(isSafeInlinePreviewMime("image/jpeg"), true);
    assert.equal(isSafeInlinePreviewMime("application/pdf"), false);
    assert.equal(
      resolveAttachmentContentDisposition("image/jpeg", { preview: "1" }),
      "inline",
    );
    assert.equal(
      resolveAttachmentContentDisposition("application/pdf", { preview: "1" }),
      "attachment",
    );
  });

  it("forces attachment for download query", () => {
    assert.equal(
      resolveAttachmentContentDisposition("image/jpeg", { download: "1" }),
      "attachment",
    );
  });

  it("defaults safe raster to inline and other types to attachment", () => {
    assert.equal(resolveAttachmentContentDisposition("image/png", {}), "inline");
    assert.equal(resolveAttachmentContentDisposition("text/plain", {}), "attachment");
  });
});
