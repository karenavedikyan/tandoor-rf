import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { it } from "node:test";

const logic = createRequire(import.meta.url)("../../public/clients-logic.js") as {
  shouldPollOnecUpdateStatus(data: unknown): boolean;
  formatOnecUpdateStatusText(data: unknown): { disableButton: boolean };
};

it("keeps polling a committed result while the worker lease still blocks reconciliation", () => {
  for (const phase of ["pending", "running", "uncertain"]) {
    assert.equal(logic.shouldPollOnecUpdateStatus({ job: { phase }, canStart: false }), true);
  }
  const data = { job: { phase: "completed" }, canStart: false, blockedReason: "Сверка сохранения" };
  assert.equal(logic.shouldPollOnecUpdateStatus(data), true);
  assert.equal(logic.formatOnecUpdateStatusText(data).disableButton, true);
  assert.equal(logic.shouldPollOnecUpdateStatus({ ...data, canStart: true, blockedReason: null }), false);
  assert.equal(logic.formatOnecUpdateStatusText(null).disableButton, true);
});
