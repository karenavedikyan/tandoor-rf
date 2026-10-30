import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExternalCreatorDeliveredCloseDenied } from "../../src/tan-tracker/legacy-complete-mutation";

describe("legacy complete external creator guard", () => {
  it("denies creator-delivered close only when creator party kind is external", () => {
    assert.equal(
      isExternalCreatorDeliveredCloseDenied({
        creatorPartyKind: "external",
        isCreatorClosingDelivered: true,
      }),
      true,
    );
    assert.equal(
      isExternalCreatorDeliveredCloseDenied({
        creatorPartyKind: "user",
        isCreatorClosingDelivered: true,
      }),
      false,
    );
    assert.equal(
      isExternalCreatorDeliveredCloseDenied({
        creatorPartyKind: "external",
        isCreatorClosingDelivered: false,
      }),
      false,
    );
  });
});
