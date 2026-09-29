import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMskDisplay, isoToMskLocalInput, parseMskLocalInput } from "../../src/shared/datetime-msk";

describe("datetime MSK", () => {
  it("parses datetime-local as Moscow wall time regardless of process TZ", () => {
    const iso = parseMskLocalInput("2026-09-28T15:00");
    assert.equal(iso, "2026-09-28T12:00:00.000Z");
  });

  it("round-trips through isoToMskLocalInput", () => {
    const iso = "2026-09-28T12:00:00.000Z";
    assert.equal(isoToMskLocalInput(iso), "2026-09-28T15:00");
  });

  it("formats display in Europe/Moscow", () => {
    const formatted = formatMskDisplay("2026-09-28T12:00:00.000Z");
    assert.match(formatted, /28/);
    assert.match(formatted, /15/);
  });

  it("rejects invalid local input", () => {
    assert.equal(parseMskLocalInput("invalid"), null);
    assert.equal(parseMskLocalInput("2026-09-28T25:00"), null);
  });
});
