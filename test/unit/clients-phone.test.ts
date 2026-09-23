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

  it("builds tel href only for explicit international prefixes", () => {
    assert.equal(telHrefFromPhone("+7 (999) 000-11-22"), "+79990001122");
    assert.equal(telHrefFromPhone("0079990001122"), "+79990001122");
    assert.equal(telHrefFromPhone("8 (999) 000-11-22"), null);
    assert.equal(telHrefFromPhone("9990001122"), null);
    assert.equal(telHrefFromPhone("12+345678901"), null);
    assert.equal(telHrefFromPhone("8-800-555-35-35"), null);
    assert.equal(telHrefFromPhone("доп. +7 999"), null);
    assert.equal(telHrefFromPhone("+7 999, +7 888"), null);
  });

  it("mirrors tel recognition helper", () => {
    assert.equal(isRecognizedTelHref("+79990001122"), true);
    assert.equal(isRecognizedTelHref("8 800 555"), false);
  });
});
