import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_MAX_PAGE_SIZE,
  CATALOG_MAX_QUERY_LENGTH,
  parseCatalogProductCode,
  parseCatalogSearchQuery,
  parseCatalogVersionId,
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

  it("rejects invalid page forms", () => {
    for (const page of ["1abc", "1.5", "-1", "0", "1e+33"]) {
      const parsed = parseCatalogSearchQuery({ page });
      assert.equal(parsed.ok, false, `page=${page}`);
    }
  });

  it("rejects page offset overflow", () => {
    const parsed = parseCatalogSearchQuery({ page: "1000000", pageSize: "50" });
    assert.equal(parsed.ok, false);
  });

  it("accepts boundary page and pageSize", () => {
    const parsed = parseCatalogSearchQuery({ page: "2", pageSize: String(CATALOG_MAX_PAGE_SIZE) });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.page, 2);
      assert.equal(parsed.value.pageSize, CATALOG_MAX_PAGE_SIZE);
    }
  });

  it("rejects invalid page size", () => {
    const parsed = parseCatalogSearchQuery({ pageSize: String(CATALOG_MAX_PAGE_SIZE + 1) });
    assert.equal(parsed.ok, false);
  });

  it("rejects array query values", () => {
    const parsed = parseCatalogSearchQuery({ q: ["alpha"] as unknown as string });
    assert.equal(parsed.ok, false);
  });

  it("rejects query longer than limit", () => {
    const parsed = parseCatalogSearchQuery({ q: "а".repeat(CATALOG_MAX_QUERY_LENGTH + 1) });
    assert.equal(parsed.ok, false);
  });

  it("accepts cyrillic and wildcard characters literally in q", () => {
    const parsed = parseCatalogSearchQuery({ q: "раковина 100% _test" });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.q, "раковина 100% _test");
    }
  });

  it("validates versionId strictly", () => {
    assert.deepEqual(parseCatalogVersionId(undefined), { ok: true, value: null });
    assert.equal(parseCatalogVersionId("not-a-uuid").ok, false);
    assert.equal(parseCatalogVersionId(["x"] as unknown as string).ok, false);
    const valid = parseCatalogVersionId("11111111-1111-4111-8111-111111111111");
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.equal(valid.value, "11111111-1111-4111-8111-111111111111");
    }
  });

  it("trims and validates product code", () => {
    assert.equal(parseCatalogProductCode("  p-100  "), "p-100");
    assert.equal(parseCatalogProductCode(""), null);
  });
});
