import assert from "node:assert/strict";
import { it } from "node:test";
import { buildTanTrackerStaffMaxOutboxDelivery } from "../../src/tan-tracker/staff-max-outbox-presentation";
import { buildTanTrackerStaffTelegramOutboxSendBody } from "../../src/tan-tracker/staff-telegram-outbox-presentation";
import { staffNotificationLkCopy, staffNotificationMessengerText } from "../../src/tan-tracker/staff-notification-copy";
import { staffTransferLkDetailUrl } from "../../src/tan-tracker/staff-outbox-shared";
import { SENDER_HANDOFF_GUIDANCE } from "../../src/tan-tracker/sender-handoff-guidance";

const payload = { transferId: "TT-2026-042", publicCode: "TT-2026-042", itemTitle: "Синтетический договор",
  handoffVersion: 3, routeFromDisplayName: "Синтетический отправитель", routeToDisplayName: "Синтетический получатель" };
const origin = "https://lk.tandoor.ru";
function instructions(text: string) {
  assert.ok(text.includes(SENDER_HANDOFF_GUIDANCE));
  assert.match(text, /попросите у получателя код приёма/u);
  assert.match(text, /нажмите «Ввести код»/u);
  assert.match(text, /дождитесь подтверждения\. Только после этого передавайте/u);
  assert.match(text, /От: Синтетический отправитель/u);
  assert.match(text, /Кому: Синтетический получатель/u);
  assert.ok(text.includes(payload.publicCode));
  assert.doesNotMatch(text, /(?<!\d)\d{6}(?!\d)|mst=|person_session=|передача подтверждена/iu);
}
it("MAX sender is told how to obtain and enter code before physical handoff; button opens exact authenticated card", () => {
  const r = buildTanTrackerStaffMaxOutboxDelivery("tan_tracker.code_obtained", payload, origin);
  instructions(r.text);
  assert.deepEqual(r.inlineButtons, [[{ type: "link", text: "Открыть передачу",
    url: staffTransferLkDetailUrl(origin, payload.publicCode) }]]);
  assert.ok(r.text.includes("#?tt_screen=detail&tt_id=TT-2026-042"));
});
it("Telegram sender receives same instructions and exact card link, not a recipient code-generation callback", () => {
  const r = buildTanTrackerStaffTelegramOutboxSendBody("tan_tracker.code_obtained", payload, origin);
  instructions(r.text);
  assert.deepEqual(r.reply_markup?.inline_keyboard, [[{ text: "Открыть передачу",
    url: staffTransferLkDetailUrl(origin, payload.publicCode) }]]);
  assert.equal(r.disable_web_page_preview, true);
});
it("LK copy explains sender next action; unrelated event copy and links remain unchanged", () => {
  instructions(staffNotificationLkCopy("tan_tracker.code_obtained", payload).body);
  const r = staffNotificationMessengerText("tan_tracker.handoff_confirmed", payload, origin);
  assert.ok(!r.includes(SENDER_HANDOFF_GUIDANCE));
  assert.ok(r.endsWith("/tan-tracker"));
  assert.match(r, /Передача подтверждена по коду/u);
});
it("card identifiers are encoded and never become recipient capabilities", () => {
  const href = staffTransferLkDetailUrl(`${origin}/`, "TT-2026-042&mst=synthetic");
  const u = new URL(href), params = new URLSearchParams(u.hash.slice(2));
  assert.equal(u.origin, origin); assert.equal(u.pathname, "/tan-tracker");
  assert.equal(params.get("tt_id"), "TT-2026-042&mst=synthetic");
  assert.equal(params.get("tt_screen"), "detail"); assert.equal(params.has("mst"), false);
});
