import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bonusTandoorClubFromAdditional,
  bonusTandoorClubPresentationFromAdditional,
} from "../../src/clients/bonus-tandoor-club";

describe("bonus tandoor club presentation", () => {
  it("uses fieldPresence for hasSource and preserves zero", () => {
    const provided = bonusTandoorClubFromAdditional({
      bonusTandoorClub: "0",
      fieldPresence: { bonusTandoorClub: true },
    });
    assert.equal(provided.hasSource, true);
    assert.equal(provided.value, "0");

    const empty = bonusTandoorClubFromAdditional({
      bonusTandoorClub: "",
      fieldPresence: { bonusTandoorClub: true },
    });
    assert.equal(empty.hasSource, true);
    assert.equal(empty.value, null);

    const notProvided = bonusTandoorClubFromAdditional({
      bonusTandoorClub: "legacy",
    });
    assert.equal(notProvided.hasSource, false);
    assert.equal(notProvided.value, null);
  });

  it("builds labels without invented units", () => {
    const zero = bonusTandoorClubPresentationFromAdditional({
      bonusTandoorClub: "0",
      fieldPresence: { bonusTandoorClub: true },
    });
    assert.equal(zero.label, "0");

    const text = bonusTandoorClubPresentationFromAdditional({
      bonusTandoorClub: "Gold tier",
      fieldPresence: { bonusTandoorClub: true },
    });
    assert.equal(text.label, "Gold tier");
  });
});
