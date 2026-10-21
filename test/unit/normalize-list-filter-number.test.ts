import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeListFilterNumberValue } from "../../src/clients/v3/normalize-list-filter-number";

describe("normalizeListFilterNumberValue", () => {
  it("normalizes scientific notation to decimal accepted by API", () => {
    assert.deepEqual(normalizeListFilterNumberValue("1e3"), { ok: true, value: "1000" });
  });

  it("accepts plain decimals", () => {
    assert.deepEqual(normalizeListFilterNumberValue(".5"), { ok: true, value: "0.5" });
    assert.deepEqual(normalizeListFilterNumberValue("-12.5"), { ok: true, value: "-12.5" });
  });

  it("rejects non-finite and garbage", () => {
    assert.deepEqual(normalizeListFilterNumberValue("abc"), { ok: false, reason: "invalid" });
    assert.deepEqual(normalizeListFilterNumberValue("Infinity"), { ok: false, reason: "invalid" });
    assert.deepEqual(normalizeListFilterNumberValue(""), { ok: false, reason: "empty" });
  });
});
