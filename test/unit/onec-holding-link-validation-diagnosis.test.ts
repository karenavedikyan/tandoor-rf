import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";

/** Synthetic GUIDs only — not production records. */
const ROOT_SELF = "11111111-1111-4111-8111-111111111111";
const CHILD_OF_ROOT = "22222222-2222-4222-8222-222222222222";
const CYCLE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CYCLE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CYCLE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOLDING_ROOT = "33333333-3333-4333-8333-333333333333";
const HOLDING_CHILD = "44444444-4444-4444-8444-444444444444";

function issueCodes(bytes: Buffer): string[] {
  const result = validateClientsFileBytes(bytes, { holdingLinkValidationPolicy: "tolerant" });
  if (result.ok) {
    return [];
  }
  return result.issueCodes ?? [...new Set(result.issues.map((i) => i.code))];
}

describe("holding link validation (synthetic diagnosis fixtures)", () => {
  it("self-referential root without holding=true → HOLDING_SELF_REFERENCE", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedChild({
        guid_client: ROOT_SELF,
        guid_holding: ROOT_SELF,
        name_holding: "",
        holding: false,
      }),
    ]);
    const result = validateClientsFileBytes(bytes, { holdingLinkValidationPolicy: "tolerant" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "HOLDING_SELF_REFERENCE" && i.index === 0));
  });

  it("child of self-referential root → HOLDING_CYCLE on child (not a separate multi-node ring)", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedChild({
        guid_client: ROOT_SELF,
        guid_holding: ROOT_SELF,
        name_holding: "",
        holding: false,
      }),
      sampleExtendedChild({
        guid_client: CHILD_OF_ROOT,
        guid_holding: ROOT_SELF,
        name_holding: "",
        holding: false,
      }),
    ]);
    const result = validateClientsFileBytes(bytes, { holdingLinkValidationPolicy: "tolerant" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "HOLDING_SELF_REFERENCE" && i.index === 0));
    assert.ok(result.issues.some((i) => i.code === "HOLDING_CYCLE" && i.index === 1));
    assert.ok(
      result.issues.some((i) => i.code === "HOLDING_TARGET_NOT_HOLDING_CARD" && i.index === 1),
      "child links to non-holding self-ref parent",
    );
  });

  it("three holding cards in a ring → HOLDING_CYCLE", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        guid_client: CYCLE_A,
        holding: true,
        guid_holding: CYCLE_C,
        name_holding: "Cycle C",
      }),
      sampleExtendedHolding({
        guid_client: CYCLE_B,
        holding: true,
        guid_holding: CYCLE_A,
        name_holding: "Cycle A",
      }),
      sampleExtendedHolding({
        guid_client: CYCLE_C,
        holding: true,
        guid_holding: CYCLE_B,
        name_holding: "Cycle B",
      }),
    ]);
    const result = validateClientsFileBytes(bytes, { holdingLinkValidationPolicy: "tolerant" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "HOLDING_CYCLE"));
  });

  it("explicit holding root + child link → first-read validation passes", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        guid_client: HOLDING_ROOT,
        holding: true,
        guid_holding: "",
        name_holding: "",
      }),
      sampleExtendedChild({
        guid_client: HOLDING_CHILD,
        guid_holding: HOLDING_ROOT,
        name_holding: "Holding root",
        holding: false,
      }),
    ]);
    const result = validateClientsFileBytes(bytes, { holdingLinkValidationPolicy: "tolerant" });
    assert.equal(result.ok, true);
  });
});
