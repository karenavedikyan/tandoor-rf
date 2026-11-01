import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundRecipientPartyIdForPersonalLabel,
  canonicalRecipientSummaryLine,
  personalNameForNativeCreate,
  syncPersonalLabelPartyBinding,
} from "../../src/tanbot/native-create/personal-recipient-draft";
import type { NativeCreateDraftPayload } from "../../src/tanbot/native-create/draft-scope";

describe("native personal recipient draft fields", () => {
  it("keeps personal name when rebinding same party", () => {
    const p = {
      draftOrigin: "native_bot",
      revision: 1,
      actor: "staff",
      recipientPersonalNameForMe: "Саша монтажник",
      recipientPersonalLabelPartyId: "p1",
    } as NativeCreateDraftPayload;
    syncPersonalLabelPartyBinding(p, "p1");
    assert.equal(p.recipientPersonalNameForMe, "Саша монтажник");
  });

  it("clears personal name when party binding changes", () => {
    const p = {
      draftOrigin: "native_bot",
      revision: 1,
      actor: "staff",
      recipientPersonalNameForMe: "Саша монтажник",
      recipientPersonalLabelPartyId: "p1",
    } as NativeCreateDraftPayload;
    syncPersonalLabelPartyBinding(p, "p2");
    assert.equal(p.recipientPersonalNameForMe, undefined);
    assert.equal(p.recipientPersonalLabelPartyId, "p2");
  });

  it("separates canonical summary from personal create field", () => {
    const p = {
      draftOrigin: "native_bot",
      revision: 1,
      actor: "staff",
      recipientDisplayName: "Canonical Staff",
      recipientPersonalNameForMe: "Мой ярлык",
      recipientPartyId: "p1",
    } as NativeCreateDraftPayload;
    assert.equal(canonicalRecipientSummaryLine(p), "Canonical Staff");
    assert.equal(personalNameForNativeCreate(p), "Мой ярлык");
    assert.equal(boundRecipientPartyIdForPersonalLabel(p), "p1");
  });
});
