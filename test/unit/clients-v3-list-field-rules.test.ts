import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseV3FilterRulesParam, appendV3FieldRulesSql } from "../../src/clients/v3/list-field-rules";

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
  it("enforces the limit for empty rules too", () => {
    assert.equal(parseV3FilterRulesParam(JSON.stringify(Array.from({ length: 13 }, () => ({ field: "city", op: "empty" }))), "legal"), undefined);
  });
  it("applies retail hardware assignment instead of ignoring it", () => {
    const params: unknown[] = [];
    const result = appendV3FieldRulesSql("", params, "retail", "ro", [{ field: "hardwareGuid", op: "eq", value: "22222222-2222-4222-8222-222222222222" }]);
    assert.match(result.sql, /guidHardwareManager/);
    assert.equal(params.length, 1);
  });
  it("accepts numeric zero but rejects non-numeric values", () => {
    assert.ok(parseV3FilterRulesParam(JSON.stringify([{ field: "discountAmount", op: "eq", value: "0" }]), "legal"));
    assert.equal(parseV3FilterRulesParam(JSON.stringify([{ field: "discountAmount", op: "gte", value: "abc" }]), "legal"), undefined);
  });
});
