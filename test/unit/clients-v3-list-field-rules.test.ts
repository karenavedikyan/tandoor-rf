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

  it("accepts legalName for legal and legal_grouped but not retail or orphan_retail", () => {
    const raw = JSON.stringify([{ field: "legalName", op: "contains", value: "Legal" }]);
    assert.ok(parseV3FilterRulesParam(raw, "legal"));
    assert.ok(parseV3FilterRulesParam(raw, "legal_grouped"));
    assert.equal(parseV3FilterRulesParam(raw, "retail"), undefined);
    assert.equal(parseV3FilterRulesParam(raw, "orphan_retail"), undefined);
  });

  it("legalName eq empty and filled build name_client SQL", () => {
    const eqParams: unknown[] = [];
    const eq = appendV3FieldRulesSql("", eqParams, "legal", "le", [
      { field: "legalName", op: "eq", value: "Legal One" },
    ]);
    assert.match(eq.sql, /le\.name_client.*= \$1/);
    assert.equal(eqParams[0], "Legal One");
    const emptyParams: unknown[] = [];
    const empty = appendV3FieldRulesSql("", emptyParams, "legal", "le", [
      { field: "legalName", op: "empty", value: "" },
    ]);
    assert.match(empty.sql, /le\.name_client.*IS NULL/i);
    const filledParams: unknown[] = [];
    const filled = appendV3FieldRulesSql("", filledParams, "legal", "le", [
      { field: "legalName", op: "filled", value: "" },
    ]);
    assert.match(filled.sql, /le\.name_client.*IS NOT NULL/i);
  });

  it("legalName contains escapes wildcards and uses name_client", () => {
    const params: unknown[] = [];
    const { sql } = appendV3FieldRulesSql("", params, "legal", "le", [
      { field: "legalName", op: "contains", value: "100%_\\" },
    ]);
    assert.match(sql, /le\.name_client.*ILIKE/i);
    assert.match(sql, /ESCAPE '\\'/);
    assert.equal(params[0], "%100\\%\\_\\\\%");
  });

  it("legalStatus rules remain separate from legalName", () => {
    const params: unknown[] = [];
    const status = appendV3FieldRulesSql("", params, "legal", "le", [
      { field: "legalStatus", op: "contains", value: "Active" },
    ]);
    assert.match(status.sql, /LEGAL_STATUS|status/i);
    assert.doesNotMatch(status.sql, /name_client/);
  });
});
