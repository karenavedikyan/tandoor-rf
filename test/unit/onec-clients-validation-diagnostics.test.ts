import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_DETAILED_ERRORS, MAX_DETAILED_WARNINGS } from "../../src/onec-clients/constants";
import { validateExtendedClientsFileBytes } from "../../src/onec-clients/extended-validate";
import { buildExtendedStructureReport } from "../../src/onec-diagnostics/extended-snapshot";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";

function buildManyUnknownHoldingLinks(count: number) {
  const holding = sampleExtendedHolding({ holding: true });
  const children = Array.from({ length: count }, (_, index) =>
    sampleExtendedChild({
      guid_client: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`,
      guid_holding: `dddddddd-dddd-4ddd-8bbb-${String(index).padStart(12, "0")}`,
    }),
  );
  return buildExtendedClientsFileBytes([holding, ...children]);
}

describe("extended validation diagnostics on failure", () => {
  it("returns full aggregates and codes when issue examples are truncated", () => {
    const result = validateExtendedClientsFileBytes(buildManyUnknownHoldingLinks(60));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issueCount, 60);
    assert.equal(result.issues.length, MAX_DETAILED_ERRORS);
    assert.equal(result.issuesTruncated, true);
    assert.equal(result.diagnostics?.holdingGuidUnknownCount, 60);
    assert.ok(result.issueCodes.includes("HOLDING_GUID_UNKNOWN"));
    assert.equal(result.issueCodes.length, 1);
  });

  it("includes warning codes beyond detailed warning sample limit", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: Array.from({ length: 25 }, () => ({
          holding: "Holding Alpha",
          warehouse: false,
          address: { store_address: "Store", delivery_address: "", direction_of_the_route: "" },
          information_loading: { loading_time: "0001-01-01T00:00:00" },
          managers: {
            guid_regional_manager: "00000000-0000-0000-0000-000000000000",
            name_regional_manager: "",
            guid_hardware_manager: "00000000-0000-0000-0000-000000000000",
            name_hardware_manager: "",
            guid_head_of_the_sales_department: "00000000-0000-0000-0000-000000000000",
            name_head_of_the_sales_department: "",
          },
          contact_information: { store_phone: "", accountant_phone: "", accountant_email: "" },
          LPR_information: { date_of_birth: "0001-01-01T00:00:00", bonus: 1 },
          additional_information: { status_tandoor_club: "", bonus_tandoor_club: 0 },
        })),
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.payload.warningCount > MAX_DETAILED_WARNINGS);
    assert.equal(result.payload.warnings.length, MAX_DETAILED_WARNINGS);
    assert.equal(result.payload.warningsTruncated, true);
    assert.ok(result.payload.warningCodes?.includes("AMBIGUOUS_LOADING_TIME"));
    assert.ok(result.payload.warningCodes?.includes("AMBIGUOUS_DATE_OF_BIRTH"));
    assert.ok(result.payload.warningCodes?.includes("OUTLETS_NOT_NORMALIZED"));
  });

  it("exposes diagnostics through readonly extended structure report on failed validation", () => {
    const bytes = buildManyUnknownHoldingLinks(55);
    const report = buildExtendedStructureReport(bytes);
    assert.equal(report.validation.ok, false);
    assert.equal(report.validation.issueCount, 55);
    assert.equal(report.validation.issuesTruncated, true);
    assert.equal(report.diagnostics?.holdingGuidUnknownCount, 55);
    assert.deepEqual(report.validation.issueCodes, ["HOLDING_GUID_UNKNOWN"]);
  });
});
