import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectNativeAttachmentMime,
  isPdfMagic,
  canonicalNativeAttachmentFileName,
} from "../../src/tanbot/native-create/native-attachment-magic";

const MIN_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe("native attachment magic", () => {
  it("detects PDF by header bytes", () => {
    assert.equal(isPdfMagic(MIN_PDF), true);
    assert.deepEqual(detectNativeAttachmentMime(MIN_PDF), { kind: "pdf", mimeType: "application/pdf" });
  });

  it("rejects fake PDF and HTML", () => {
    assert.equal(detectNativeAttachmentMime(Buffer.from("NOT%PDF-header", "utf8")), null);
    assert.equal(detectNativeAttachmentMime(Buffer.from("<html>", "utf8")), null);
  });

  it("canonicalizes pdf filename", () => {
    const name = canonicalNativeAttachmentFileName("scan", { kind: "pdf", mimeType: "application/pdf" });
    assert.match(name, /\.pdf$/i);
  });

  it("still detects jpeg magic", () => {
    assert.deepEqual(detectNativeAttachmentMime(JPEG), { kind: "image", mimeType: "image/jpeg" });
  });
});
