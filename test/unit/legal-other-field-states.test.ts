import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessContext } from "../../src/access/types";
import { V3_EXCHANGE_OTHER_COMPLETE_MARKER } from "../../src/onec-exchange-v3/other-fields-presence";
import { computeLegalOtherFieldStates } from "../../src/onec-exchange-v3/legal-other-field-states";

function manager(): AccessContext {
  return {
    role: "manager",
    userId: "1",
    fullClientBase: false,
    employeeId: null,
    employeeLinkConflict: false,
    deniedClientGuids: new Set(),
    deniedEmployeeGuids: new Set(),
  } as AccessContext;
}

describe("legal-other-field-states", () => {
  it("marks restricted fields separately from empty-1c when exchange is complete", () => {
    const sha = "a".repeat(64);
    const raw = {
      Код: "001",
      Пол: "SYNTH",
      [V3_EXCHANGE_OTHER_COMPLETE_MARKER]: sha,
    };
    const states = computeLegalOtherFieldStates(raw, manager(), sha);
    assert.equal(states.Пол, "restricted");
    assert.equal(states.Код, "shown");
  });

  it("marks missing inventory keys as not_ingested when marker absent", () => {
    const raw = { Код: "001" };
    const states = computeLegalOtherFieldStates(raw, manager(), "b".repeat(64));
    assert.equal(states.Оптовик_КонтактноеЛицо, "not_ingested");
  });

  it("marks missing keys as empty_1c when bag complete for source", () => {
    const sha = "c".repeat(64);
    const raw = { Код: "001", [V3_EXCHANGE_OTHER_COMPLETE_MARKER]: sha };
    const states = computeLegalOtherFieldStates(raw, manager(), sha);
    assert.equal(states.Оптовик_КонтактноеЛицо, "empty_1c");
  });
});
