import assert from "node:assert/strict";
import { it } from "node:test";
import { formatForwardableRecipientInvitation } from "../../src/tanbot/native-create/invitation-handoff";
import { nativeReplyToMax, nativeReplyToTelegram, nativeMaxReplyExtra, nativeTelegramReplyExtra } from "../../src/tanbot/native-create/adapters";
import { parseMaxReplyExtra, parseTelegramReplyExtra, isHandoffReplyFullyDelivered, mergeReplyDeliveryProgress } from "../../src/tanbot/webhook-reply-extra";
import { nextMaxDeliveryStep, nextTelegramDeliveryStep } from "../../src/tanbot/webhook-reply-pair-delivery";

const invitation = formatForwardableRecipientInvitation({
  publicCode: "TT-2026-123", senderName: "Синтетический отправитель",
  recipientName: "Синтетический получатель", item: "Договор",
  portalUrl: "https://example.test/tan-tracker/recipient?mst=synthetic-token",
});
it("invitation has one universal recipient link, context and recipient-only code instructions", () => {
  assert.equal((invitation.match(/https?:\/\//g) ?? []).length, 1);
  for (const text of ["TT-2026-123", "Отправитель: Синтетический отправитель",
    "Получатель: Синтетический получатель", "Предмет: Договор",
    "получите код приёма", "Сообщите код отправителю", "Вход в личный кабинет не нужен"]) {
    assert.ok(invitation.includes(text), text);
  }
  assert.doesNotMatch(invitation, /Или веб|t\.me|max\.ru|Ваш следующий шаг|Ввести код|Мои передачи/u);
});
it("user-supplied context stays on one bounded line", () => {
  const text = formatForwardableRecipientInvitation({
    publicCode: "TT-1", senderName: "Имя\n  Фамилия", recipientName: "А".repeat(2000),
    item: "Б".repeat(3000), portalUrl: "https://example.test/recipient",
  });
  assert.match(text, /Отправитель: Имя Фамилия/u);
  assert.ok(text.length < 2000);
});
for (const channel of ["max", "telegram"] as const) {
  const parse = channel === "max" ? parseMaxReplyExtra : parseTelegramReplyExtra;
  const next = channel === "max" ? nextMaxDeliveryStep : nextTelegramDeliveryStep;
  it(`${channel}: invitation survives adapter and durable extra without code-message conflation`, () => {
    const reply = { text: "Sender only", forwardInvitationText: invitation };
    const scope = { messengerChatId: "123", messengerUserId: "123", actor: "staff" as const, channel };
    const extra = channel === "max"
      ? nativeMaxReplyExtra(nativeReplyToMax(reply), scope)
      : nativeTelegramReplyExtra(nativeReplyToTelegram(reply), scope);
    const parsed = parse(extra);
    assert.equal(parsed.forwardInvitationText, invitation);
    assert.equal(parsed.copyOnlyCode, undefined);
    assert.equal(next(parsed), "primary");
    parsed.delivery = { primary: true };
    assert.equal(next(parsed), "invitation");
    assert.equal(isHandoffReplyFullyDelivered(parsed), false);
    parsed.delivery = mergeReplyDeliveryProgress(parsed.delivery, { invitation: true });
    const stored = parse(JSON.parse(JSON.stringify(parsed)));
    assert.equal(next(stored), "done");
    assert.equal(isHandoffReplyFullyDelivered(stored), true);
  });
  it(`${channel}: malformed invitation metadata is not sent; old code-only ordering remains intact`, () => {
    for (const value of [null, 42, {}, "", "  ", "a".repeat(4001)]) {
      assert.equal(parse({ forwardInvitationText: value }).forwardInvitationText, undefined);
    }
    const old = parse({ copyOnlyCode: "123456", delivery: { primary: true } });
    assert.equal(next(old), "copyOnly");
    assert.equal(isHandoffReplyFullyDelivered(old), false);
    old.delivery = { primary: true, copyOnly: true };
    assert.equal(next(old), "done");
    assert.equal(isHandoffReplyFullyDelivered(old), true);
  });
}
