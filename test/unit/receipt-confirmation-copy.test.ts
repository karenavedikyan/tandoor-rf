import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatReceiptConfirmation } from "../../src/tan-tracker/receipt-confirmation-copy";
import { staffNotificationMessengerText } from "../../src/tan-tracker/staff-notification-copy";
import { buildTanTrackerStaffOutboxMessage } from "../../src/tan-tracker/tan-tracker-outbox-messages";
import { buildExternalPersonMessengerBody } from "../../src/tan-tracker/external-person/messenger-copy";
import { buildTanTrackerStaffMaxOutboxDelivery } from "../../src/tan-tracker/staff-max-outbox-presentation";
import { buildTanTrackerStaffTelegramOutboxSendBody } from "../../src/tan-tracker/staff-telegram-outbox-presentation";
import type { NotificationTransferState } from "../../src/tan-tracker/notification-transfer-state";

const origin = "https://lk.example.test";
const received: NotificationTransferState = {
  phase: "received", holderName: "Получатель",
};
const snapshot = {
  publicCode: "TT-2026-021", itemTitle: "Коробка документов",
  routeFromDisplayName: "Отправитель", routeToDisplayName: "Получатель",
  notificationState: received,
};

describe("clear confirmed receipt copy", () => {
  for (const audience of ["recipient", "sender", "observer"] as const) {
    it(`${audience}: result first, event-time context and authoritative status below`, () => {
      const text = formatReceiptConfirmation({ ...snapshot, audience });
      assert.ok(text.startsWith("ГОТОВО ✅\n\n"));
      assert.match(text, audience === "recipient" ? /Вам передали/ : audience === "sender" ? /Вы передали/ : /Получение «Коробка документов» подтверждено/);
      if (audience !== "recipient") assert.doesNotMatch(text, /Вам передали/);
      assert.match(text, /Передача TT-2026-021\nОт: Отправитель\nКому: Получатель/);
      assert.match(text, /Статус и детали:\nСтатус: Получение подтверждено\nОтветственный: Получатель/);
      assert.doesNotMatch(text, /Статус: Завершена|Предмет принят конечным|Получение не завершает|заказ номер/i);
    });
  }
  it("legacy/malformed staff audience stays neutral; both presentation pipelines preserve copy", () => {
    for (const audience of [undefined, "admin", "recipient"]) {
      const payload = { ...snapshot, transferId: "synthetic-id", receiptAudience: audience };
      const body = buildTanTrackerStaffOutboxMessage("tan_tracker.delivered", payload, origin);
      assert.ok(body.startsWith("ГОТОВО ✅"));
      assert.equal(body.includes("Вам передали"), audience === "recipient");
      for (const presentation of [
        buildTanTrackerStaffMaxOutboxDelivery("tan_tracker.delivered", payload, origin),
        buildTanTrackerStaffTelegramOutboxSendBody("tan_tracker.delivered", payload, origin),
      ]) assert.equal(presentation.text, body);
    }
  });
  it("received assignment is specifically for its new holder; waiting assignment is not success", () => {
    assert.match(staffNotificationMessengerText("tan_tracker.assignment", snapshot, origin), /Вам передали/);
    const waiting = { ...snapshot, notificationState: { ...received, phase: "waiting" as const } };
    assert.doesNotMatch(staffNotificationMessengerText("tan_tracker.assignment", waiting, origin), /ГОТОВО|Вам передали/);
    assert.doesNotMatch(staffNotificationMessengerText("tan_tracker.delivered", waiting, origin), /ГОТОВО|Вам передали/);
  });
  it("closed/code-issued/continued events do not use receipt-success heading", () => {
    for (const event of ["tan_tracker.code_obtained", "tan_tracker.closed", "tan_tracker.continued"] as const) {
      assert.doesNotMatch(staffNotificationMessengerText(event, snapshot, origin), /ГОТОВО ✅|Вам передали/);
    }
    assert.doesNotMatch(buildExternalPersonMessengerBody({
      ...snapshot, event: "closed", notificationState: { ...received, phase: "done" },
    }), /ГОТОВО ✅|Вам передали/);
  });
  it("external sender and receiver get different clear copy; no link or OTP is invented", () => {
    for (const event of ["after_code", "after_receipt", "delivered"] as const) {
      const body = buildExternalPersonMessengerBody({
        ...snapshot, event, holderUrl: `${origin}/tan-tracker`,
      });
      assert.match(body, event === "after_code" ? /Вы передали/ : /Вам передали/);
      assert.ok(body.endsWith(`Открыть: ${origin}/tan-tracker`));
      assert.doesNotMatch(body, /Код приёма:|\b\d{6}\b|Статус: Завершена/);
    }
  });
});
