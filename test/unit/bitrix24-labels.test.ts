import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLabelCode, formatLabelToken, parseLabelToken } from "../../src/bitrix24/labels/format";
import { extractLabelsFromDescription } from "../../src/bitrix24/labels/parser";

describe("bitrix24 labels", () => {
  it("formats and parses canonical label tokens", () => {
    const code = formatLabelCode("holding", 123);
    assert.equal(code, "LK_H_000123");
    assert.equal(formatLabelToken(code), "#LK_H_000123");
    const parsed = parseLabelToken("#LK_H_000123");
    assert.deepEqual(parsed, { objectType: "holding", labelCode: "LK_H_000123" });
    assert.equal(parseLabelToken("#LK_H_000000"), null);
  });

  it("extracts one label from multiline description and ignores markup", () => {
    const parsed = extractLabelsFromDescription(
      "<b>Описание</b>\n\n#LK_H_000123\nПоставка оборудования",
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.labels.length, 1);
      assert.equal(parsed.labels[0]?.labelCode, "LK_H_000123");
    }
  });

  it("detects conflict when different labels appear in one description", () => {
    const parsed = extractLabelsFromDescription("#LK_H_000123 и #LK_J_000456");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.reason, "conflict");
    }
  });

  it("deduplicates repeated identical label tokens", () => {
    const parsed = extractLabelsFromDescription("#LK_H_000123\n#LK_H_000123");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.labels.length, 1);
    }
  });

  it("ignores script tags and BBCode without executing markup", () => {
    const parsed = extractLabelsFromDescription(
      '<script>alert("x")</script>#LK_H_000123[b]bold[/b]',
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.labels[0]?.labelCode, "LK_H_000123");
    }
  });

  it("rejects invalid tokens embedded in description", () => {
    const parsed = extractLabelsFromDescription("#LK_H_000000");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.reason, "invalid_token");
    }
  });

  it("formats legal entity and outlet prefixes", () => {
    assert.equal(formatLabelCode("legal_entity", 456), "LK_J_000456");
    assert.equal(formatLabelCode("outlet", 789), "LK_T_000789");
  });
});
