import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExtendedSnapshotJson } from "../../src/onec-clients/extended-apply";
import {
  dedupeIdenticalOutlets,
  mergeRetailOutletsWithIdentity,
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
    closureHistory: [],
    distributionAllowed: false,
    ...overrides,
  };
}

describe("outlet identity merge", () => {
  it("preserves confirmed outlet missing from next snapshot", () => {
    const previous = [outlet({ guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE, closed: true, closureStatus: "closed" })];
    const merged = mergeRetailOutletsWithIdentity([], "present", previous, {
      sourceSha256: "sha-b",
      importedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.closureStatus, "closed");
  });

  it("keeps identity when address changes and order shifts", () => {
    const previous = [outlet({ address: { storeAddress: "Old", deliveryAddress: "", routeDirection: "" }, ordinal: 0 })];
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
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.guidStore, EXTENDED_FIXTURE_GUIDS.STORE_ONE);
    assert.equal(merged[0]?.address.storeAddress, "New");
  });

  it("records closure history on reopen", () => {
    const previous = [outlet({ closed: true, closureStatus: "closed" })];
    const incoming = [outlet({ closed: false, closureStatus: "open" })];
    const merged = mergeRetailOutletsWithIdentity(incoming, "present", previous, {
      sourceSha256: "sha-b",
      importedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(merged[0]?.closureStatus, "open");
    assert.equal(merged[0]?.closureHistory.length, 1);
    assert.equal(merged[0]?.closureHistory[0]?.closed, false);
  });

  it("dedupes identical confirmed rows", () => {
    const deduped = dedupeIdenticalOutlets([
      outlet(),
      outlet(),
    ]);
    assert.equal(deduped.length, 1);
  });

  it("does not attach anonymous history entries to new guid outlets", () => {
    const anonymous = outlet({
      guidStore: null,
      outletGuidStatus: "not_provided",
      closureStatus: "not_provided",
      closed: null,
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
    const identified = outlet();
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
        retailOutlets: [identified],
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
    assert.equal(second.currentRetailOutlets.some((item) => item.guidStore === EXTENDED_FIXTURE_GUIDS.STORE_ONE), true);
    assert.equal(second.currentRetailOutlets.some((item) => item.outletGuidStatus === "not_provided"), true);
  });
});
