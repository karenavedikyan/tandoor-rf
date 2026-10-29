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

  it("denies edit after first_custody_at is set", () => {
    assert.equal(
      isBeforeFirstConfirmedCustody({
        id: "x",
        status: "active",
        creator_party_id: "a",
        holder_party_id: "b",
        first_custody_at: new Date("2026-01-01T00:00:00Z"),
      }),
      false,
    );
  });

  it("allows edit when holder is creator again but first custody never confirmed", () => {
    assert.equal(
      isBeforeFirstConfirmedCustody({
        id: "x",
        status: "active",
        creator_party_id: "a",
        holder_party_id: "a",
        first_custody_at: null,
      }),
      true,
    );
  });
});
