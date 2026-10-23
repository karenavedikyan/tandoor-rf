import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addSaleMoneyStrings,
  addSaleQuantityStrings,
  saleMoneyStringsExactEqual,
} from "../../src/onec-sales/decimal-sum";

describe("decimal-sum exact", () => {
  it("sums return money without float drift", () => {
    const sum = addSaleMoneyStrings(["-0.1", "-0.2"]);
    assert.equal(saleMoneyStringsExactEqual(sum, "-0.3"), true);
  });

  it("sums fractional quantity", () => {
    const sum = addSaleQuantityStrings(["2.5", "12.5"]);
    assert.equal(sum, "15.000000");
  });
});
