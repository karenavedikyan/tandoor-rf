import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readBonusField,
  readDateOfBirthField,
  readLoadingTimeField,
} from "../../src/onec-clients/field-value";

describe("live 1C field parsers", () => {
  describe("readLoadingTimeField", () => {
    it("accepts HH:mm and HH:mm:ss", () => {
      assert.deepEqual(readLoadingTimeField("09:00"), { kind: "value", value: "09:00", sourceRaw: "09:00" });
      assert.deepEqual(readLoadingTimeField("09:30:45"), {
        kind: "value",
        value: "09:30:45",
        sourceRaw: "09:30:45",
      });
    });

    it("adapts 0001-01-01THH:mm:ss without timezone shift", () => {
      assert.deepEqual(readLoadingTimeField("0001-01-01T09:30:00"), {
        kind: "value",
        value: "09:30",
        sourceRaw: "0001-01-01T09:30:00",
      });
      assert.deepEqual(readLoadingTimeField("0001-01-01T14:05:30"), {
        kind: "value",
        value: "14:05:30",
        sourceRaw: "0001-01-01T14:05:30",
      });
    });

    it("marks 0001-01-01T00:00:00 ambiguous", () => {
      assert.deepEqual(readLoadingTimeField("0001-01-01T00:00:00"), {
        kind: "ambiguous",
        sourceRaw: "0001-01-01T00:00:00",
      });
    });

    it("rejects invalid clock and arbitrary dates", () => {
      assert.equal(readLoadingTimeField("25:00:00").kind, "invalid_type");
      assert.equal(readLoadingTimeField("2026-01-01T09:00:00").kind, "invalid_type");
      assert.equal(readLoadingTimeField("0001-01-01T09:00:00Z").kind, "invalid_type");
    });
  });

  describe("readDateOfBirthField", () => {
    it("accepts YYYY-MM-DD and midnight timestamp form", () => {
      assert.deepEqual(readDateOfBirthField("1990-05-15"), {
        kind: "value",
        value: "1990-05-15",
        sourceRaw: "1990-05-15",
      });
      assert.deepEqual(readDateOfBirthField("1992-02-29T00:00:00"), {
        kind: "value",
        value: "1992-02-29",
        sourceRaw: "1992-02-29T00:00:00",
      });
    });

    it("marks 0001-01-01T00:00:00 ambiguous", () => {
      assert.deepEqual(readDateOfBirthField("0001-01-01T00:00:00"), {
        kind: "ambiguous",
        sourceRaw: "0001-01-01T00:00:00",
      });
    });

    it("rejects invalid calendar, non-midnight time and timezone suffix", () => {
      assert.equal(readDateOfBirthField("2026-02-31").kind, "invalid_type");
      assert.equal(readDateOfBirthField("1990-05-15T12:00:00").kind, "invalid_type");
      assert.equal(readDateOfBirthField("1990-05-15T00:00:00Z").kind, "invalid_type");
    });
  });

  describe("readBonusField", () => {
    it("accepts string and finite number without rounding", () => {
      assert.deepEqual(readBonusField("10%"), { kind: "value", value: "10%" });
      assert.deepEqual(readBonusField(12.5), { kind: "value", value: "12.5" });
      assert.deepEqual(readBonusField(0), { kind: "value", value: "0" });
    });

    it("treats empty as empty not zero", () => {
      assert.equal(readBonusField("").kind, "empty");
      assert.equal(readBonusField(null).kind, "null_value");
    });

    it("rejects boolean object and array", () => {
      assert.equal(readBonusField(true).kind, "invalid_type");
      assert.equal(readBonusField({}).kind, "invalid_type");
      assert.equal(readBonusField([]).kind, "invalid_type");
    });
  });
});
