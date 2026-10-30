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
    const on = buildMessengerLinkSuccessReply({ channelLabel: "Telegram", notificationsEnabled: true });
    assert.match(on, /включены/);
    const off = buildMessengerLinkSuccessReply({ channelLabel: "Telegram", notificationsEnabled: false });
    assert.match(off, /выключены/);
    assert.doesNotMatch(off, /включены/);
  });
});
