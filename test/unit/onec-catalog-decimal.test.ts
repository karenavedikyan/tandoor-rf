import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogDecimal } from "../../src/onec-catalog/decimal";

describe("onec catalog decimal parser", () => {
  it("parses comma decimals without float rounding", () => {
    const parsed = parseCatalogDecimal("347,39");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.numeric, "347.39");
    }
  });

  it("rejects empty and invalid values", () => {
    assert.equal(parseCatalogDecimal("").ok, false);
    assert.equal(parseCatalogDecimal("12.34").ok, false);
    assert.equal(parseCatalogDecimal("abc").ok, false);
  });

  it("accepts zero", () => {
    const parsed = parseCatalogDecimal("0");
    assert.equal(parsed.ok, true);
  });
});
