import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";

const PROPOSED_DIR = path.join(
  process.cwd(),
  "test/fixtures/onec-clients/proposed-contract",
);

type HoldingCompositionType =
  | "mono"
  | "mono_network"
  | "group"
  | "group_network"
  | "unknown";

/**
 * Illustrates target composition **only if** 1C confirms one member row = one legal entity
 * (docs/delivery/holding-business-model-and-1c-mapping.md §3.1). Not production logic.
 */
function classifyHoldingCompositionIfLegalEntityKeyConfirmed(
  legalEntityCount: number,
  outletCount: number,
  membershipComplete: boolean,
  legalEntityKeyConfirmed: boolean,
): HoldingCompositionType {
  if (!legalEntityKeyConfirmed) return "unknown";
  if (!membershipComplete || legalEntityCount <= 0 || outletCount <= 0) {
    return "unknown";
  }
  if (legalEntityCount === 1 && outletCount === 1) return "mono";
  if (legalEntityCount === 1 && outletCount > 1) return "mono_network";
  if (legalEntityCount > 1 && outletCount === 1) return "group";
  if (legalEntityCount > 1 && outletCount > 1) return "group_network";
  return "unknown";
}

/** Proposal assumption for fixtures: one non-holding row = one legal entity (demo only). */
function countCompositionUnderProposalAssumption(relativeName: string): {
  legalEntityCount: number;
  outletCount: number;
} {
  const bytes = fs.readFileSync(path.join(PROPOSED_DIR, relativeName));
  const records = JSON.parse(bytes.toString("utf8")) as Array<{
    guid_client: string;
    holding?: boolean;
    retail_outlets?: Array<{ guid_store?: string }>;
  }>;
  const legalRows = records.filter((r) => r.holding !== true);
  const legalEntityCount = new Set(legalRows.map((r) => r.guid_client.toLowerCase())).size;
  const outletGuids = new Set<string>();
  for (const row of records) {
    for (const outlet of row.retail_outlets ?? []) {
      const g = (outlet.guid_store ?? "").trim().toLowerCase();
      if (g) outletGuids.add(g);
    }
  }
  return { legalEntityCount, outletCount: outletGuids.size };
}

const FIXTURES: Array<{ file: string; expected: HoldingCompositionType }> = [
  { file: "holding-mono.json", expected: "mono" },
  { file: "holding-mono-network.json", expected: "mono_network" },
  { file: "holding-group.json", expected: "group" },
  { file: "holding-group-network.json", expected: "group_network" },
];

describe("proposed holding contract fixtures (variant A, synthetic)", () => {
  for (const { file, expected } of FIXTURES) {
    it(`${file} passes first-read validation`, () => {
      const bytes = fs.readFileSync(path.join(PROPOSED_DIR, file));
      const result = validateClientsFileBytes(bytes, {
        holdingLinkValidationPolicy: "tolerant",
      });
      assert.equal(result.ok, true, file);
    });

    it(`${file} illustrates composition type ${expected} under proposal legal-entity assumption`, () => {
      const { legalEntityCount, outletCount } =
        countCompositionUnderProposalAssumption(file);
      assert.equal(
        classifyHoldingCompositionIfLegalEntityKeyConfirmed(
          legalEntityCount,
          outletCount,
          true,
          true,
        ),
        expected,
      );
    });
  }

  it("without confirmed legal-entity key, composition type stays unknown even for fixture counts", () => {
    const { legalEntityCount, outletCount } =
      countCompositionUnderProposalAssumption("holding-mono.json");
    assert.equal(
      classifyHoldingCompositionIfLegalEntityKeyConfirmed(
        legalEntityCount,
        outletCount,
        true,
        false,
      ),
      "unknown",
    );
  });
});
