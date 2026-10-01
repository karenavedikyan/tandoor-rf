import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOrkSyncResultMetrics,
  classifyOrkSyncResult,
} from "../../src/bitrix24/claims/ork-sync-outcome";

describe("ork sync outcome", () => {
  it("treats benign tag removal as non-issue", () => {
    const classified = classifyOrkSyncResult({
      action: "revoked",
      parseReason: "missing_tag",
    });
    assert.equal(classified.isIssue, false);
    assert.equal(classified.isBenignRevoke, true);
  });

  it("treats too_long and unauthorized revoke as issues", () => {
    assert.equal(
      classifyOrkSyncResult({ action: "none", parseReason: "too_long" }).isIssue,
      true,
    );
    const revoked = classifyOrkSyncResult({
      action: "revoked",
      denyCode: "NO_EXECUTOR",
      denyMessage: "need executor",
    });
    assert.equal(revoked.isIssue, true);
    const metrics = {
      orkPublicationsRevoked: 0,
      orkPublishIssues: 0,
      orkPublishDenied: [] as Array<{ taskId: string; code: string; message: string }>,
    };
    applyOrkSyncResultMetrics(metrics, "9001", {
      action: "revoked",
      denyCode: "NO_EXECUTOR",
      denyMessage: "need executor",
    });
    assert.equal(metrics.orkPublishIssues, 1);
    assert.equal(metrics.orkPublicationsRevoked, 1);
    assert.equal(metrics.orkPublishDenied[0]?.code, "NO_EXECUTOR");
  });
});
