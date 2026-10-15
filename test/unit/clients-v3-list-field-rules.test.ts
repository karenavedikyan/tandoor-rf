import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseV3FilterRulesParam } from "../../src/clients/v3/list-field-rules";

describe("parseV3FilterRulesParam", () => {
  it("accepts AND rules with eq and empty ops", () => {
    const raw = JSON.stringify([
      { field: "categoryGuid", op: "eq", value: "c1" },
      { field: "city", op: "empty", value: "" },
    ]);
    const rules = parseV3FilterRulesParam(raw, "legal");
    assert.ok(rules);
    assert.equal(rules!.length, 2);
  });

  it("rejects unknown field", () => {
    const raw = JSON.stringify([{ field: "inn", op: "eq", value: "123" }]);
    assert.equal(parseV3FilterRulesParam(raw, "legal"), undefined);
  });

  it("rejects invalid JSON", () => {
    assert.equal(parseV3FilterRulesParam("{", "legal"), undefined);
  });
});
