import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTransferCompletionAccess } from "../../src/tan-tracker/legacy-complete-mutation";

const base = {
  status: "delivered", actingPartyId: "holder", holderPartyId: "holder",
  pendingPartyId: null, finalRecipientPartyId: "holder", allowLegacyComplete: false,
};
describe("only the current holder can finish a transfer", () => {
  it("permits current holder, not former holder, creator, admin or unrelated actor", () => {
    assert.equal(checkTransferCompletionAccess(base).ok, true);
    for (const actingPartyId of ["creator", "former-holder", "admin", "unrelated", ""]) {
      const r = checkTransferCompletionAccess({ ...base, actingPartyId });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.http, 403);
    }
  });
  it("preserves pending, final-recipient and terminal guards", () => {
    for (const patch of [
      { pendingPartyId: "next" }, { finalRecipientPartyId: "next" },
      { status: "completed" }, { status: "cancelled" },
    ]) assert.equal(checkTransferCompletionAccess({ ...base, ...patch }).ok, false);
    assert.equal(checkTransferCompletionAccess({ ...base, finalRecipientPartyId: "next", allowLegacyComplete: true }).ok, true);
    assert.equal(checkTransferCompletionAccess({ ...base, status: "active", finalRecipientPartyId: null }).ok, true);
  });
});
