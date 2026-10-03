import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateExtendedClientsFileBytes } from "../../src/onec-clients/extended-validate";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
  sampleIdentifiedOutlet,
} from "../helpers/onec-clients-extended-fixtures";

describe("outlet guid_store and closed validation", () => {
  it("accepts confirmed guid_store with closed=false and closed=true", () => {
    const openBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [sampleIdentifiedOutlet({ closed: false })],
      }),
    ]);
    const closedBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [sampleIdentifiedOutlet({ closed: true })],
      }),
    ]);
    assert.equal(validateExtendedClientsFileBytes(openBytes).ok, true);
    assert.equal(validateExtendedClientsFileBytes(closedBytes).ok, true);
  });

  it("rejects null, string and missing boolean closed values", () => {
    for (const closed of [null, "true", 1]) {
      const bytes = buildExtendedClientsFileBytes([
        sampleExtendedHolding({
          retail_outlets: [sampleIdentifiedOutlet({ closed })],
        }),
      ]);
      const result = validateExtendedClientsFileBytes(bytes);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.issues.some((issue) => issue.code === "INVALID_OUTLET_CLOSED"));
      }
    }
  });

  it("rejects duplicate guid_store across clients", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE })],
      }),
      sampleExtendedChild({
        retail_outlets: [sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE })],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "OUTLET_GUID_CONFLICT"));
    }
  });

  it("keeps legacy outlets unconfirmed without guid_store", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          {
            holding: "Holding Alpha",
            warehouse: true,
            address: { store_address: "Legacy", delivery_address: "", direction_of_the_route: "" },
            information_loading: {},
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
            LPR_information: {},
            additional_information: {},
          },
        ],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      const outlet = result.payload.records[0]?.retailOutlets[0];
      assert.equal(outlet?.outletGuidStatus, "not_provided");
      assert.equal(outlet?.closureStatus, "not_provided");
      assert.equal(result.payload.diagnostics.outletsWithoutGuid, 1);
    }
  });

  it("rejects duplicate guid rows when ambiguous sentinel conflicts with explicit null", () => {
    const buildBytes = (sentinelFirst: boolean) =>
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({
          retail_outlets: sentinelFirst
            ? [
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: "0001-01-01T00:00:00" },
                  LPR_information: { date_of_birth: "0001-01-01T00:00:00", bonus: 1 },
                }),
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: null },
                  LPR_information: { date_of_birth: null, bonus: 1 },
                }),
              ]
            : [
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: null },
                  LPR_information: { date_of_birth: null, bonus: 1 },
                }),
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: "0001-01-01T00:00:00" },
                  LPR_information: { date_of_birth: "0001-01-01T00:00:00", bonus: 1 },
                }),
              ],
        }),
      ]);

    for (const bytes of [buildBytes(true), buildBytes(false)]) {
      const result = validateExtendedClientsFileBytes(bytes);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_OUTLET_GUID"));
      }
    }
  });

  it("dedupes equivalent duplicate guid rows regardless of row order", () => {
    const buildBytes = (isoFirst: boolean) =>
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({
          retail_outlets: isoFirst
            ? [
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: "0001-01-01T09:00:00" },
                  LPR_information: { date_of_birth: "1980-05-01T00:00:00", bonus: 1 },
                }),
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: "09:00" },
                  LPR_information: { date_of_birth: "1980-05-01", bonus: 1 },
                }),
              ]
            : [
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: "09:00" },
                  LPR_information: { date_of_birth: "1980-05-01", bonus: 1 },
                }),
                sampleIdentifiedOutlet({
                  information_loading: { loading_time: "0001-01-01T09:00:00" },
                  LPR_information: { date_of_birth: "1980-05-01T00:00:00", bonus: 1 },
                }),
              ],
        }),
      ]);

    for (const bytes of [buildBytes(true), buildBytes(false)]) {
      const result = validateExtendedClientsFileBytes(bytes);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.ok(result.payload.warnings.some((warning) => warning.code === "DUPLICATE_OUTLET_GUID_ROW"));
      }
    }
  });

  it("dedupes duplicate guid rows with equivalent loading time formats", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            information_loading: { loading_time: "09:00" },
          }),
          sampleIdentifiedOutlet({
            information_loading: { loading_time: "0001-01-01T09:00:00" },
          }),
        ],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.payload.warnings.some((warning) => warning.code === "DUPLICATE_OUTLET_GUID_ROW"));
      assert.equal(result.payload.diagnostics.duplicateOutletGuidCount, 1);
    }
  });

  it("treats duplicate guid rows with different managers as conflict", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet(),
          sampleIdentifiedOutlet({
            managers: {
              guid_manager: "",
              name_manager: "",
              guid_regional_manager: EXTENDED_FIXTURE_GUIDS.REGIONAL,
              name_regional_manager: "Different Regional",
              guid_hardware_manager: "",
              name_hardware_manager: "",
              guid_head_of_the_sales_department: "",
              name_head_of_the_sales_department: "",
            },
          }),
        ],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_OUTLET_GUID"));
    }
  });

  it("reports outlet diagnostics aggregates", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({ closed: false }),
          sampleIdentifiedOutlet({ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO, closed: true }),
        ],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.diagnostics.outletsWithGuid, 2);
      assert.equal(result.payload.diagnostics.outletsOpen, 1);
      assert.equal(result.payload.diagnostics.outletsClosed, 1);
      assert.equal(result.payload.diagnostics.blocks.outletFieldsComplete, true);
      assert.equal(result.payload.diagnostics.blocks.outletNormalizedReady, false);
      assert.equal(result.payload.diagnostics.outletSourceRowCount, 2);
      assert.equal(result.payload.diagnostics.outletUniqueGuidCount, 2);
      assert.equal(result.payload.diagnostics.knownOutletsMissingFromSnapshot, null);
    }
  });
});
