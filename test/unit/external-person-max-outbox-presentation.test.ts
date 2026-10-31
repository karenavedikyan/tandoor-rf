import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMaxExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/max-outbox-presentation";
import { buildMaxSendMessagePayload } from "../../src/tanbot-max/delivery-transport";

const ORIGIN = "http://127.0.0.1:3000";
const HOLDER = `${ORIGIN}/tan-tracker/?cap=abc&tt_hat=def`;

describe("buildMaxExternalPersonOutboxPresentation", () => {
  it("strips trailing same-app holder link and builds share + link button", () => {
    const stored = `Вы получили «Box».\n\nПередача TT-1.\nОткрыть: ${HOLDER}`;
    const pres = buildMaxExternalPersonOutboxPresentation(stored, ORIGIN);
    assert.equal(pres.mode, "rich");
    if (pres.mode !== "rich") return;
    assert.ok(!pres.text.includes("Открыть:"));
    assert.ok(!pres.text.includes("cap="));
    assert.equal(pres.shareUrl, HOLDER);
    assert.equal(pres.inlineButtons[0]![0]!.type, "link");
    const wire = buildMaxSendMessagePayload({
      text: pres.text,
      inlineButtons: pres.inlineButtons,
      shareUrl: pres.shareUrl,
    });
    const attachments = wire.attachments as Array<{ type: string; payload: unknown }>;
    assert.equal(attachments.length, 2);
    assert.equal(attachments[0]!.type, "share");
    assert.deepEqual(attachments[0]!.payload, { url: HOLDER });
    assert.equal(attachments[1]!.type, "inline_keyboard");
  });

  it("keeps plaintext when multiple Открыть lines present", () => {
    const stored = `Открыть: ${HOLDER}\nОткрыть: ${HOLDER}`;
    const pres = buildMaxExternalPersonOutboxPresentation(stored, ORIGIN);
    assert.equal(pres.mode, "plain");
  });

  it("keeps plaintext for foreign URL", () => {
    const foreign = "https://evil.example/tan-tracker/?cap=x";
    const stored = `Текст\nОткрыть: ${foreign}`;
    const pres = buildMaxExternalPersonOutboxPresentation(stored, ORIGIN);
    assert.equal(pres.mode, "plain");
  });

  it("keeps plaintext when item text embeds a URL", () => {
    const stored = `См. https://127.0.0.1:3000/tan-tracker/?cap=1\nОткрыть: ${HOLDER}`;
    const pres = buildMaxExternalPersonOutboxPresentation(stored, ORIGIN);
    assert.equal(pres.mode, "rich");
  });
});
