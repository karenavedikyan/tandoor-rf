import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRuPhoneE164, ruPhoneNational10 } from "../../src/tan-tracker/phone-normalize";

describe("normalizeRuPhoneE164", () => {
  it("accepts 10 digits", () => {
    assert.equal(normalizeRuPhoneE164("9004445566"), "+79004445566");
  });
  it("accepts 11 digits with 7", () => {
    assert.equal(normalizeRuPhoneE164("79004445566"), "+79004445566");
  });
  it("accepts +7 prefixed value from browser double prefix", () => {
    assert.equal(normalizeRuPhoneE164("+779004445566"), "+79004445566");
  });
  it("accepts 8 prefix", () => {
    assert.equal(normalizeRuPhoneE164("89004445566"), "+79004445566");
  });
});

describe("ruPhoneNational10", () => {
  it("returns 10 national digits for +7, 8, and 10-digit inputs", () => {
    assert.equal(ruPhoneNational10("+79004445566"), "9004445566");
    assert.equal(ruPhoneNational10("89004445566"), "9004445566");
    assert.equal(ruPhoneNational10("9004445566"), "9004445566");
    assert.equal(ruPhoneNational10("+79004445566")!.length, 10);
  });
});
