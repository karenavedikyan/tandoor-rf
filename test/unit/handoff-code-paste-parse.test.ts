import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHandoffCodePaste } from "../../src/tan-tracker/handoff-code-paste-parse";

describe("handoff code paste parse", () => {
  it("accepts exact six digits and spaced variants", () => {
    assert.deepEqual(parseHandoffCodePaste("012345"), { ok: true, code: "012345" });
    assert.deepEqual(parseHandoffCodePaste("01 23 45"), { ok: true, code: "012345" });
    assert.deepEqual(parseHandoffCodePaste("01-23-45"), { ok: true, code: "012345" });
  });

  it("extracts labeled messenger text without track number digits", () => {
    const sample =
      "Код для передачи TT-2026-001: 012345\nСообщите его держателю лично. Код одноразовый и действует 10 минут.";
    assert.deepEqual(parseHandoffCodePaste(sample), { ok: true, code: "012345" });
  });

  it("rejects ambiguous multiple codes", () => {
    const r = parseHandoffCodePaste("Код: 012345 и другой код: 987654");
    assert.equal(r.ok, false);
    assert.equal(r.ambiguous, true);
  });

  it("allows same code twice in one message", () => {
    const r = parseHandoffCodePaste("Код: 012345\nПовтор кода: 012345");
    assert.deepEqual(r, { ok: true, code: "012345" });
  });

  it("rejects track suffix even when the word код appears elsewhere", () => {
    assert.equal(parseHandoffCodePaste("Передача TT-2026-123456. Код пока не получен.").ok, false);
  });

  it("empty paste is non-destructive signal", () => {
    assert.deepEqual(parseHandoffCodePaste("   "), { ok: false, reason: "" });
  });
});
