import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExtendedSnapshotJson,
  extendedBusinessDataEqual,
  readExtendedSnapshot,
} from "../../src/onec-clients/extended-apply";
import type { ExtendedRecordFieldPresence, FieldPresenceState } from "../../src/onec-clients/extended-presence";
import type { ParsedExtendedClientRecord, ParsedRetailOutlet } from "../../src/onec-clients/extended-types";

function outlet(label: string, ordinal: number): ParsedRetailOutlet {
  return {
    ordinal,
    holdingName: label,
    warehouse: null,
    address: { storeAddress: label, deliveryAddress: "", routeDirection: "" },
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
    outletGuidStatus: "not_provided",
    closureStatus: "not_provided",
    distributionAllowed: false,
  };
}

function defaultPresence(retailOutlets: FieldPresenceState = "present"): ExtendedRecordFieldPresence {
  return {
    holding: "present",
    retailOutlets,
    regionalManager: "missing",
    hardwareManager: "missing",
    headOfSales: "missing",
  };
}

function record(outlets: ParsedRetailOutlet[], retailOutletsPresence: FieldPresenceState = "present"): ParsedExtendedClientRecord {
  return {
    guid_client: "11111111-1111-4111-8111-111111111111",
    name_client: "Client",
    guid_holding: null,
    name_holding: "",
    guid_manager: "22222222-2222-4222-8222-222222222222",
    name_manager: "Manager",
    address: "Addr",
    telephone: [],
    isHolding: true,
    regionalManager: { guid: null, name: "", state: "unassigned" },
    hardwareManager: { guid: null, name: "", state: "unassigned" },
    headOfSales: { guid: null, name: "", state: "unassigned" },
    retailOutlets: outlets,
    recordFormat: "extended_v1",
    hasExtendedManagerFields: false,
    fieldPresence: defaultPresence(retailOutletsPresence),
  };
}

const buildOpts = { contractVerified: true as const };

describe("extended snapshot history without ordinal merge", () => {
  it("[A,B] -> [B] keeps B current and archives previous snapshot with A and B", () => {
    const first = buildExtendedSnapshotJson(
      record([outlet("A", 0), outlet("B", 1)]),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      buildOpts,
    );
    const second = buildExtendedSnapshotJson(
      record([outlet("B", 0)]),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      buildOpts,
    );

    assert.equal(second.currentRetailOutlets.length, 1);
    assert.equal(second.currentRetailOutlets[0]?.address.storeAddress, "B");
    assert.equal(second.retailOutletHistory.length, 1);
    assert.equal(second.retailOutletHistory[0]?.retailOutlets.length, 2);
    assert.deepEqual(
      second.retailOutletHistory[0]?.retailOutlets.map((item) => item.address.storeAddress),
      ["A", "B"],
    );
  });

  it("[A,B] -> [B,A] stores reordered current without attributing old data to new snapshot", () => {
    const first = buildExtendedSnapshotJson(
      record([outlet("A", 0), outlet("B", 1)]),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      buildOpts,
    );
    const second = buildExtendedSnapshotJson(
      record([outlet("B", 0), outlet("A", 1)]),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      buildOpts,
    );

    assert.deepEqual(
      second.currentRetailOutlets.map((item) => item.address.storeAddress),
      ["B", "A"],
    );
    assert.deepEqual(
      second.retailOutletHistory[0]?.retailOutlets.map((item) => item.address.storeAddress),
      ["A", "B"],
    );
  });

  it("empty array archives previous outlets without declaring closure", () => {
    const first = buildExtendedSnapshotJson(
      record([outlet("A", 0)]),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      buildOpts,
    );
    const second = buildExtendedSnapshotJson(
      record([], "explicit_empty"),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      buildOpts,
    );

    assert.equal(second.currentRetailOutlets.length, 0);
    assert.equal(second.retailOutletHistory[0]?.retailOutlets[0]?.closureStatus, "not_provided");
  });

  it("detects extended-only business changes", () => {
    const base = buildExtendedSnapshotJson(
      record([outlet("A", 0)]),
      null,
      "sha",
      "2026-01-01T00:00:00.000Z",
      buildOpts,
    );
    const changed = buildExtendedSnapshotJson(
      record([outlet("A-changed", 0)]),
      null,
      "sha",
      "2026-01-02T00:00:00.000Z",
      buildOpts,
    );
    assert.equal(extendedBusinessDataEqual(readExtendedSnapshot(base), readExtendedSnapshot(changed)), false);
  });
});
