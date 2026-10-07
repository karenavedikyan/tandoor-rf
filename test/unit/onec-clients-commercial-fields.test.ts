import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptyCommercial,
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
      ...createEmptyCommercial(),
      discountProgram: "KEEP",
      fieldPresence: { ...createEmptyCommercial().fieldPresence, discountProgram: true },
    };
    const merged = mergeCommercialFields(parseClientCommercialFields({}).commercial, previous);
    assert.equal(merged.discountProgram, "KEEP");
    assert.equal(merged.fieldPresence.discountProgram, true);
  });

  it("isolates markups arrays across sequential parses A, B, C=[]", () => {
    const a = parseClientCommercialFields({ Markups: [{ Name: "A", Percentage: 1 }] });
    const b = parseClientCommercialFields({ Markups: [{ Name: "B", Percentage: 2 }] });
    const c = parseClientCommercialFields({ Markups: [] });

    assert.equal(a.invalid, false);
    assert.equal(b.invalid, false);
    assert.equal(c.invalid, false);
    assert.equal(a.commercial.markups[0]?.name, "A");
    assert.equal(b.commercial.markups[0]?.name, "B");
    assert.equal(c.commercial.markups.length, 0);

    b.commercial.markups.push({ name: "MUTATED", percentage: 99 });
    assert.equal(a.commercial.markups.length, 1);
    assert.equal(a.commercial.markups[0]?.name, "A");
    assert.equal(c.commercial.markups.length, 0);
    assert.equal(EMPTY_COMMERCIAL.markups.length, 0);
  });

  it("does not mutate prior valid parse when later entry is invalid", () => {
    const valid = parseClientCommercialFields({
      Markups: [{ Name: "First", Percentage: 5 }],
    });
    const invalid = parseClientCommercialFields({
      Markups: [{ Name: "First", Percentage: "bad" }],
    });

    assert.equal(valid.invalid, false);
    assert.equal(valid.commercial.markups.length, 1);
    assert.equal(invalid.invalid, true);
    assert.equal(valid.commercial.markups[0]?.name, "First");
    assert.equal(EMPTY_COMMERCIAL.markups.length, 0);
  });

  it("accepts new valid markup after invalid markup in separate parse", () => {
    const invalid = parseClientCommercialFields({
      Markups: [{ Name: "X", Percentage: "bad" }],
    });
    const valid = parseClientCommercialFields({
      Markups: [{ Name: "Recovered", Percentage: 3 }],
    });

    assert.equal(invalid.invalid, true);
    assert.equal(valid.invalid, false);
    assert.equal(valid.commercial.markups[0]?.name, "Recovered");
  });
});
