import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExcludedArchiveDependencyReport,
  type ArchiveDependencyContext,
} from "../../src/onec-clients/baseline-replacement-preflight";

describe("baseline replacement preflight", () => {
  it("does not treat unavailable dependency dimensions as zero counts", () => {
    const context: ArchiveDependencyContext = {
      availability: "partial",
      unavailableDimensions: ["confirmed_outlets", "confirmed_bitrix_tasks"],
      activeAccessGrantCountByClient: new Map([["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 2]]),
      linkedEmployeeAccountCountByClient: new Map(),
      confirmedOutletsByClient: new Map(),
      bitrixTaskCountByClient: new Map(),
      childHoldingLinkCountByClient: new Map(),
    };
    const report = buildExcludedArchiveDependencyReport({
      guidsToArchive: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      dependencyContext: context,
    });
    assert.equal(report.anyUnknownDependency, true);
    assert.equal(report.samples[0]?.activeAccessGrantCount, 2);
    assert.equal(report.samples[0]?.confirmedOutletCount, null);
    assert.equal(report.samples[0]?.bitrixTaskCount, null);
    assert.equal(report.samples[0]?.childHoldingLinkCount, 0);
  });
});
