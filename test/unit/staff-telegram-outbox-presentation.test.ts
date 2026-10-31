import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  buildTanTrackerStaffTelegramOutboxSendBody,
} from "../../src/tan-tracker/staff-telegram-outbox-presentation";
import { staffTransferLkDetailUrl } from "../../src/tan-tracker/staff-outbox-shared";
import { buildHandoffGenCallback } from "../../src/tanbot/handoff-code-bot-service";

const ORIGIN = "http://127.0.0.1:3000";

describe("staff Telegram outbox presentation", () => {
  before(() => {
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
  });

  after(() => {
    delete process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED;
  });

  it("external_created with pilot sends one receipt-code inline callback", () => {
    const body = buildTanTrackerStaffTelegramOutboxSendBody(
      "tan_tracker.external_created",
      {
        transferId: "tt-1",
        publicCode: "EXT-99",
        itemTitle: "Box",
        handoffVersion: 2,
      },
      ORIGIN,
    );
    assert.match(body.text, /одноразовый код приёма/i);
    assert.equal(body.disable_web_page_preview, true);
    assert.equal(body.reply_markup?.inline_keyboard?.length, 1);
    const btn = body.reply_markup!.inline_keyboard![0]![0]!;
    assert.equal(btn.text, "Получить код приёма");
    assert.equal(btn.callback_data, buildHandoffGenCallback("EXT-99", 2));
    assert.ok(btn.callback_data!.length <= 64);
    assert.ok(!/\d{6}/.test(body.text));
  });

  it("external_created without pilot uses LK detail URL with preview disabled", () => {
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "false";
    const body = buildTanTrackerStaffTelegramOutboxSendBody(
      "tan_tracker.external_created",
      {
        transferId: "tt-2",
        publicCode: "PUB2",
        itemTitle: "Item",
        handoffVersion: 1,
      },
      ORIGIN,
    );
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
    assert.ok(!body.reply_markup?.inline_keyboard?.length);
    assert.ok(body.text.includes(staffTransferLkDetailUrl(ORIGIN, "PUB2")));
    assert.equal(body.disable_web_page_preview, true);
  });
});
