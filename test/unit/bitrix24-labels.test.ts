import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLabelCode, formatLabelToken, parseLabelToken } from "../../src/bitrix24/labels/format";
import { extractLabelsFromDescription } from "../../src/bitrix24/labels/parser";
import { bitrixChangedAtToDate } from "../../src/bitrix24/parse-changed-at";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../../src/bitrix24/tasks/config";

describe("bitrix24 labels", () => {
  it("formats and parses canonical label tokens", () => {
    const code = formatLabelCode("holding", 123);
    assert.equal(code, "LK_H_000123");
    assert.equal(formatLabelToken(code), "#LK_H_000123");
    const parsed = parseLabelToken("#LK_H_000123");
    assert.deepEqual(parsed, { objectType: "holding", labelCode: "LK_H_000123" });
    assert.equal(parseLabelToken("#LK_H_000000"), null);
  });

  it("extracts label only from dedicated line", () => {
    const parsed = extractLabelsFromDescription("Описание\n#LK_H_000123\nПоставка");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.labels.length, 1);
      assert.equal(parsed.labels[0]?.labelCode, "LK_H_000123");
    }
  });

  it("rejects inline label inside text (strict parser)", () => {
    const parsed = extractLabelsFromDescription("Ссылка https://x/#LK_H_000123 и текст");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.labels.length, 0);
    }
    const invalidLine = extractLabelsFromDescription("prefix #LK_H_000123");
    assert.equal(invalidLine.ok, false);
  });

  it("rejects lowercase label lines", () => {
    const parsed = extractLabelsFromDescription("#lk_h_000123");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.reason, "invalid_token");
    }
  });

  it("detects conflict when different labels appear on separate lines", () => {
    const parsed = extractLabelsFromDescription("#LK_H_000123\n#LK_J_000456");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.reason, "conflict");
    }
  });

  it("compares changed_at instants across timezone formats", () => {
    const moscow = bitrixChangedAtToDate("2026-09-30T12:00:00+03:00");
    const utc = bitrixChangedAtToDate("2026-09-30T09:00:00Z");
    assert.ok(moscow && utc);
    assert.equal(moscow!.getTime(), utc!.getTime());
  });

  it("requires TTL for cache publish", () => {
    const blocked = loadBitrix24TasksRuntimeConfig({
      BITRIX24_CACHE_PUBLISH_ENABLED: "true",
      BITRIX24_CACHE_ACCESS_TTL_MS: "0",
    });
    assert.equal(isCachePublishAllowed(blocked), false);
  });

  it("rejects sequence above 999999 at format layer", () => {
    assert.throws(() => formatLabelCode("holding", 1_000_000), /INVALID_LABEL_SEQUENCE/);
    assert.equal(formatLabelCode("holding", 999999), "LK_H_999999");
  });
});
