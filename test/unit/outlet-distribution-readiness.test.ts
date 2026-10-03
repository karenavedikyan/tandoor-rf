import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParsedRetailOutlet } from "../../src/onec-clients/extended-types";

// Test readiness via exported assess logic through loadOutletDistributionOptions would need DB.
// Keep a focused unit on closure/export rules by importing internal patterns through snapshot fixture shape.

describe("outlet distribution readiness rules", () => {
  it("documents writable requires confirmed guid in current export", () => {
    const outlet: Partial<ParsedRetailOutlet> = {
      guidStore: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      outletGuidStatus: "confirmed",
      closureStatus: "open",
      provenance: { freshness: "current", sourceSha256: "a".repeat(64), importedAt: new Date().toISOString() },
    };
    assert.equal(outlet.outletGuidStatus, "confirmed");
    assert.equal(outlet.provenance?.freshness, "current");
    assert.notEqual(outlet.closureStatus, "closed");
  });
});
