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

function legacyFilledLpr(): ParsedOutletLpr {
  return {
    name: "Legacy LPR",
    post: "Director",
    dateOfBirth: "1985-03-15",
    phone: "+79001112233",
    email: "legacy@example.test",
    bonus: "0",
    conditionsBonus: "Terms",
    dateOfBirthConfirmedInCurrentExport: true,
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

  it("legacy snapshot without fieldPresence shows all seven filled fields", () => {
    const dto = lprPresentationFromParsed(legacyFilledLpr());
    assert.equal(dto.name.value, "Legacy LPR");
    assert.equal(dto.post.value, "Director");
    assert.equal(dto.phone.value, "+79001112233");
    assert.equal(dto.email.value, "legacy@example.test");
    assert.equal(dto.bonus.value, "0");
    assert.equal(dto.conditionsBonus.value, "Terms");
    assert.equal(dto.dateOfBirth.isoDate, "1985-03-15");
    for (const key of ["name", "post", "phone", "email", "bonus", "conditionsBonus"] as const) {
      assert.equal(dto[key].hasSource, true, key);
    }
    assert.equal(dto.dateOfBirth.hasSource, true);
  });

  it("legacy empty scalars stay «Не передано» (no invented presence)", () => {
    const dto = lprPresentationFromParsed({
      name: "",
      post: "",
      dateOfBirth: null,
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
    });
    assert.equal(dto.name.label, "Не передано");
    assert.equal(dto.phone.label, "Не передано");
    assert.equal(dto.dateOfBirth.label, "Не передано");
  });

  it("explicit fieldPresence=false hides stored scalar", () => {
    const dto = lprPresentationFromParsed(
      lpr({
        name: "Hidden",
        fieldPresence: {
          name: false,
          post: false,
          phone: false,
          email: false,
          bonus: false,
          conditionsBonus: false,
          dateOfBirth: false,
        },
      }),
    );
    assert.equal(dto.name.label, "Не передано");
    assert.equal(dto.name.value, null);
  });

  it("legacy ambiguous and preserved date markers", () => {
    const ambiguous = lprPresentationFromParsed({
      name: "",
      post: "",
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
      dateOfBirth: null,
      dateOfBirthAmbiguous: true,
    });
    assert.match(ambiguous.dateOfBirth.label, /Неоднозначная/);

    const preserved = lprPresentationFromParsed({
      name: "",
      post: "",
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
      dateOfBirth: "1990-01-02",
      dateOfBirthConfirmedInCurrentExport: false,
    });
    assert.equal(preserved.dateOfBirth.isoDate, "1990-01-02");
    assert.equal(preserved.dateOfBirth.preservedFromPreviousExport, true);
  });
});
