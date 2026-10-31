import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatNotificationTransferState, normalizeNotificationTransferState } from "../../src/tan-tracker/notification-transfer-state";
import { staffNotificationLkCopy, staffNotificationMessengerText } from "../../src/tan-tracker/staff-notification-copy";
import { buildTanTrackerStaffOutboxMessage } from "../../src/tan-tracker/tan-tracker-outbox-messages";
import { buildExternalPersonMessengerBody } from "../../src/tan-tracker/external-person/messenger-copy";
import { formatIssuedCodeMessage } from "../../src/tanbot/handoff-code-bot-service";
import { parseHandoffCodePaste } from "../../src/tan-tracker/handoff-code-paste-parse";
import { formatForwardableRecipientInvitation } from "../../src/tanbot/native-create/invitation-handoff";
import { buildTanTrackerStaffMaxOutboxDelivery } from "../../src/tan-tracker/staff-max-outbox-presentation";
import { buildTanTrackerStaffTelegramOutboxSendBody } from "../../src/tan-tracker/staff-telegram-outbox-presentation";
import { buildMaxExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/max-outbox-presentation";
import { buildTelegramExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/telegram-outbox-presentation";

const base = { transferId: "TT-SYNTHETIC", publicCode: "TT-2026-42", itemTitle: "Документы",
  handoffVersion: 2, routeFromDisplayName: "Оазис", routeToDisplayName: "Карина" };
describe("messenger transfer lifecycle state", () => {
  it("formats the four registry statuses and never replaces holder with pending receiver", () => {
    assert.equal(formatNotificationTransferState({ phase: "ready", holderName: "Оазис" }),
      "Статус: Ожидает передачи\nОтветственный: Оазис");
    assert.equal(formatNotificationTransferState({ phase: "waiting", holderName: "Оазис", pendingName: "Карина" }),
      "Статус: Ожидает приёма · Карина\nОтветственный: Оазис");
    assert.equal(formatNotificationTransferState({ phase: "received", holderName: "Карина" }),
      "Статус: Получение подтверждено\nОтветственный: Карина");
    assert.equal(formatNotificationTransferState({ phase: "done", holderName: "Карина" }),
      "Статус: Завершена\nПоследний держатель: Карина");
  });
  it("validates legacy/unknown payloads, strips contact-only names and control characters", () => {
    for (const value of [undefined, null, [], "waiting", { phase: "active" }, { phase: 1 },
      { phase: { toString: () => "waiting" } }]) assert.equal(normalizeNotificationTransferState(value), undefined);
    assert.equal(formatNotificationTransferState(undefined), "");
    assert.deepEqual(normalizeNotificationTransferState({ phase: "waiting", holderName: "Оазис\n\tСклад",
      pendingName: "+79991234567", phone: "+79991234567" }), { phase: "waiting", holderName: "Оазис Склад" });
    assert.equal(formatNotificationTransferState({ phase: "waiting", holderName: "person@example.com" }),
      "Статус: Ожидает приёма · Получатель не указан\nОтветственный: Не указан");
    assert.deepEqual(normalizeNotificationTransferState({ phase: "done", holderName: "Карина", pendingName: "Оазис" }),
      { phase: "done", holderName: "Карина" });
  });
  it("uses frozen state rather than an ambiguous assignment event or old route", () => {
    const waiting = staffNotificationMessengerText("tan_tracker.assignment", {
      ...base, notificationState: { phase: "waiting", holderName: "Оазис", pendingName: "Карина" },
    }, "https://lk.tandoor.ru");
    assert.match(waiting, /Ответственный: Оазис/);
    assert.match(waiting, /Получите код приёма/);
    const received = staffNotificationMessengerText("tan_tracker.assignment", {
      ...base, notificationState: { phase: "received", holderName: "Карина" },
    }, "https://lk.tandoor.ru");
    assert.match(received, /Получение подтверждено\nОтветственный: Карина/);
    assert.doesNotMatch(received, /Получите код приёма|Ответственный: Оазис/);
    const legacy = buildTanTrackerStaffOutboxMessage("tan_tracker.assignment", base, "https://lk.tandoor.ru");
    assert.match(legacy, /Вам назначена передача/);
    assert.doesNotMatch(legacy, /Статус:|Ответственный:|Получите код/);
  });
  it("distinguishes receipt from closing for both staff and external notifications", () => {
    for (const event of ["tan_tracker.handoff_confirmed", "tan_tracker.delivered"] as const) {
      const copy = staffNotificationLkCopy(event, { ...base, notificationState: { phase: "received", holderName: "Карина" } });
      assert.equal(copy.title, "Получение подтверждено");
      assert.match(copy.body, /Статус: Получение подтверждено/);
      assert.doesNotMatch(copy.body, /Статус: Завершена/);
    }
    const body = buildExternalPersonMessengerBody({ ...base, event: "after_code",
      notificationState: { phase: "received", holderName: "Карина" }, holderUrl: "https://lk.tandoor.ru/example" });
    assert.match(body, /Ваш этап завершён, ответственность перешла новому держателю/);
    assert.match(body, /Ответственный: Карина/);
    const closed = buildExternalPersonMessengerBody({ ...base, event: "closed",
      notificationState: { phase: "done", holderName: "Карина" } });
    assert.match(closed, /Статус: Завершена\nПоследний держатель: Карина/);
    assert.doesNotMatch(closed, /Ответственный:/);
  });
  it("keeps contextual OTP message parseable and forwarded invitation limited to one link", () => {
    const primary = formatIssuedCodeMessage({ ...base, code: "012345", expiresAt: Date.UTC(2026, 10, 1),
      replacedPrevious: false });
    assert.match(primary, /Статус: Ожидает приёма · Карина\nОтветственный: Оазис/);
    assert.match(primary, /Выдача кода ещё не подтверждает получение/);
    assert.deepEqual(parseHandoffCodePaste(primary), { ok: true, code: "012345" });
    const invite = formatForwardableRecipientInvitation({ publicCode: base.publicCode, senderName: "Оазис",
      recipientName: "Карина", item: base.itemTitle, portalUrl: "https://lk.tandoor.ru/example" });
    assert.match(invite, /Статус: Ожидает приёма · Карина/);
    assert.equal((invite.match(/https:\/\//g) ?? []).length, 1);
  });
  it("preserves waiting state on actual native code-button presentations in both messengers", () => {
    const previous = process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED;
    try {
      for (const enabled of ["true", "false"]) {
        process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = enabled;
        for (const event of ["tan_tracker.external_created", "tan_tracker.code_obtained"] as const) {
          const payload = { ...base, notificationState: { phase: "waiting", holderName: "Оазис", pendingName: "Карина" } };
          const max = buildTanTrackerStaffMaxOutboxDelivery(event, payload, "https://lk.tandoor.ru");
          const telegram = buildTanTrackerStaffTelegramOutboxSendBody(event, payload, "https://lk.tandoor.ru");
          for (const text of [max.text, telegram.text]) {
            assert.match(text, /Статус: Ожидает приёма · Карина\nОтветственный: Оазис/);
            assert.match(text, /От: Оазис/);
            assert.match(text, /Кому: Карина/);
          }
          if (event === "tan_tracker.code_obtained") {
            assert.equal(max.inlineButtons?.[0]?.[0]?.text, "Ввести код");
            assert.equal(telegram.reply_markup?.inline_keyboard?.[0]?.[0]?.text, "Ввести код");
          } else if (enabled === "true") {
            assert.equal(max.inlineButtons?.[0]?.[0]?.text, "Получить код приёма");
            assert.equal(telegram.reply_markup?.inline_keyboard?.[0]?.[0]?.text, "Получить код приёма");
          }
        }
      }
    } finally {
      if (previous === undefined) delete process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED;
      else process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = previous;
    }
  });
  it("preserves received and closed statuses through external rich presentations in both messengers", () => {
    for (const phase of ["received", "done"] as const) {
      const body = buildExternalPersonMessengerBody({ ...base, event: phase === "done" ? "closed" : "after_receipt",
        notificationState: { phase, holderName: "Карина" },
        holderUrl: "https://lk.tandoor.ru/tan-tracker/?cap=SYNTHETIC_CAP&tt_hat=SYNTHETIC_HAT" });
      const max = buildMaxExternalPersonOutboxPresentation(body, "https://lk.tandoor.ru");
      const telegram = buildTelegramExternalPersonOutboxPresentation(body, "https://lk.tandoor.ru");
      for (const presentation of [max, telegram]) {
        assert.equal(presentation.mode, "rich");
        assert.match(presentation.text, phase === "done"
          ? /Статус: Завершена\nПоследний держатель: Карина/
          : /Статус: Получение подтверждено\nОтветственный: Карина/);
        assert.doesNotMatch(presentation.text, /SYNTHETIC_CAP|SYNTHETIC_HAT/);
      }
    }
  });
});
