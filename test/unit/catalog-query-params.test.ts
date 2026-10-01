import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogSearchQuery } from "../../src/catalog/query-params";

describe("catalog query params", () => {
  it("preserves commas inside a single filter value", () => {
    const parsed = parseCatalogSearchQuery({
      filterColor: "Белый, матовый",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value.propertyFilters.color, ["Белый, матовый"]);
  });

  it("accepts repeated filter params as multiple values", () => {
    const parsed = parseCatalogSearchQuery({
      filterBrand: ["Tandoor", "Other"],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value.propertyFilters.brand, ["Tandoor", "Other"]);
  });
});
