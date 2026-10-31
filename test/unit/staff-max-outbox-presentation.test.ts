import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  buildStaffExternalCreatedMaxText,
  buildTanTrackerStaffMaxOutboxDelivery,
  staffTransferLkDetailUrl,
} from "../../src/tan-tracker/staff-max-outbox-presentation";

const ORIGIN = "http://127.0.0.1:3000";

describe("staff MAX outbox presentation", () => {
  before(() => {
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
  });

  after(() => {
    delete process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED;
  });

  it("external_created with pilot sends one receipt-code callback button", () => {
    const delivery = buildTanTrackerStaffMaxOutboxDelivery(
      "tan_tracker.external_created",
      {
        transferId: "tt-1",
        publicCode: "EXT-99",
        itemTitle: "Box",
        handoffVersion: 2,
      },
      ORIGIN,
    );
    assert.match(delivery.text, /одноразовый код приёма/i);
    assert.ok(!/\d{6}/.test(delivery.text));
    assert.equal(delivery.inlineButtons?.length, 1);
    assert.equal(delivery.inlineButtons?.[0]?.length, 1);
    const btn = delivery.inlineButtons![0]![0]!;
    assert.equal(btn.type, "callback");
    assert.equal(btn.text, "Получить код приёма");
    assert.equal(btn.payload, "hc:gen:EXT-99:2");
  });

  it("external_created without pilot uses LK detail URL in text", () => {
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "false";
    const delivery = buildTanTrackerStaffMaxOutboxDelivery(
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
    assert.ok(!delivery.inlineButtons?.length);
    assert.ok(delivery.text.includes(staffTransferLkDetailUrl(ORIGIN, "PUB2")));
  });

  it("buildStaffExternalCreatedMaxText never embeds OTP pattern", () => {
    const t = buildStaffExternalCreatedMaxText("Test", "ABC", true);
    assert.ok(!/\d{6}/.test(t));
  });
});
