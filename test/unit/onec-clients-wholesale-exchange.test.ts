import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWholesaleEmployeeRosterBytes, WHOLESALE_DEPARTMENT_NAME } from "../../src/onec-clients/employee-roster";
import { validateExtendedClientsFileBytes } from "../../src/onec-clients/extended-validate";
import { mergeRetailOutletsWithIdentity } from "../../src/onec-clients/outlet-identity";
import { buildWholesaleCompositionPrepReport } from "../../src/onec-clients/wholesale-composition";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
  sampleIdentifiedOutlet,
} from "../helpers/onec-clients-extended-fixtures";
import {
  buildEmployeeRosterBytes,
  wholesaleRosterWithManagers,
  wholesaleRosterWithoutUnknown,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";

describe("wholesale 1C exchange rules", () => {
  it("does not mask rejected parent cards as tolerant unknown holdings", () => {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid, holding: true, name_client: "" }),
      sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes, { holdingLinkValidationPolicy: "tolerant" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "HOLDING_GUID_REJECTED"));
      assert.equal(result.diagnostics?.holdingGuidRejectedCount, 1);
    }
  });

  it("keeps non-holding target, cycles and self references as blocking errors", () => {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const nonHoldingTarget = validateExtendedClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({ guid_client: holdingGuid, holding: false }),
        sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
      ]),
      { holdingLinkValidationPolicy: "tolerant" },
    );
    assert.equal(nonHoldingTarget.ok, false);
    if (!nonHoldingTarget.ok) {
      assert.ok(nonHoldingTarget.issues.some((issue) => issue.code === "HOLDING_TARGET_NOT_HOLDING_CARD"));
    }

    const selfRef = validateExtendedClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedChild({ guid_client: childGuid, guid_holding: childGuid }),
      ]),
      { holdingLinkValidationPolicy: "tolerant" },
    );
    assert.equal(selfRef.ok, false);
    if (!selfRef.ok) {
      assert.ok(selfRef.issues.some((issue) => issue.code === "HOLDING_SELF_REFERENCE"));
    }
  });

  it("resolves holding link when parent card appears without expanding rights", () => {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const unknownParent = validateExtendedClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedChild({
          guid_client: childGuid,
          guid_holding: holdingGuid,
        }),
      ]),
      { holdingLinkValidationPolicy: "tolerant" },
    );
    assert.equal(unknownParent.ok, true);
    if (unknownParent.ok) {
      assert.equal(unknownParent.payload.records[0]?.holdingLinkState, "unresolved");
    }

    const resolved = validateExtendedClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({ guid_client: holdingGuid, holding: true }),
        sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
      ]),
      { holdingLinkValidationPolicy: "tolerant" },
    );
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.payload.records[1]?.holdingLinkState, "resolved");
      assert.equal(resolved.payload.records[1]?.guid_holding, holdingGuid);
    }
  });

  it("marks manager GUID outside wholesale roster without creating account semantics", () => {
    const roster = parseWholesaleEmployeeRosterBytes(wholesaleRosterWithoutUnknown());
    assert.ok(roster);
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            managers: {
              guid_hardware_manager: EXTENDED_FIXTURE_GUIDS.UNKNOWN,
              name_hardware_manager: "Outside Roster",
            },
          }),
        ],
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes, { employeeRoster: roster });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const manager = result.payload.records[0]?.retailOutlets[0]?.managers.hardwareManager;
    assert.equal(manager?.state, "outside_wholesale_roster");
    assert.equal(result.payload.diagnostics.employeeDirectoryVerified, true);
    assert.ok(result.payload.diagnostics.managersOutsideWholesaleRosterCount >= 1);
  });

  it("clears confirmed date_of_birth on explicit empty sentinel", () => {
    const context = {
      sourceSha256: "sha-b",
      importedAt: "2026-10-03T12:00:00.000Z",
    };
    const previous = {
      name: "LPR",
      post: "",
      dateOfBirth: "1980-05-01",
      dateOfBirthSourceRaw: "1980-05-01",
      dateOfBirthConfirmedInCurrentExport: true,
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
    };
    const incoming = {
      ...previous,
      dateOfBirth: null,
      dateOfBirthSourceRaw: "0001-01-01T00:00:00",
      dateOfBirthExplicitEmpty: true,
      dateOfBirthAmbiguous: false,
      dateOfBirthConfirmedInCurrentExport: true,
    };
    const baseOutlet = {
      ordinal: 0,
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
      holdingName: "",
      warehouse: false,
      address: { storeAddress: "", deliveryAddress: "", routeDirection: "" },
      loading: {
        loadingOnMonday: null,
        loadingOnTuesday: null,
        loadingOnWednesday: null,
        loadingOnThursday: null,
        loadingOnFriday: null,
        loadingOnSaturday: null,
        loadingOnSunday: null,
        loadingTime: null,
      },
      managers: {
        manager: { guid: null, name: "", state: "not_provided" as const },
        regionalManager: { guid: null, name: "", state: "not_provided" as const },
        hardwareManager: { guid: null, name: "", state: "not_provided" as const },
        headOfSales: { guid: null, name: "", state: "not_provided" as const },
      },
      contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
      additional: { statusTandoorClub: "", bonusTandoorClub: "" },
      outletGuidStatus: "confirmed" as const,
      closed: false,
      closureStatus: "open" as const,
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      distributionAllowed: false as const,
    };
    const merged = mergeRetailOutletsWithIdentity(
      [{ ...baseOutlet, lpr: incoming, provenance: { freshness: "current", sourceSha256: context.sourceSha256, importedAt: context.importedAt } }],
      "present",
      [{ ...baseOutlet, lpr: previous, provenance: { freshness: "current", sourceSha256: "sha-a", importedAt: context.importedAt } }],
      context,
    );
    assert.equal(merged.outlets[0]?.lpr.dateOfBirth, null);
    assert.equal(merged.outlets[0]?.lpr.dateOfBirthExplicitEmpty, true);
  });

  it("builds replacement prep report without deletion flags", () => {
    const roster = parseWholesaleEmployeeRosterBytes(wholesaleRosterWithManagers());
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding(),
      sampleExtendedChild({
        guid_holding: "99999999-9999-4999-8999-999999999999",
      }),
    ]);
    const validated = validateClientsFileBytes(bytes, {
      employeeRoster: roster,
      wholesaleCompositionMode: "replacement_prep",
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const report = buildWholesaleCompositionPrepReport({
      payload: validated.payload,
      holdingLinkPolicy: "tolerant",
      employeeRosterLoaded: true,
      employeeRosterSourceSha256: roster?.sourceSha256 ?? null,
      wholesaleEmployeeCount: roster?.wholesaleCount ?? null,
      existing: {
        clientGuids: new Set([EXTENDED_FIXTURE_GUIDS.HOLDING_GUID, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]),
        linkedAccountsByClient: new Map([[EXTENDED_FIXTURE_GUIDS.HOLDING_GUID, 2]]),
        confirmedOutletsByClient: new Map([[EXTENDED_FIXTURE_GUIDS.HOLDING_GUID, 1]]),
        bitrixTaskLinksByClient: new Map(),
      },
    });
    assert.equal(report.performsDeletion, false);
    assert.equal(report.writesBusinessData, false);
    assert.equal(report.applyAllowed, false);
    assert.equal(report.clientsToExclude.count, 1);
    assert.equal(report.unresolvedHoldingLinks.count, 1);
    assert.equal(
      report.baselineTransition.interpretation,
      "agreed_baseline_change_not_restore_requirement",
    );
    assert.ok(report.operationBlockers.includes("wholesale_composition_prep_is_dry_run_only"));
  });

  it("parses wholesale department roster from all_employees.json shape", () => {
    const bytes = buildEmployeeRosterBytes([
      { guid: EXTENDED_FIXTURE_GUIDS.MANAGER_A, department: WHOLESALE_DEPARTMENT_NAME },
      { guid: EXTENDED_FIXTURE_GUIDS.UNKNOWN, department: "Other Dept" },
    ]);
    const roster = parseWholesaleEmployeeRosterBytes(bytes);
    assert.ok(roster);
    assert.equal(roster.wholesaleCount, 1);
    assert.ok(roster.wholesaleGuids.has(EXTENDED_FIXTURE_GUIDS.MANAGER_A));
  });
});
