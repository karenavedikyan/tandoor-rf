import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("invitation person bridge wiring", () => {
  it("notify path resolves invitation channel before enqueue", () => {
    const notify = readFileSync(join(root, "src/tan-tracker/transfer-external-messenger-notify.ts"), "utf8");
    assert.match(notify, /resolveInvitationHandoffMessengerChannel/);
    assert.match(notify, /preHandoffVersion: Math\.max\(1, input\.handoffVersion - 1\)/);
  });
});
