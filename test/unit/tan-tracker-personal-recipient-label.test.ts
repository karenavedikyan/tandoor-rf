import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TT_PERSONAL_RECIPIENT_LABEL_RESET,
  TT_PERSONAL_RECIPIENT_LABEL_SET,
  attachPersonalRecipientViewsToOrder,
  validatePersonalRecipientName,
  optionalPersonalRecipientName,
} from "../../src/tan-tracker/personal-recipient-label";
import type { TanTrackerOrderDto } from "../../src/tan-tracker/types";

describe("tan-tracker personal recipient label", () => {
  it("validates name length and control chars", () => {
    assert.equal(validatePersonalRecipientName("  Саша  монтажник  "), "Саша монтажник");
    assert.throws(() => validatePersonalRecipientName(""), /Укажите имя/);
    assert.throws(() => validatePersonalRecipientName("a".repeat(121)), /120/);
    assert.throws(() => validatePersonalRecipientName("\u0007"), /Укажите имя/);
    assert.throws(() => optionalPersonalRecipientName({ bad: true }), /текстом/);
  });

  it("attaches per-party private views without mutating canonical map", () => {
    const dto: TanTrackerOrderDto = {
      id: "TT-2026-001",
      item: "x",
      holderId: "h1",
      pendingId: "p1",
      finalRecipientId: "p1",
      status: "waiting",
      dueAt: null,
      comment: "",
      holderSince: 1,
      timeline: [],
    };
    const labels = new Map([
      [
        "p1",
        {
          recipientPartyId: "p1",
          personalName: "Саша монтажник",
          editedAt: new Date("2026-11-01T10:00:00Z"),
          editorUserId: "u1",
          editorDisplayName: "Автор А",
        },
      ],
    ]);
    const canonical = new Map([["p1", "Александр Иванов"]]);
    attachPersonalRecipientViewsToOrder(dto, labels, canonical);
    assert.equal(dto.personalRecipientViews?.p1.personalName, "Саша монтажник");
    assert.equal(dto.personalRecipientViews?.p1.canonicalName, "Александр Иванов");
    assert.equal(TT_PERSONAL_RECIPIENT_LABEL_SET, "personal_recipient_label_set");
    assert.equal(TT_PERSONAL_RECIPIENT_LABEL_RESET, "personal_recipient_label_reset");
  });
});
