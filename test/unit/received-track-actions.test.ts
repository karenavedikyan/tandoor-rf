import assert from "node:assert/strict";
import { it } from "node:test";
import { receivedTrackStaffCallback, receivedTrackMenuCallback } from "../../src/tan-tracker/received-track-actions";
import { parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";
import { parseNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { buildTanTrackerStaffMaxOutboxDelivery } from "../../src/tan-tracker/staff-max-outbox-presentation";
import { buildTanTrackerStaffTelegramOutboxSendBody } from "../../src/tan-tracker/staff-telegram-outbox-presentation";
import { buildMaxExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/max-outbox-presentation";
import { buildTelegramExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/telegram-outbox-presentation";

for (const event of ["tan_tracker.handoff_confirmed", "tan_tracker.delivered"]) {
  it(`${event}: only frozen recipient gets a version-bound actions callback`, () => {
    const payload = { transferId: "TT-2026-123", publicCode: "TT-2026-123", handoffVersion: 4 };
    for (const receiptAudience of ["sender", "observer", undefined]) {
      assert.equal(receivedTrackStaffCallback(event, { ...payload, receiptAudience }), null);
    }
    const p = { ...payload, receiptAudience: "recipient" };
    const callback = receivedTrackStaffCallback(event, p)!;
    assert.deepEqual(parseReceiptEntryCallback(callback), { action: "pick", transferId: payload.transferId, version: 4 });
    const max = buildTanTrackerStaffMaxOutboxDelivery(event, p, "https://example.test");
    const tg = buildTanTrackerStaffTelegramOutboxSendBody(event, p, "https://example.test");
    assert.equal(max.inlineButtons?.[0]?.[0]?.type, "callback");
    assert.equal(tg.reply_markup?.inline_keyboard[0]?.[0]?.callback_data, callback);
    assert.equal(receivedTrackStaffCallback(event, { ...p, handoffVersion: 0 }), null);
  });
}
it("unrelated staff notices never gain holder actions", () => {
  assert.equal(receivedTrackStaffCallback("tan_tracker.closed", { receiptAudience: "recipient" }), null);
});
it("received intermediate staff assignment gets actions; pending assignment does not", () => {
  const payload = { transferId: "TT-2026-123", handoffVersion: 4 };
  assert.equal(receivedTrackStaffCallback("tan_tracker.assignment", payload), null);
  const notificationState = {
    phase: "received", status: "active", holderName: "Synthetic holder", pendingName: null,
    firstCustodyAt: "2026-11-02T10:00:00Z",
  };
  assert.ok(receivedTrackStaffCallback("tan_tracker.assignment", { ...payload, notificationState }));
});
for (const withLink of [false, true]) {
  it(`external receipt ${withLink ? "rich" : "plain"}: safe authenticated list entry, no guessed track/identity`, () => {
    const origin = "https://example.test";
    const body = "ГОТОВО ✅\n\nВам передали «Synthetic item».\nПередача TT-2026-123"
      + (withLink ? `\nОткрыть: ${origin}/tan-tracker/?tt_hat=synthetic` : "");
    const callback = receivedTrackMenuCallback(body)!;
    assert.equal(parseNativeCreateCallback(callback)?.action, "menu_my");
    const max = buildMaxExternalPersonOutboxPresentation(body, origin);
    const tg = buildTelegramExternalPersonOutboxPresentation(body, origin);
    const maxButton = max.inlineButtons?.[0]?.[0];
    assert.ok(maxButton?.type === "callback" && maxButton.payload === callback);
    assert.equal(tg.replyMarkup?.inline_keyboard[0]?.[0]?.callback_data, callback);
    assert.equal(receivedTrackMenuCallback("ГОТОВО ✅\n\nВы передали «Synthetic item»."), null);
    assert.equal(receivedTrackMenuCallback("Обычное уведомление"), null);
  });
}
