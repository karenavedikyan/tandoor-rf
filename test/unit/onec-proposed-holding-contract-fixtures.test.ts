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

/** Draft rules from docs/delivery/holding-business-model-and-1c-mapping.md §3 — not production code. */
function classifyHoldingComposition(
  legalEntityCount: number,
  outletCount: number,
  membershipComplete: boolean,
): HoldingCompositionType {
  if (!membershipComplete || legalEntityCount <= 0 || outletCount <= 0) {
    return "unknown";
  }
  if (legalEntityCount === 1 && outletCount === 1) return "mono";
  if (legalEntityCount === 1 && outletCount > 1) return "mono_network";
  if (legalEntityCount > 1 && outletCount === 1) return "group";
  if (legalEntityCount > 1 && outletCount > 1) return "group_network";
  return "unknown";
}

function countCompositionFromFile(relativeName: string): {
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

    it(`${file} matches draft composition type ${expected}`, () => {
      const { legalEntityCount, outletCount } = countCompositionFromFile(file);
      assert.equal(
        classifyHoldingComposition(legalEntityCount, outletCount, true),
        expected,
      );
    });
  }
});
