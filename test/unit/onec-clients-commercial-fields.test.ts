import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_COMMERCIAL,
  mergeCommercialFields,
  parseClientCommercialFields,
} from "../../src/onec-clients/commercial-fields";

describe("onec-clients commercial fields", () => {
  it("parses Discount, DiscountAmount and Markups with field presence", () => {
    const parsed = parseClientCommercialFields({
      Discount: " PROGRAM-A ",
      DiscountAmount: 0,
      Markups: [{ Name: "Base", Percentage: 10.5 }],
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.commercial.fieldPresence.discountProgram, true);
    assert.equal(parsed.commercial.discountProgram, "PROGRAM-A");
    assert.equal(parsed.commercial.fieldPresence.discountAmount, true);
    assert.equal(parsed.commercial.discountAmount, 0);
    assert.equal(parsed.commercial.markups.length, 1);
    assert.equal(parsed.commercial.markups[0]?.name, "Base");
    assert.equal(parsed.commercial.markups[0]?.percentage, 10.5);
  });

  it("treats explicit null DiscountAmount as empty value with presence", () => {
    const parsed = parseClientCommercialFields({ DiscountAmount: null });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.commercial.fieldPresence.discountAmount, true);
    assert.equal(parsed.commercial.discountAmount, null);
  });

  it("rejects invalid commercial shapes", () => {
    assert.equal(parseClientCommercialFields({ DiscountAmount: "not-a-number" }).invalid, true);
    assert.equal(parseClientCommercialFields({ Markups: "bad" }).invalid, true);
  });

  it("preserves previous commercial when incoming export omits keys", () => {
    const previous = {
      ...EMPTY_COMMERCIAL,
      discountProgram: "KEEP",
      fieldPresence: { ...EMPTY_COMMERCIAL.fieldPresence, discountProgram: true },
    };
    const merged = mergeCommercialFields(parseClientCommercialFields({}).commercial, previous);
    assert.equal(merged.discountProgram, "KEEP");
    assert.equal(merged.fieldPresence.discountProgram, true);
  });
});
