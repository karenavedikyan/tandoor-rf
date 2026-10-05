import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeSqlFilters } from "../../src/access/combine-filters";

describe("mergeSqlFilters", () => {
  it("merges leading-whitespace WHERE clauses without duplicating WHERE", () => {
    const merged = mergeSqlFilters(
      { whereSql: "\n      WHERE guid_client = $1::uuid", params: ["11111111-1111-4111-8111-111111111111"] },
      ["name_client ILIKE $1"],
      ["%alpha%"],
    );
    assert.match(
      merged.whereSql,
      /^WHERE guid_client = \$1::uuid AND name_client ILIKE \$2$/,
    );
    assert.deepEqual(merged.params, [
      "11111111-1111-4111-8111-111111111111",
      "%alpha%",
    ]);
  });
});
