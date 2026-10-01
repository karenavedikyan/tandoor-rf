import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORK_SUMMARY_MAX_LENGTH,
  parseOrkSummaryFromDescription,
} from "../../src/bitrix24/claims/ork-parser";

describe("ork summary parser", () => {
  it("extracts summary on same and following lines", () => {
    const description =
      "#LK_H_000123\nСекретное описание.\n#орк Рекламация принята.\nОжидаем поставку.";
    const parsed = parseOrkSummaryFromDescription(description);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.briefText, "Рекламация принята.\nОжидаем поставку.");
    }
  });

  it("rejects missing, duplicate and prefix tags", () => {
    assert.equal(parseOrkSummaryFromDescription("Без метки").ok, false);
    assert.equal(
      parseOrkSummaryFromDescription("#орк один\n#орк два").ok,
      false,
    );
    assert.equal(parseOrkSummaryFromDescription("#оркестр текст").ok, false);
    assert.equal(parseOrkSummaryFromDescription("#ОРК текст").ok, true);
  });

  it("rejects empty summary and strips unsafe markup", () => {
    assert.equal(parseOrkSummaryFromDescription("#орк   ").ok, false);
    assert.equal(parseOrkSummaryFromDescription("#орк\n\n").ok, false);
    assert.equal(
      parseOrkSummaryFromDescription("#орк Public\n[b]#орк[/b] second").ok,
      false,
    );
    const parsed = parseOrkSummaryFromDescription(
      "#орк <b>Безопасно</b> <script>x</script>",
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.briefText, "Безопасно");
      assert.doesNotMatch(parsed.briefText, /script/i);
    }
  });

  it("returns too_long instead of silent truncation", () => {
    const longText = "x".repeat(ORK_SUMMARY_MAX_LENGTH + 1);
    const parsed = parseOrkSummaryFromDescription("#орк " + longText);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.reason, "too_long");
    }
  });
});
