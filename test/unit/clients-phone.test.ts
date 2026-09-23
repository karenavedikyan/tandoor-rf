import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeIlikePattern,
  isRecognizedTelHref,
  normalizePhoneForSearch,
  telHrefFromPhone,
} from "../../src/clients/phone";

describe("clients phone helpers", () => {
  it("normalizes phone search input without empty wildcard", () => {
    assert.equal(normalizePhoneForSearch("+7 (999) 000-11-22"), "79990001122");
    assert.equal(normalizePhoneForSearch("   + - ()  "), "");
  });

  it("escapes ilike metacharacters", () => {
    assert.equal(escapeIlikePattern("100%_test"), "100\\%\\_test");
  });

  it("accepts only unambiguous tel href numbers", () => {
    assert.equal(isRecognizedTelHref("+79990001122"), true);
    assert.equal(isRecognizedTelHref("8 800 555"), false);
    assert.equal(isRecognizedTelHref("+7 (999) 000-11-22"), true);
    assert.equal(isRecognizedTelHref("моб: +7 999"), false);
    assert.equal(telHrefFromPhone("+7 (999) 000-11-22"), "+79990001122");
    assert.equal(telHrefFromPhone("доп. +7 999 и +7 888"), null);
  });
});
