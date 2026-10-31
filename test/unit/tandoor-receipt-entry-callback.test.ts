import assert from "node:assert/strict";
import { it } from "node:test";
import { buildReceiptEntryCallback, parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";
import { isNativeCreateCallback } from "../../src/tanbot/native-create/engine";
import { buildTanTrackerStaffMaxOutboxDelivery } from "../../src/tan-tracker/staff-max-outbox-presentation";
import { buildTanTrackerStaffTelegramOutboxSendBody } from "../../src/tan-tracker/staff-telegram-outbox-presentation";

for (const action of ["code", "cancel", "list", "receive"] as const) {
  it(`receipt ${action}: canonical bounded callback round trip, not a recipient issuing-code callback`, () => {
    const transferId = action === "list" ? "12" : "TT-2026-456";
    const callback = buildReceiptEntryCallback(action, transferId, 3)!;
    assert.ok(Buffer.byteLength(callback) <= 64);
    assert.deepEqual(parseReceiptEntryCallback(callback), { action, transferId, version: 3 });
    assert.equal(isNativeCreateCallback(callback), true);
    assert.ok(!callback.startsWith("hc:"));
  });
}
it("receipt callbacks reject excessive lengths, invalid versions, encoding and unknown actions", () => {
  for (const version of [0, -1, 1.2, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(buildReceiptEntryCallback("code", "TT-2026-123", version), null);
  }
  assert.equal(buildReceiptEntryCallback("code", "a".repeat(100), 1), null);
  assert.equal(buildReceiptEntryCallback("code", "", 1), null);
  assert.equal(buildReceiptEntryCallback("code", "bad\u0000id", 1), null);
  for (const data of ["", "hc:TT-2026-123:1", "he:bad:QQ:1", "he:code:QQ==:1",
    "he:code:QQ:0", "he:code:QQ:1e2", "he:code:QQ:9007199254740992", "he:code:_w:1",
    `he:code:${Buffer.from("bad\u0000id").toString("base64url")}:1`, "a".repeat(100)]) {
    assert.equal(parseReceiptEntryCallback(data), null, data);
  }
});
for (const channel of ["max", "telegram"] as const) {
  it(`${channel}: code notification preserves recipient context but never issues or displays its OTP`, () => {
    const payload = { transferId: "TT-2026-777", publicCode: "TT-2026-777", handoffVersion: 7,
      itemTitle: "Synthetic item", routeFromDisplayName: "Synthetic sender", routeToDisplayName: "Synthetic recipient" };
    const reply = channel === "max"
      ? buildTanTrackerStaffMaxOutboxDelivery("tan_tracker.code_obtained", payload, "https://example.test")
      : buildTanTrackerStaffTelegramOutboxSendBody("tan_tracker.code_obtained", payload, "https://example.test");
    for (const value of ["Synthetic item", "Synthetic sender", "Synthetic recipient", "TT-2026-777", "Ввести код"]) {
      assert.ok(reply.text.includes(value));
    }
    assert.doesNotMatch(reply.text, /https?:\/\/|(?<!\d)\d{6}(?!\d)/);
  });
  it(`${channel}: malformed historical notice safely retains LK fallback instead of an unusable callback`, () => {
    const payload = { publicCode: "TT-2026-777", handoffVersion: 0 };
    const reply = channel === "max"
      ? buildTanTrackerStaffMaxOutboxDelivery("tan_tracker.code_obtained", payload, "https://example.test")
      : buildTanTrackerStaffTelegramOutboxSendBody("tan_tracker.code_obtained", payload, "https://example.test");
    assert.match(reply.text, /https:\/\/example\.test\/tan-tracker#\?/);
  });
}
