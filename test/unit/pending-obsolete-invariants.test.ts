import assert from "node:assert/strict";
import { it } from "node:test";
import { transferWriteBlocked } from "../../src/tan-tracker/transfer-write-guard";
import { isBeforeFirstConfirmedCustody } from "../../src/tan-tracker/custody-state";
import { checkTransferCompletionAccess } from "../../src/tan-tracker/legacy-complete-mutation";
import { formatNotificationTransferState, normalizeNotificationTransferState } from "../../src/tan-tracker/notification-transfer-state";
import { staffNotificationLkCopy, staffNotificationMessengerText } from "../../src/tan-tracker/staff-notification-copy";
import { buildExternalPersonMessengerBody } from "../../src/tan-tracker/external-person/messenger-copy";

it("obsolete blocks writes and completion without pretending first custody or successful completion", () => {
  assert.equal(transferWriteBlocked({ status: "obsolete" }), true);
  assert.equal(transferWriteBlocked({ status: "waiting" }), false);
  assert.equal(isBeforeFirstConfirmedCustody({ id: "fixture", status: "obsolete", first_custody_at: null,
    creator_party_id: "a", holder_party_id: "a" }), false);
  const completion = checkTransferCompletionAccess({ status: "obsolete", actingPartyId: "a", holderPartyId: "a",
    finalRecipientPartyId: "a", pendingPartyId: null, allowLegacyComplete: true });
  assert.equal(completion.ok, false);
});
it("obsolete notification state remains distinct from done, received and waiting", () => {
  const state = normalizeNotificationTransferState({ phase: "obsolete", holderName: "Synthetic holder" });
  assert.ok(state);
  assert.equal(state.phase, "obsolete");
  assert.equal(formatNotificationTransferState(state), "Статус: Неактуален\nПоследний держатель: Synthetic holder");
});
it("all obsolete close notification surfaces explicitly say no receipt was confirmed", () => {
  const notificationState = { phase: "obsolete" as const, holderName: "Synthetic holder" };
  const payload = { transferId: "TT-2026-999", publicCode: "TT-2026-999", itemTitle: "Synthetic item",
    handoffVersion: 2, notificationState };
  const lk = staffNotificationLkCopy("tan_tracker.closed", payload);
  assert.equal(lk.title, "Неактуален");
  for (const text of [lk.body, staffNotificationMessengerText("tan_tracker.closed", payload, "https://example.test"),
    buildExternalPersonMessengerBody({ event: "closed", publicCode: payload.publicCode, itemTitle: payload.itemTitle,
      notificationState, shellUrl: "https://example.test" })]) {
    assert.match(text, /неактуальн/i);
    assert.match(text, /не подтверждено/);
    assert.doesNotMatch(text, /Передача завершена|Вы получили|Вам передали/);
  }
});
