import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diagnoseClientsFileBytes,
  safeValidationIssueForReport,
} from "../../scripts/diagnose-clients-file-validation";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";

const LEAK_MARKER = "PII_LEAK_MARKER_XYZ_98765";

describe("diagnose-clients-file-validation script helpers", () => {
  it("includes outletIndex in sampleIssues when present on validation issue", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        name_client: LEAK_MARKER,
        retail_outlets: [
          {
            guid_store: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
            holding: "Holding Alpha",
            warehouse: false,
            address: {
              store_address: "Store",
              delivery_address: "",
              direction_of_the_route: "",
            },
            managers: {
              guid_manager: "",
              name_manager: "",
              guid_regional_manager: "",
              name_regional_manager: "",
              guid_hardware_manager: "",
              name_hardware_manager: "",
              guid_head_of_the_sales_department: "",
              name_head_of_the_sales_department: "",
            },
            contact_information: { store_phone: "", accountant_phone: "", accountant_email: "" },
            closed: "not-bool",
            LPR_information: {
              name: "Should Not Appear",
              post: "",
              date_of_birth: "",
              phone: "",
              email: "",
              bonus: "0",
              conditions_bonus: "",
            },
            additional_information: { status_tandoor_club: "", bonus_tandoor_club: "" },
          },
        ],
      }),
    ]);

    const { body, exitCode } = diagnoseClientsFileBytes(bytes, "/test/path.json");
    assert.equal(exitCode, 2);
    assert.equal(body.ok, false);
    if (body.ok) return;

    const sample = body.sampleIssues;
    assert.ok(sample.length > 0);
    const withOutlet = sample.find((row) => row.outletIndex !== undefined);
    assert.ok(withOutlet, "expected at least one issue with outletIndex");
    assert.equal(typeof withOutlet!.outletIndex, "number");

    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(LEAK_MARKER));
    assert.ok(!serialized.includes("Should Not Appear"));
    assert.ok(!serialized.includes("Secret LPR"));
  });

  it("safeValidationIssueForReport never copies unknown issue properties", () => {
    const safe = safeValidationIssueForReport({
      code: "INVALID_OUTLET_FIELD",
      field: "bonus",
      index: 0,
      outletIndex: 2,
    });
    assert.deepEqual(safe, {
      code: "INVALID_OUTLET_FIELD",
      field: "bonus",
      index: 0,
      outletIndex: 2,
    });
    assert.equal(Object.keys(safe).length, 4);
  });
});
