import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNativeStorageMime,
  isPdfMagic,
  isHlsOrPlaylistManifest,
  safeNativeAttachmentFileName,
} from "../../src/tanbot/native-create/native-attachment-magic";

const MIN_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const HTML = Buffer.from("<html>not PDF</html>", "utf8");

describe("native attachment magic", () => {
  it("detects PDF and image storage mime", () => {
    assert.equal(isPdfMagic(MIN_PDF), true);
    assert.equal(classifyNativeStorageMime(MIN_PDF), "application/pdf");
    assert.equal(classifyNativeStorageMime(JPEG), "image/jpeg");
  });

  it("stores unknown and fake-pdf bytes as octet-stream", () => {
    assert.equal(classifyNativeStorageMime(HTML), "application/octet-stream");
    assert.equal(classifyNativeStorageMime(Buffer.from("MZ-exe", "utf8")), "application/octet-stream");
  });

  it("detects HLS manifest", () => {
    assert.equal(isHlsOrPlaylistManifest(Buffer.from("#EXTM3U\n", "utf8")), true);
  });

  it("preserves supplied filename", () => {
    assert.equal(safeNativeAttachmentFileName("table.xlsx"), "table.xlsx");
  });
});
