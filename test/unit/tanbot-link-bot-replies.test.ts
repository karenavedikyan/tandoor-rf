import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMessengerLinkSuccessReply, buildMessengerPlainStartReply } from "../../src/tanbot/link-bot-replies";

describe("tanbot link bot replies", () => {
  it("plain start reflects linked and notification state", () => {
    const linkedOn = buildMessengerPlainStartReply({
      channelLabel: "Telegram",
      linked: true,
      notificationsEnabled: true,
      profileUrl: "http://x/profile",
    });
    assert.match(linkedOn, /уже подключён/);
    assert.match(linkedOn, /включены/);

    const linkedOff = buildMessengerPlainStartReply({
      channelLabel: "Telegram",
      linked: true,
      notificationsEnabled: false,
      profileUrl: "http://x/profile",
    });
    assert.match(linkedOff, /выключены/);

    const unlinked = buildMessengerPlainStartReply({
      channelLabel: "MAX",
      linked: false,
      notificationsEnabled: false,
      profileUrl: "http://x/profile",
    });
    assert.match(unlinked, /не подключён/);
  });

  it("link success does not claim notifications when disabled", () => {
    const on = buildMessengerLinkSuccessReply({ channelLabel: "Telegram", notificationsEnabled: true, phoneE164: "+79000000001" });
    assert.match(on, /включены/);
    const off = buildMessengerLinkSuccessReply({ channelLabel: "Telegram", notificationsEnabled: false, phoneE164: "+79000000002" });
    assert.match(off, /выключены/);
    assert.doesNotMatch(off, /включены/);
    assert.match(on, /для номера \+79000000001 успешно подключены/);
    assert.match(off, /Номер в ЛК: \+79000000002/);
    assert.doesNotMatch(off, /успешно подключены/);
    assert.doesNotMatch(on, /Номер подтверждён/);
  });
  it("does not invent a phone for a legacy binding", () => {
    const text = buildMessengerLinkSuccessReply({ channelLabel: "MAX", notificationsEnabled: true, phoneE164: null });
    assert.match(text, /Номер этой привязки в ЛК не указан/);
    assert.doesNotMatch(text, /\+7|для номера/);
  });
});
