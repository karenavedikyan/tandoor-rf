import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateExtendedClientsFileBytes } from "../../src/onec-clients/extended-validate";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";

describe("extended strict validation regressions", () => {
  it("rejects non-string address in outlet block", () => {
    const holding = sampleExtendedHolding();
    const outlet = { ...(holding.retail_outlets as object[])[0], address: 123 };
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ retail_outlets: [outlet] }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "INVALID_OUTLET_FIELD"));
    }
  });

  it("rejects object in accountant_email", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          {
            contact_information: { accountant_email: { bad: true } },
          },
        ],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
  });

  it("rejects impossible calendar date", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          {
            LPR_information: { date_of_birth: "2026-02-31" },
          },
        ],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
  });

  it("preserves bonus_tandoor_club zero", () => {
    const holding = sampleExtendedHolding();
    const outlet = {
      ...(holding.retail_outlets as object[])[0],
      additional_information: { bonus_tandoor_club: 0 },
    };
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ retail_outlets: [outlet] }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(
        result.payload.records[0]?.retailOutlets[0]?.additional.bonusTandoorClub,
        "0",
      );
    }
  });

  it("rejects broken manager guid", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        guid_regional_manager: "broken",
        name_regional_manager: "Bad",
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "INVALID_MANAGER_GUID"));
    }
  });

  it("detects extended format by manager fields without holding key", () => {
    const bytes = buildExtendedClientsFileBytes([
      {
        ...sampleExtendedChild(),
        guid_holding: "",
        name_holding: "",
        holding: undefined,
        retail_outlets: undefined,
        guid_regional_manager: "66666666-6666-4666-8666-666666666666",
        name_regional_manager: "Regional",
      },
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.sourceFormat, "extended_v1");
      assert.equal(result.payload.records[0]?.hasExtendedManagerFields, true);
      assert.equal(result.payload.diagnostics.blocks.clientExtendedReady, false);
    }
  });

  it("rejects guid_holding target that is not a holding card", () => {
    const childA = sampleExtendedChild({ holding: false });
    const bytes = buildExtendedClientsFileBytes([
      childA,
      sampleExtendedChild({
        guid_client: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        guid_holding: childA.guid_client,
        name_client: "Another child",
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "HOLDING_TARGET_NOT_HOLDING_CARD"));
    }
  });

  it("allows guid_holding without name_holding key", () => {
    const holding = sampleExtendedHolding();
    const child = sampleExtendedChild();
    delete (child as Record<string, unknown>).name_holding;
    const bytes = buildExtendedClientsFileBytes([holding, child]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
  });
});
