import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCanonicalBitrixId } from "../../src/bitrix24/parse-id";

describe("parseCanonicalBitrixId", () => {
  it("accepts safe integers and long string ids without Number conversion", () => {
    assert.equal(parseCanonicalBitrixId(42), "42");
    assert.equal(parseCanonicalBitrixId("9007199254740991"), "9007199254740991");
  });

  it("rejects unsafe integers, boolean, zero and padded zero forms", () => {
    assert.equal(parseCanonicalBitrixId(Number.MAX_SAFE_INTEGER + 1), null);
    assert.equal(parseCanonicalBitrixId(true), null);
    assert.equal(parseCanonicalBitrixId("0"), null);
    assert.equal(parseCanonicalBitrixId("000"), null);
    assert.equal(parseCanonicalBitrixId(1.5), null);
  });
});
