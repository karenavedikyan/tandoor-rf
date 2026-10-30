import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectImageMimeFromMagic } from "../../src/tanbot-telegram/bounded-binary-fetch";

describe("detectImageMimeFromMagic", () => {
  it("detects jpeg png gif webp from magic bytes", () => {
    assert.equal(detectImageMimeFromMagic(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
    assert.equal(
      detectImageMimeFromMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
      "image/png",
    );
    assert.equal(detectImageMimeFromMagic(Buffer.from("GIF89a\x00", "ascii")), "image/gif");
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0);
    webp.write("WEBP", 8);
    assert.equal(detectImageMimeFromMagic(webp), "image/webp");
    assert.equal(detectImageMimeFromMagic(Buffer.from([0, 0, 0])), null);
  });
});
