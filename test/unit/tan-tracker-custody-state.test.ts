import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBeforeFirstConfirmedCustody } from "../../src/tan-tracker/custody-state";

describe("tan-tracker custody state", () => {
  it("allows edit while creator still holds", () => {
    assert.equal(
      isBeforeFirstConfirmedCustody({
        id: "x",
        status: "waiting",
        creator_party_id: "a",
        holder_party_id: "a",
      }),
      true,
    );
  });

  it("denies edit after holder changed", () => {
    assert.equal(
      isBeforeFirstConfirmedCustody({
        id: "x",
        status: "active",
        creator_party_id: "a",
        holder_party_id: "b",
      }),
      false,
    );
  });
});
