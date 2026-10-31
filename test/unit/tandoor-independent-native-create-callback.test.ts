import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNativeCreateCallback, draftIdMatchesHex, parseNativeCreateCallback,
} from "../../src/tanbot/native-create/callback-codec";

const draftA = "12345678-90ab-4cde-8fab-123456789abc";
const draftB = "12345678-90ff-4cde-8fab-123456789abc";

describe("independent native callback safety", () => {
  it("matches the complete draft identity, not a shared prefix", () => {
    const encoded = buildNativeCreateCallback("confirm", draftA, 1);
    assert.ok(encoded);
    const decoded = parseNativeCreateCallback(encoded);
    assert.ok(decoded);
    assert.equal(draftIdMatchesHex(draftA, decoded.draftIdHex), true);
    assert.equal(draftIdMatchesHex(draftB, decoded.draftIdHex), false);
  });
  it("preserves revisions past one hundred and produces distinct bounded callbacks", () => {
    const callbacks = [98, 99, 100, 101, 128, 1024].map(revision => {
      const encoded = buildNativeCreateCallback("recipient", draftA, revision, "12");
      assert.ok(encoded);
      assert.ok(Buffer.byteLength(encoded, "utf8") <= 64);
      assert.equal(parseNativeCreateCallback(encoded)?.revision, revision);
      return encoded;
    });
    assert.equal(new Set(callbacks).size, callbacks.length);
  });
  it("rejects oversized values instead of silently truncating UTF-8 or action arguments", () => {
    assert.equal(buildNativeCreateCallback("recipient", draftA, 1, "я".repeat(80)), null);
  });
  it("accepts edit field recipient (9 chars) within the 64-byte callback limit", () => {
    const encoded = buildNativeCreateCallback("edit", draftA, 42, "recipient");
    assert.ok(encoded);
    assert.ok(Buffer.byteLength(encoded!, "utf8") <= 64);
    assert.equal(parseNativeCreateCallback(encoded!)?.arg, "recipient");
  });
  it("rejects unrecognized trailing fields and oversize payloads", () => {
    const encoded = buildNativeCreateCallback("due", draftA, 1, "t");
    assert.ok(encoded);
    assert.equal(parseNativeCreateCallback(`${encoded}:unexpected`), null);
    assert.equal(parseNativeCreateCallback(encoded + "x".repeat(80)), null);
  });
  it("does not alias invalid revision values to a valid action", () => {
    for (const revision of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(buildNativeCreateCallback("confirm", draftA, revision), null);
    }
  });
});
