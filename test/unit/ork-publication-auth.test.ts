import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateOrkPublishAuthority } from "../../src/bitrix24/claims/ork-publication-auth";

describe("ork publication authority", () => {
  it("requires sync executor and responsible match", async () => {
    const denied = await evaluateOrkPublishAuthority({
      portalId: "portal",
      responsibleBitrixUserId: "42",
      syncExecutorUserId: null,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.code, "NO_EXECUTOR");
    }
  });
});
