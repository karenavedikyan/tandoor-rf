import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExternalPersonMessengerBody } from "../../src/tan-tracker/external-person/messenger-copy";

describe("buildExternalPersonMessengerBody receipt/delivered copy", () => {
  const holder = "http://127.0.0.1:3000/tan-tracker/?cap=REDACTED&tt_hat=REDACTED";

  it("after_receipt uses human copy with holder link line", () => {
    const body = buildExternalPersonMessengerBody({
      event: "after_receipt",
      publicCode: "TT-2026-001",
      itemTitle: "Коробка документов",
      holderUrl: holder,
    });
    assert.match(body, /^Вы получили «Коробка документов»\./);
    assert.match(body, /передать предмет дальше или вернуть отправителю/);
    assert.match(body, /Передача TT-2026-001\./);
    assert.match(body, /\nОткрыть: http:\/\/127\.0\.0\.1:3000\/tan-tracker\//);
  });

  it("delivered matches receipt-style copy", () => {
    const body = buildExternalPersonMessengerBody({
      event: "delivered",
      publicCode: "TT-2026-002",
      itemTitle: "",
      holderUrl: holder,
    });
    assert.match(body, /Вы получили «Передача»\./);
    assert.doesNotMatch(body, /доставлена конечному получателю/);
  });

  it("leaves other events unchanged", () => {
    const afterCode = buildExternalPersonMessengerBody({
      event: "after_code",
      publicCode: "TT-1",
      itemTitle: "X",
      holderUrl: holder,
    });
    assert.match(afterCode, /код подтверждён/);
    assert.doesNotMatch(afterCode, /Вы получили/);
  });

  it("supports multiline titles without breaking structure", () => {
    const body = buildExternalPersonMessengerBody({
      event: "after_receipt",
      publicCode: "TT-3",
      itemTitle: 'Line "quoted"\nsecond',
      holderUrl: holder,
    });
    assert.match(body, /Вы получили «Line "quoted"\nsecond»\./);
  });
});
