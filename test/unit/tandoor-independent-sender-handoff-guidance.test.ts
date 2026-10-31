import assert from "node:assert/strict";
import { it } from "node:test";
import { buildTanTrackerStaffMaxOutboxDelivery } from "../../src/tan-tracker/staff-max-outbox-presentation";
import { buildTanTrackerStaffTelegramOutboxSendBody } from "../../src/tan-tracker/staff-telegram-outbox-presentation";
import { staffNotificationLkCopy, staffNotificationMessengerText } from "../../src/tan-tracker/staff-notification-copy";
import { staffTransferLkDetailUrl } from "../../src/tan-tracker/staff-outbox-shared";
import { SENDER_HANDOFF_GUIDANCE, NATIVE_SENDER_HANDOFF_GUIDANCE } from "../../src/tan-tracker/sender-handoff-guidance";
import { parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";

const payload = { transferId: "TT-2026-042", publicCode: "TT-2026-042", itemTitle: "Синтетический договор",
  handoffVersion: 3, routeFromDisplayName: "Синтетический отправитель", routeToDisplayName: "Синтетический получатель" };
const origin = "https://lk.tandoor.ru";
function instructions(text: string, native = false) {
  assert.ok(text.includes(native ? NATIVE_SENDER_HANDOFF_GUIDANCE : SENDER_HANDOFF_GUIDANCE));
  assert.match(text, /попросите у получателя код приёма/u);
  assert.match(text, /нажмите «Ввести код»/iu);
  assert.match(text, /Только после этого передавайте/u);
  assert.match(text, /От: Синтетический отправитель/u);
  assert.match(text, /Кому: Синтетический получатель/u);
  assert.ok(text.includes(payload.publicCode));
  assert.doesNotMatch(text, /(?<!\d)\d{6}(?!\d)|mst=|person_session=|(?:^|\n)передача подтверждена/imu);
}
it("MAX sender receives native entry instructions and exact versioned transfer callback", () => {
  const r = buildTanTrackerStaffMaxOutboxDelivery("tan_tracker.code_obtained", payload, origin);
  instructions(r.text, true);
  const b = r.inlineButtons?.[0]?.[0];
  assert.ok(b?.type === "callback"); assert.equal(b.text, "Ввести код");
  assert.deepEqual(parseReceiptEntryCallback(b.payload), { action: "code", transferId: payload.transferId, version: 3 });
  assert.doesNotMatch(r.text, /https?:\/\//);
});
it("Telegram sender receives native entry, not a recipient code-generation callback or website link", () => {
  const r = buildTanTrackerStaffTelegramOutboxSendBody("tan_tracker.code_obtained", payload, origin);
  instructions(r.text, true);
  const b = r.reply_markup?.inline_keyboard[0]?.[0];
  assert.equal(b?.text, "Ввести код"); assert.ok(b?.callback_data);
  assert.deepEqual(parseReceiptEntryCallback(b.callback_data), { action: "code", transferId: payload.transferId, version: 3 });
  assert.doesNotMatch(r.text, /https?:\/\//);
  assert.equal(r.disable_web_page_preview, true);
});
it("LK copy explains sender next action; receipt confirms holder transition and preserves safe links", () => {
  instructions(staffNotificationLkCopy("tan_tracker.code_obtained", payload).body);
  const r = staffNotificationMessengerText("tan_tracker.handoff_confirmed", payload, origin);
  assert.ok(!r.includes(SENDER_HANDOFF_GUIDANCE));
  assert.ok(r.endsWith("/tan-tracker"));
  assert.match(r, /Предмет принят новым держателем/u);
  assert.match(r, /Предыдущий отправитель выполнил свой этап/u);
});
it("card identifiers are encoded and never become recipient capabilities", () => {
  const href = staffTransferLkDetailUrl(`${origin}/`, "TT-2026-042&mst=synthetic");
  const u = new URL(href), params = new URLSearchParams(u.hash.slice(2));
  assert.equal(u.origin, origin); assert.equal(u.pathname, "/tan-tracker");
  assert.equal(params.get("tt_id"), "TT-2026-042&mst=synthetic");
  assert.equal(params.get("tt_screen"), "detail"); assert.equal(params.has("mst"), false);
});
