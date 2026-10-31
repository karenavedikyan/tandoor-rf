import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatTransferContextHeader,
  sanitizeNotificationDisplayName,
} from "../../src/tan-tracker/staff-notification-route";
import { formatIssuedCodeMessage } from "../../src/tanbot/handoff-code-bot-service";

describe("staff notification route display", () => {
  it("sanitize strips control chars and rejects phone/email-like values", () => {
    assert.equal(sanitizeNotificationDisplayName("Anna\n\tBob"), "Anna Bob");
    assert.equal(sanitizeNotificationDisplayName("+79991234567"), null);
    assert.equal(sanitizeNotificationDisplayName("a@b.co"), null);
    assert.equal(sanitizeNotificationDisplayName("x".repeat(120))!.endsWith("…"), true);
  });

  it("formatTransferContextHeader omits unknown route parts", () => {
    const legacy = formatTransferContextHeader({
      publicCode: "TT-1",
      itemTitle: "Box",
    });
    assert.match(legacy, /Передача TT-1/);
    assert.doesNotMatch(legacy, /От:/);
    const full = formatTransferContextHeader({
      publicCode: "TT-2",
      itemTitle: "Doc",
      routeFromDisplayName: "Anna",
      routeToDisplayName: "Ivan",
    });
    assert.match(full, /От: Anna/);
    assert.match(full, /Кому: Ivan/);
  });

  it("issued code primary includes actual code for clipboard parse", () => {
    const text = formatIssuedCodeMessage({
      publicCode: "PUB-1",
      itemTitle: "Item",
      code: "012345",
      expiresAt: Date.UTC(2026, 0, 1, 12, 0, 0),
      replacedPrevious: false,
      routeFromDisplayName: "H",
      routeToDisplayName: "P",
    });
    assert.match(text, /Код приёма: 012345/);
    assert.match(text, /От: H/);
  });
});
