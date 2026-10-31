import test from "node:test";
import assert from "node:assert/strict";
import { parseHandoffGenCallbackDetail } from "../../src/tanbot/handoff-code-bot-service";

test("versioned staff receipt callbacks reject malformed versions instead of downgrading to legacy", () => {
  assert.deepEqual(parseHandoffGenCallbackDetail("hc:gen:TT-2026-006:2"),
    { publicCode: "TT-2026-006", handoffVersion: 2 });
  assert.deepEqual(parseHandoffGenCallbackDetail("hc:gen:TT-2026-006"),
    { publicCode: "TT-2026-006", handoffVersion: null });
  for (const suffix of ["0", "-1", "01", "2.5", "2e2", "", "NaN", "9007199254740992", "2:3"]) {
    assert.equal(parseHandoffGenCallbackDetail(`hc:gen:${"A".repeat(32)}:${suffix}`), null);
  }
});
