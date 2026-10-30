import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("invitation person bridge wiring", () => {
  it("notify path uses discriminated invitation bridge and rejects proof conflicts", () => {
    const notify = readFileSync(join(root, "src/tan-tracker/transfer-external-messenger-notify.ts"), "utf8");
    assert.match(notify, /resolveInvitationHandoffForNotify/);
    assert.match(notify, /invitation_proof_rejected/);
    assert.match(notify, /no_invitation_proof.*singleChannel/s);
  });

  it("bridge treats stale invitation artifact as rejected, not missing proof", () => {
    const bridge = readFileSync(join(root, "src/tan-tracker/external-person/invitation-person-bridge.ts"), "utf8");
    assert.match(bridge, /loadInvitationHandoffArtifact/);
    assert.match(bridge, /invitation_proof_rejected.*artifact/s);
  });

  it("proof loader requires non-expired session and consumed handoff code", () => {
    const bridge = readFileSync(join(root, "src/tan-tracker/external-person/invitation-person-bridge.ts"), "utf8");
    assert.match(bridge, /expires_at > NOW\(\)/);
    assert.match(bridge, /consumed_at IS NOT NULL/);
  });

  it("single-channel enqueue requires explicit preferred channel (no telegram default)", () => {
    const outbox = readFileSync(join(root, "src/tan-tracker/external-person/external-person-notify.ts"), "utf8");
    assert.match(outbox, /if \(!input\.preferredChannel\) return;/);
  });
});
