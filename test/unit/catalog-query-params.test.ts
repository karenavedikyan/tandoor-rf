import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_MAX_PAGE_SIZE,
  parseCatalogProductCode,
  parseCatalogSearchQuery,
} from "../../src/catalog/query-params";

describe("catalog query params", () => {
  it("parses defaults", () => {
    const parsed = parseCatalogSearchQuery({});
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.q, "");
      assert.equal(parsed.value.page, 1);
      assert.equal(parsed.value.pageSize, 20);
      assert.equal(parsed.value.sectionCode, null);
    }
  });

  it("rejects invalid page size", () => {
    const parsed = parseCatalogSearchQuery({ pageSize: String(CATALOG_MAX_PAGE_SIZE + 1) });
    assert.equal(parsed.ok, false);
  });

  it("trims and validates product code", () => {
    assert.equal(parseCatalogProductCode("  p-100  "), "p-100");
    assert.equal(parseCatalogProductCode(""), null);
  });
});
