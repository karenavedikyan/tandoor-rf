import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExtendedSnapshotJson } from "../../src/onec-clients/extended-apply";
import {
  dedupeIdenticalOutlets,
  mergeRetailOutletsWithIdentity,
  outletBusinessProjection,
  outletsAreIdentical,
} from "../../src/onec-clients/outlet-identity";
import type { ParsedRetailOutlet } from "../../src/onec-clients/extended-types";
import { EXTENDED_FIXTURE_GUIDS } from "../helpers/onec-clients-extended-fixtures";

function outlet(overrides: Partial<ParsedRetailOutlet> = {}): ParsedRetailOutlet {
  return {
    ordinal: 0,
    guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
    holdingName: "Holding Alpha",
    warehouse: null,
    address: { storeAddress: "Store A", deliveryAddress: "", routeDirection: "" },
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
      manager: { guid: null, name: "", state: "unassigned" },
      regionalManager: { guid: null, name: "", state: "unassigned" },
      hardwareManager: { guid: null, name: "", state: "unassigned" },
      headOfSales: { guid: null, name: "", state: "unassigned" },
    },
    contacts: { storePhone: "", accountantPhone: "", accountantEmail: "" },
    lpr: {
      name: "",
      post: "",
      dateOfBirth: null,
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
    },
    additional: { statusTandoorClub: "", bonusTandoorClub: "" },
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    closureConfirmedInCurrentExport: true,
    closureHistory: [],
    provenance: {
      freshness: "current",
      sourceSha256: "sha-a",
      importedAt: "2026-01-01T00:00:00.000Z",
    },
    distributionAllowed: false,
    ...overrides,
  };
}

describe("outlet identity merge", () => {
  it("preserves confirmed outlet missing from next snapshot with previous provenance", () => {
    const previous = [
      outlet({
        guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
        provenance: {
          freshness: "current",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      outlet({
        guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
        provenance: {
          freshness: "current",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ];
    const merged = mergeRetailOutletsWithIdentity(
      [outlet({ guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO })],
      "present",
      previous,
      { sourceSha256: "sha-b", importedAt: "2026-01-02T00:00:00.000Z" },
    );
    assert.equal(merged.outlets.length, 2);
    const missing = merged.outlets.find((item) => item.guidStore === EXTENDED_FIXTURE_GUIDS.STORE_ONE);
    assert.equal(missing?.provenance.freshness, "absent_from_current_export");
    assert.equal(missing?.provenance.sourceSha256, "sha-a");
    assert.equal(merged.outletsInCurrentExport.length, 1);
  });

  it("keeps identity when address changes and order shifts", () => {
    const previous = [outlet({ address: { storeAddress: "Old", deliveryAddress: "", routeDirection: "" } })];
    const incoming = [
      outlet({
        ordinal: 1,
        address: { storeAddress: "New", deliveryAddress: "Dock", routeDirection: "South" },
      }),
    ];
    const merged = mergeRetailOutletsWithIdentity(incoming, "present", previous, {
      sourceSha256: "sha-b",
      importedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(merged.outlets.length, 1);
    assert.equal(merged.outlets[0]?.guidStore, EXTENDED_FIXTURE_GUIDS.STORE_ONE);
    assert.equal(merged.outlets[0]?.address.storeAddress, "New");
    assert.equal(merged.outlets[0]?.provenance.sourceSha256, "sha-b");
  });

  it("records closure history on reopen and preserves closure when omitted", () => {
    const previous = [outlet({ closed: true, closureStatus: "closed", closureConfirmedInCurrentExport: true })];
    const incoming = [
      outlet({
        closed: false,
        closureStatus: "open",
        closureConfirmedInCurrentExport: true,
      }),
    ];
    const reopened = mergeRetailOutletsWithIdentity(incoming, "present", previous, {
      sourceSha256: "sha-b",
      importedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(reopened.outlets[0]?.closureStatus, "open");
    assert.equal(reopened.outlets[0]?.closureHistory.length, 1);

    const preservedClosure = mergeRetailOutletsWithIdentity(
      [outlet({ closureStatus: "not_provided", closed: null, closureConfirmedInCurrentExport: false })],
      "present",
      previous,
      { sourceSha256: "sha-c", importedAt: "2026-01-03T00:00:00.000Z" },
    );
    assert.equal(preservedClosure.outlets[0]?.closed, true);
    assert.equal(preservedClosure.outlets[0]?.closureConfirmedInCurrentExport, false);
  });

  it("dedupes identical confirmed rows only when full projection matches", () => {
    assert.equal(dedupeIdenticalOutlets([outlet(), outlet()]).length, 1);
    assert.equal(
      outletsAreIdentical(outlet(), outlet({ contacts: { storePhone: "1", accountantPhone: "", accountantEmail: "" } })),
      false,
    );
  });

  it("archives anonymous outlets to history when identified outlets arrive", () => {
    const anonymous = outlet({
      guidStore: null,
      outletGuidStatus: "not_provided",
      closureStatus: "not_provided",
      closed: null,
      closureConfirmedInCurrentExport: false,
      provenance: { freshness: "not_provided_in_snapshot", sourceSha256: "", importedAt: "" },
    });
    const first = buildExtendedSnapshotJson(
      {
        guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
        name_client: "Holding",
        guid_holding: null,
        name_holding: "",
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
        name_manager: "Manager",
        address: "Addr",
        telephone: [],
        isHolding: true,
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: { guid: null, name: "", state: "not_provided" },
        retailOutlets: [anonymous],
        recordFormat: "extended_v1",
        hasExtendedManagerFields: true,
        fieldPresence: {
          holding: "present",
          retailOutlets: "present",
          regionalManager: "missing",
          hardwareManager: "missing",
          headOfSales: "missing",
        },
      },
      null,
      "sha-a",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const second = buildExtendedSnapshotJson(
      {
        guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
        name_client: "Holding",
        guid_holding: null,
        name_holding: "",
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
        name_manager: "Manager",
        address: "Addr",
        telephone: [],
        isHolding: true,
        regionalManager: { guid: null, name: "", state: "not_provided" },
        hardwareManager: { guid: null, name: "", state: "not_provided" },
        headOfSales: { guid: null, name: "", state: "not_provided" },
        retailOutlets: [outlet()],
        recordFormat: "extended_v1",
        hasExtendedManagerFields: true,
        fieldPresence: {
          holding: "present",
          retailOutlets: "present",
          regionalManager: "missing",
          hardwareManager: "missing",
          headOfSales: "missing",
        },
      },
      first,
      "sha-b",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(second.currentRetailOutlets.length, 1);
    assert.equal(second.currentRetailOutlets[0]?.outletGuidStatus, "confirmed");
    assert.ok(second.retailOutletHistory.some((entry) => entry.retailOutlets[0]?.outletGuidStatus === "not_provided"));
  });

  it("compares full business projection including managers and contacts", () => {
    const left = outlet();
    const right = outlet({
      managers: {
        ...left.managers,
        regionalManager: { guid: EXTENDED_FIXTURE_GUIDS.REGIONAL, name: "Regional", state: "directory_unverified" },
      },
    });
    assert.notDeepEqual(outletBusinessProjection(left), outletBusinessProjection(right));
  });
});
