import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { v3LegalGroupKeyExpr } from "../../src/clients/v3/list-legal-grouped";

describe("v3 legal grouped list helpers", () => {
  it("builds stable holding and legal group key expressions", () => {
    const expr = v3LegalGroupKeyExpr("le");
    assert.match(expr, /membership_conflict/);
    assert.match(expr, /holding:/);
    assert.match(expr, /legal:/);
    assert.match(expr, /onec_v3_holdings _v3gh/);
  });
});
