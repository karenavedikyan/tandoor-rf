import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readOptionalRootExchangeString } from "../../src/onec-exchange-v3/normalize";
import { parseLegalRecord } from "../../src/onec-exchange-v3/parse-records";

describe("exchange v3 inn/kpp", () => {
  it("normalizes root strings with trim and leading zeros", () => {
    assert.equal(readOptionalRootExchangeString(" 0123456789 "), "0123456789");
    assert.equal(readOptionalRootExchangeString(""), null);
    assert.equal(readOptionalRootExchangeString(null), null);
    assert.equal(readOptionalRootExchangeString(undefined), null);
    assert.equal(readOptionalRootExchangeString(7707083893), "7707083893");
  });

  it("parseLegalRecord reads root inn/kpp; omitted keys → null", () => {
    const errors: string[] = [];
    const withInn = parseLegalRecord(
      {
        guid_client: "b2000000-0000-4000-8000-000000000001",
        name_client: "SYNTH Legal",
        inn: "0123456789",
        kpp: "",
        other: {},
      },
      errors,
    );
    assert.equal(errors.length, 0);
    assert.ok(withInn);
    assert.equal(withInn!.inn, "0123456789");
    assert.equal(withInn!.kpp, null);

    const omitted = parseLegalRecord(
      {
        guid_client: "b2000000-0000-4000-8000-000000000003",
        name_client: "No Inn Keys",
        other: {},
      },
      errors,
    );
    assert.ok(omitted);
    assert.equal(omitted!.inn, null);
    assert.equal(omitted!.kpp, null);
  });
});
