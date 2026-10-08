import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lprPresentationFromParsed } from "../../src/clients/lpr-fields";
import type { ParsedOutletLpr } from "../../src/onec-clients/extended-types";

function lpr(partial: Partial<ParsedOutletLpr>): ParsedOutletLpr {
  return {
    name: "",
    post: "",
    dateOfBirth: null,
    phone: "",
    email: "",
    bonus: "",
    conditionsBonus: "",
    fieldPresence: {
      name: false,
      post: false,
      phone: false,
      email: false,
      bonus: false,
      conditionsBonus: false,
      dateOfBirth: false,
    },
    ...partial,
  };
}

describe("lpr-fields presentation", () => {
  it("treats bonus string zero as a value", () => {
    const dto = lprPresentationFromParsed(
      lpr({
        bonus: "0",
        fieldPresence: {
          name: false,
          post: false,
          phone: false,
          email: false,
          bonus: true,
          conditionsBonus: false,
          dateOfBirth: false,
        },
      }),
    );
    assert.equal(dto.bonus.value, "0");
    assert.equal(dto.bonus.label, "0");
    assert.equal(dto.bonus.hasSource, true);
  });

  it("does not show sentinel date of birth as a real date", () => {
    const dto = lprPresentationFromParsed(
      lpr({
        dateOfBirth: null,
        dateOfBirthExplicitEmpty: true,
        fieldPresence: {
          name: false,
          post: false,
          phone: false,
          email: false,
          bonus: false,
          conditionsBonus: false,
          dateOfBirth: true,
        },
      }),
    );
    assert.equal(dto.dateOfBirth.isoDate, null);
    assert.equal(dto.dateOfBirth.explicitEmptyInSource, true);
    assert.match(dto.dateOfBirth.label, /Не заполнено/);
  });
});
