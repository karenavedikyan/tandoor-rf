import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTelegramExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/telegram-outbox-presentation";
import { buildMaxExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/max-outbox-presentation";

const ORIGIN = "http://127.0.0.1:3000";
const HOLDER = `${ORIGIN}/tan-tracker/?cap=abc&tt_hat=def`;

describe("buildTelegramExternalPersonOutboxPresentation", () => {
  it("rich mode: clean text, URL button, branded public preview URL only", () => {
    const stored = `Вы получили «Box».\n\nПередача TT-1.\nОткрыть: ${HOLDER}`;
    const pres = buildTelegramExternalPersonOutboxPresentation(stored, ORIGIN);
    assert.equal(pres.mode, "rich");
    if (pres.mode !== "rich") return;
    assert.ok(!pres.text.includes("Открыть:"));
    assert.ok(!pres.text.includes("cap="));
    assert.equal(pres.replyMarkup.inline_keyboard[0]![0]!.url, HOLDER);
    assert.equal(pres.linkPreviewOptions.url, `${ORIGIN}/tan-tracker/`);
    assert.equal(pres.linkPreviewOptions.is_disabled, false);
    assert.equal(pres.linkPreviewOptions.prefer_large_media, true);
    assert.notEqual(pres.linkPreviewOptions.url, HOLDER);
  });

  it("plain mode matches MAX plain decision for foreign URL", () => {
    const foreign = "https://evil.example/tan-tracker/?cap=x";
    const stored = `Текст\nОткрыть: ${foreign}`;
    const tg = buildTelegramExternalPersonOutboxPresentation(stored, ORIGIN);
    const max = buildMaxExternalPersonOutboxPresentation(stored, ORIGIN);
    assert.equal(tg.mode, "plain");
    assert.equal(max.mode, "plain");
    if (tg.mode === "plain") {
      assert.equal(tg.disableWebPagePreview, true);
    }
  });

  it("plain mode when multiple Открыть lines", () => {
    const stored = `Открыть: ${HOLDER}\nОткрыть: ${HOLDER}`;
    const pres = buildTelegramExternalPersonOutboxPresentation(stored, ORIGIN);
    assert.equal(pres.mode, "plain");
  });
});
