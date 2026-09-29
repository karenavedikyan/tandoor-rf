import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareJournalWarnings } from "../../src/onec-exchange/warnings-journal";

describe("prepareJournalWarnings", () => {
  it("stores full warningCount and marks truncation when list exceeds limit", () => {
    const warnings = Array.from({ length: 30 }, (_, index) => ({
      code: "WARN",
      message: `warning-${index}`,
      recordIndex: index,
    }));
    const prepared = prepareJournalWarnings(warnings);
    assert.equal(prepared.warningCount, 30);
    assert.equal(prepared.warningsTruncated, true);
    assert.equal(JSON.parse(prepared.warningsJson).length, 20);
  });

  it("truncates oversized warning payloads by bytes", () => {
    const warnings = Array.from({ length: 10 }, () => ({
      code: "WARN",
      message: "x".repeat(10_000),
      recordIndex: 0,
    }));
    const prepared = prepareJournalWarnings(warnings);
    assert.equal(prepared.warningCount, 10);
    assert.equal(prepared.warningsTruncated, true);
    assert.ok(Buffer.byteLength(prepared.warningsJson, "utf8") <= 65_536);
  });
});
