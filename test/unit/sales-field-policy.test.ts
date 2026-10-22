import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSalesSectionFieldPolicy } from "../../src/clients/v3/sales-field-policy";

describe("sales section field policy", () => {
  it("allows ROP margin fields except cost", () => {
    const policy = resolveSalesSectionFieldPolicy({ role: "rop", fullClientBase: false } as never);
    assert.equal(policy.costPrice, false);
    assert.equal(policy.grossProfit, true);
    assert.equal(policy.income, true);
  });

  it("keeps manager on discounts without cost", () => {
    const policy = resolveSalesSectionFieldPolicy({ role: "manager", fullClientBase: false } as never);
    assert.equal(policy.totalDiscount, true);
    assert.equal(policy.costPrice, false);
    assert.equal(policy.grossProfit, false);
  });
});
