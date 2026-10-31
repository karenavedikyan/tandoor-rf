import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNativeCreateCallback, parseNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";

describe("native create callback codec", () => {
  const draftId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  it("round-trips full uuid hex and revision above 100", () => {
    const payload = buildNativeCreateCallback("confirm", draftId, 150);
    assert.ok(payload);
    assert.ok(Buffer.byteLength(payload, "utf8") <= 64);
    const parsed = parseNativeCreateCallback(payload);
    assert.equal(parsed?.action, "confirm");
    assert.equal(parsed?.draftIdHex, "a1b2c3d4e5f67890abcdef1234567890");
    assert.equal(parsed?.revision, 150);
  });

  it("rejects oversize payload instead of truncating", () => {
    const longArg = "x".repeat(40);
    const payload = buildNativeCreateCallback("recipient", draftId, 1, longArg);
    assert.equal(payload, null);
  });
});
