import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExtendedSnapshotJson } from "../../src/onec-clients/extended-apply";
import {
  countKnownOutletsMissingFromSnapshot,
  dedupeIdenticalOutlets,
  mergeRetailOutletsWithIdentity,
  outletBusinessProjection,
  outletDuplicateRowsEquivalent,
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
    assert.equal(second.retailOutletHistory.length, 1);
    assert.equal(second.retailOutletHistory[0]?.sourceSha256, "sha-a");
    assert.equal(second.retailOutletHistory[0]?.archivedAt, "2026-01-02T00:00:00.000Z");
    assert.ok(second.retailOutletHistory.some((entry) => entry.retailOutlets[0]?.outletGuidStatus === "not_provided"));
  });

  it("marks all outlets absent when retail_outlets block is missing", () => {
    const previous = [
      outlet({
        provenance: {
          freshness: "current",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ];
    const merged = mergeRetailOutletsWithIdentity([], "missing", previous, {
      sourceSha256: "sha-b",
      importedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(merged.outlets.length, 1);
    assert.equal(merged.outlets[0]?.provenance.freshness, "absent_from_current_export");
    assert.equal(merged.outlets[0]?.provenance.sourceSha256, "sha-a");
    assert.equal(merged.outlets[0]?.closureConfirmedInCurrentExport, false);
    assert.equal(merged.outletsInCurrentExport.length, 0);
  });

  it("counts missing outlets from source guids before merge restoration", () => {
    const registry = new Map([
      [
        EXTENDED_FIXTURE_GUIDS.STORE_ONE.toLowerCase(),
        {
          guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
          guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
          is_closed: false,
          last_source_sha256: "sha-a",
          last_imported_at: "2026-01-01T00:00:00.000Z",
          closure_history: [],
        },
      ],
      [
        EXTENDED_FIXTURE_GUIDS.STORE_TWO.toLowerCase(),
        {
          guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
          guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
          is_closed: false,
          last_source_sha256: "sha-a",
          last_imported_at: "2026-01-01T00:00:00.000Z",
          closure_history: [],
        },
      ],
    ]);
    const sourceGuids = new Set([EXTENDED_FIXTURE_GUIDS.STORE_TWO.toLowerCase()]);
    assert.equal(
      countKnownOutletsMissingFromSnapshot(EXTENDED_FIXTURE_GUIDS.HOLDING_GUID, sourceGuids, registry),
      1,
    );
  });

  it("archives changed identified outlet while deduplicating anonymous merge history", () => {
    const anonymous = outlet({
      guidStore: null,
      outletGuidStatus: "not_provided",
      closureStatus: "not_provided",
      closed: null,
      closureConfirmedInCurrentExport: false,
      provenance: {
        freshness: "current",
        sourceSha256: "sha-a",
        importedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const identified = outlet({
      address: { storeAddress: "Old identified", deliveryAddress: "", routeDirection: "" },
      provenance: {
        freshness: "current",
        sourceSha256: "sha-a",
        importedAt: "2026-01-01T00:00:00.000Z",
      },
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
        retailOutlets: [anonymous, identified],
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
        retailOutlets: [
          outlet({
            address: { storeAddress: "New identified", deliveryAddress: "", routeDirection: "" },
          }),
        ],
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
    assert.equal(second.retailOutletHistory.length, 2);
    assert.equal(second.retailOutletHistory[0]?.sourceSha256, "sha-a");
    assert.ok(
      second.retailOutletHistory[0]?.retailOutlets.every(
        (item) => item.outletGuidStatus === "not_provided",
      ),
    );
    assert.equal(second.retailOutletHistory[1]?.sourceSha256, "sha-a");
    assert.equal(
      second.retailOutletHistory[1]?.retailOutlets[0]?.address.storeAddress,
      "Old identified",
    );
  });

  function holdingRecord(retailOutlets: ParsedRetailOutlet[]) {
    return {
      guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
      name_client: "Holding",
      guid_holding: null,
      name_holding: "",
      guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
      name_manager: "Manager",
      address: "Addr",
      telephone: [],
      isHolding: true,
      regionalManager: { guid: null, name: "", state: "not_provided" as const },
      hardwareManager: { guid: null, name: "", state: "not_provided" as const },
      headOfSales: { guid: null, name: "", state: "not_provided" as const },
      retailOutlets,
      recordFormat: "extended_v1" as const,
      hasExtendedManagerFields: true,
      fieldPresence: {
        holding: "present" as const,
        retailOutlets: "present" as const,
        regionalManager: "missing" as const,
        hardwareManager: "missing" as const,
        headOfSales: "missing" as const,
      },
    };
  }

  it("archives TT2 closed=true state with export B origin on A -> B -> C", () => {
    const tt1 = outlet({
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
    });
    const tt2 = outlet({
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
    });
    const snapshotA = buildExtendedSnapshotJson(
      holdingRecord([tt1, tt2]),
      null,
      "sha-a",
      "2026-10-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const snapshotB = buildExtendedSnapshotJson(
      holdingRecord([
        outlet({
          guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
          closed: true,
          closureStatus: "closed",
          closureConfirmedInCurrentExport: true,
        }),
      ]),
      snapshotA,
      "sha-b",
      "2026-10-02T00:00:00.000Z",
      { contractVerified: true },
    );
    const snapshotC = buildExtendedSnapshotJson(
      holdingRecord([
        outlet({
          guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
          closed: false,
          closureStatus: "open",
          closureConfirmedInCurrentExport: true,
        }),
      ]),
      snapshotB,
      "sha-c",
      "2026-10-03T00:00:00.000Z",
      { contractVerified: true },
    );

    const closedArchive = snapshotC.retailOutletHistory.find((entry) =>
      entry.retailOutlets.some(
        (item) =>
          item.guidStore === EXTENDED_FIXTURE_GUIDS.STORE_TWO && item.closed === true,
      ),
    );
    assert.ok(closedArchive);
    assert.equal(closedArchive?.sourceSha256, "sha-b");
    assert.equal(closedArchive?.capturedAt, "2026-10-02T00:00:00.000Z");
    assert.equal(closedArchive?.archivedAt, "2026-10-03T00:00:00.000Z");
    assert.equal(
      closedArchive?.retailOutlets[0]?.provenance.sourceSha256,
      "sha-b",
    );
  });

  it("splits history entries when archiving outlets of different provenance together", () => {
    const tt1 = outlet({
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
    });
    const tt2 = outlet({
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
      closed: false,
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
    });
    const snapshotA = buildExtendedSnapshotJson(
      holdingRecord([tt1, tt2]),
      null,
      "sha-a",
      "2026-10-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const snapshotB = buildExtendedSnapshotJson(
      holdingRecord([
        outlet({
          guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
          closed: true,
          closureStatus: "closed",
          closureConfirmedInCurrentExport: true,
        }),
      ]),
      snapshotA,
      "sha-b",
      "2026-10-02T00:00:00.000Z",
      { contractVerified: true },
    );
    const snapshotC = buildExtendedSnapshotJson(
      holdingRecord([
        outlet({
          guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
          closed: false,
          closureStatus: "open",
          closureConfirmedInCurrentExport: true,
        }),
        outlet({
          guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
          closed: false,
          closureStatus: "open",
          closureConfirmedInCurrentExport: true,
        }),
      ]),
      snapshotB,
      "sha-c",
      "2026-10-03T00:00:00.000Z",
      { contractVerified: true },
    );

    const newEntries = snapshotC.retailOutletHistory.slice(snapshotB.retailOutletHistory.length);
    assert.equal(newEntries.length, 2);
    const origins = newEntries.map((entry) => `${entry.sourceSha256}|${entry.capturedAt}`).sort();
    assert.deepEqual(origins, [
      "sha-a|2026-10-01T00:00:00.000Z",
      "sha-b|2026-10-02T00:00:00.000Z",
    ]);
    assert.equal(newEntries.every((entry) => entry.archivedAt === "2026-10-03T00:00:00.000Z"), true);
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

  it("preserves confirmed loading time on ambiguous sentinel but clears DOB on explicit empty sentinel", () => {
    const previous = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: "09:00",
        loadingTimeSourceRaw: "09:00",
        loadingTimeConfirmedInCurrentExport: true,
        loadingTimeFieldProvenance: {
          freshness: "current",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      lpr: {
        ...outlet().lpr,
        dateOfBirth: "1980-05-01",
        dateOfBirthSourceRaw: "1980-05-01",
        dateOfBirthConfirmedInCurrentExport: true,
        dateOfBirthFieldProvenance: {
          freshness: "current",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const incoming = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: null,
        loadingTimeSourceRaw: "0001-01-01T00:00:00",
        loadingTimeAmbiguous: true,
        loadingTimeConfirmedInCurrentExport: false,
      },
      lpr: {
        ...outlet().lpr,
        dateOfBirth: null,
        dateOfBirthSourceRaw: "0001-01-01T00:00:00",
        dateOfBirthExplicitEmpty: true,
        dateOfBirthAmbiguous: false,
        dateOfBirthConfirmedInCurrentExport: true,
      },
    });
    const merged = mergeRetailOutletsWithIdentity([incoming], "present", [previous], {
      sourceSha256: "sha-b",
      importedAt: "2026-01-02T00:00:00.000Z",
    });
    const result = merged.outlets[0];
    assert.equal(result?.loading.loadingTime, "09:00");
    assert.equal(result?.loading.loadingTimeAmbiguousIncomingRaw, "0001-01-01T00:00:00");
    assert.equal(result?.loading.loadingTimeConfirmedInCurrentExport, false);
    assert.equal(result?.loading.loadingTimeFieldProvenance?.sourceSha256, "sha-a");
    assert.equal(result?.loading.loadingTimeFieldProvenance?.freshness, "preserved_from_previous");
    assert.equal(result?.lpr.dateOfBirth, null);
    assert.equal(result?.lpr.dateOfBirthExplicitEmpty, true);
    assert.equal(result?.lpr.dateOfBirthConfirmedInCurrentExport, true);
    assert.equal(result?.lpr.dateOfBirthFieldProvenance?.freshness, "current");
  });

  it("preserves loading time through A→B→C ambiguous snapshots, clears DOB on explicit empty, accepts D", () => {
    const confirmed = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: "09:00",
        loadingTimeSourceRaw: "09:00",
        loadingTimeConfirmedInCurrentExport: true,
        loadingTimeFieldProvenance: {
          freshness: "current",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      lpr: {
        ...outlet().lpr,
        dateOfBirth: "1980-05-01",
        dateOfBirthSourceRaw: "1980-05-01",
        dateOfBirthConfirmedInCurrentExport: true,
        dateOfBirthFieldProvenance: {
          freshness: "current",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const ambiguous = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: null,
        loadingTimeSourceRaw: "0001-01-01T00:00:00",
        loadingTimeAmbiguous: true,
      },
      lpr: {
        ...outlet().lpr,
        dateOfBirth: null,
        dateOfBirthSourceRaw: "0001-01-01T00:00:00",
        dateOfBirthExplicitEmpty: true,
        dateOfBirthAmbiguous: false,
        dateOfBirthConfirmedInCurrentExport: true,
      },
    });
    const afterB = mergeRetailOutletsWithIdentity([ambiguous], "present", [confirmed], {
      sourceSha256: "sha-b",
      importedAt: "2026-01-02T00:00:00.000Z",
    }).outlets[0]!;
    const afterC = mergeRetailOutletsWithIdentity([ambiguous], "present", [afterB], {
      sourceSha256: "sha-c",
      importedAt: "2026-01-03T00:00:00.000Z",
    }).outlets[0]!;
    assert.equal(afterC.loading.loadingTime, "09:00");
    assert.equal(afterC.lpr.dateOfBirth, null);
    assert.equal(afterC.lpr.dateOfBirthExplicitEmpty, true);
    assert.equal(afterC.loading.loadingTimeFieldProvenance?.sourceSha256, "sha-a");
    assert.equal(afterC.lpr.dateOfBirthFieldProvenance?.sourceSha256, "sha-c");
    assert.equal(afterC.loading.loadingTimeFieldProvenance?.freshness, "preserved_from_previous");

    const updated = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: "10:30",
        loadingTimeSourceRaw: "10:30",
        loadingTimeConfirmedInCurrentExport: true,
      },
      lpr: {
        ...outlet().lpr,
        dateOfBirth: "1985-06-20",
        dateOfBirthSourceRaw: "1985-06-20",
        dateOfBirthConfirmedInCurrentExport: true,
      },
    });
    const afterD = mergeRetailOutletsWithIdentity([updated], "present", [afterC], {
      sourceSha256: "sha-d",
      importedAt: "2026-01-04T00:00:00.000Z",
    }).outlets[0]!;
    assert.equal(afterD.loading.loadingTime, "10:30");
    assert.equal(afterD.lpr.dateOfBirth, "1985-06-20");
    assert.equal(afterD.loading.loadingTimeAmbiguousIncomingRaw, null);
    assert.equal(afterD.loading.loadingTimeConfirmedInCurrentExport, true);
    assert.equal(afterD.loading.loadingTimeFieldProvenance?.sourceSha256, "sha-d");
    assert.equal(afterD.loading.loadingTimeFieldProvenance?.freshness, "current");
  });

  it("treats ambiguous and explicit null duplicate rows as incompatible", () => {
    const ambiguous = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: null,
        loadingTimeAmbiguous: true,
        loadingTimeSourceRaw: "0001-01-01T00:00:00",
      },
      lpr: {
        ...outlet().lpr,
        dateOfBirth: null,
        dateOfBirthAmbiguous: true,
        dateOfBirthSourceRaw: "0001-01-01T00:00:00",
      },
    });
    const explicitEmpty = outlet({
      loading: { ...outlet().loading, loadingTime: null, loadingTimeAmbiguous: false },
      lpr: {
        ...outlet().lpr,
        dateOfBirth: null,
        dateOfBirthAmbiguous: false,
        dateOfBirthExplicitEmpty: true,
      },
    });
    assert.equal(outletDuplicateRowsEquivalent(ambiguous, explicitEmpty), false);
    assert.equal(outletsAreIdentical(ambiguous, explicitEmpty), true);
  });

  it("leaves ambiguous loading time unknown for new outlets without prior confirmation", () => {
    const incoming = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: null,
        loadingTimeSourceRaw: "0001-01-01T00:00:00",
        loadingTimeAmbiguous: true,
      },
    });
    const merged = mergeRetailOutletsWithIdentity([incoming], "present", [], {
      sourceSha256: "sha-a",
      importedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(merged.outlets[0]?.loading.loadingTime, null);
    assert.equal(merged.outlets[0]?.loading.loadingTimeAmbiguous, true);
    assert.equal(merged.outlets[0]?.loading.loadingTimeConfirmedInCurrentExport, false);
  });

  it("treats equivalent loading time formats as identical business values", () => {
    const plain = outlet({
      loading: { ...outlet().loading, loadingTime: "09:00", loadingTimeSourceRaw: "09:00" },
    });
    const iso = outlet({
      loading: {
        ...outlet().loading,
        loadingTime: "09:00",
        loadingTimeSourceRaw: "0001-01-01T09:00:00",
      },
    });
    assert.equal(outletsAreIdentical(plain, iso), true);
    assert.equal(dedupeIdenticalOutlets([plain, iso]).length, 1);
  });

  it("does not treat raw-only differences as business changes for midnight date of birth", () => {
    const plain = outlet({
      lpr: { ...outlet().lpr, dateOfBirth: "1980-05-01", dateOfBirthSourceRaw: "1980-05-01" },
    });
    const midnight = outlet({
      lpr: {
        ...outlet().lpr,
        dateOfBirth: "1980-05-01",
        dateOfBirthSourceRaw: "1980-05-01T00:00:00",
      },
    });
    assert.equal(outletsAreIdentical(plain, midnight), true);
  });

  it("does not append history on repeated ambiguous snapshots after confirmed values", () => {
    const holdingRecord = (outlets: ParsedRetailOutlet[]) => ({
      guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
      name_client: "Holding",
      guid_holding: null,
      name_holding: "",
      guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
      name_manager: "Manager",
      address: "Addr",
      telephone: [] as string[],
      isHolding: true,
      regionalManager: { guid: null, name: "", state: "not_provided" as const },
      hardwareManager: { guid: null, name: "", state: "not_provided" as const },
      headOfSales: { guid: null, name: "", state: "not_provided" as const },
      retailOutlets: outlets,
      recordFormat: "extended_v1" as const,
      hasExtendedManagerFields: true,
      fieldPresence: {
        holding: "present" as const,
        retailOutlets: "present" as const,
        regionalManager: "missing" as const,
        hardwareManager: "missing" as const,
        headOfSales: "missing" as const,
      },
    });
    const ambiguousOutlet = () =>
      outlet({
        loading: {
          ...outlet().loading,
          loadingTime: null,
          loadingTimeSourceRaw: "0001-01-01T00:00:00",
          loadingTimeAmbiguous: true,
        },
      });
    const first = buildExtendedSnapshotJson(
      holdingRecord([
        outlet({
          loading: {
            ...outlet().loading,
            loadingTime: "09:00",
            loadingTimeSourceRaw: "09:00",
            loadingTimeConfirmedInCurrentExport: true,
          },
        }),
      ]),
      null,
      "sha-a",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const second = buildExtendedSnapshotJson(
      holdingRecord([ambiguousOutlet()]),
      first,
      "sha-b",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );
    const third = buildExtendedSnapshotJson(
      holdingRecord([ambiguousOutlet()]),
      second,
      "sha-c",
      "2026-01-03T00:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(second.retailOutletHistory.length, first.retailOutletHistory.length);
    assert.equal(third.retailOutletHistory.length, first.retailOutletHistory.length);
    assert.equal(third.currentRetailOutlets[0]?.loading.loadingTime, "09:00");
  });

  it("does not append history when only loading time source format changes", () => {
    const holdingRecord = (outlets: ParsedRetailOutlet[]) => ({
      guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
      name_client: "Holding",
      guid_holding: null,
      name_holding: "",
      guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
      name_manager: "Manager",
      address: "Addr",
      telephone: [] as string[],
      isHolding: true,
      regionalManager: { guid: null, name: "", state: "not_provided" as const },
      hardwareManager: { guid: null, name: "", state: "not_provided" as const },
      headOfSales: { guid: null, name: "", state: "not_provided" as const },
      retailOutlets: outlets,
      recordFormat: "extended_v1" as const,
      hasExtendedManagerFields: true,
      fieldPresence: {
        holding: "present" as const,
        retailOutlets: "present" as const,
        regionalManager: "missing" as const,
        hardwareManager: "missing" as const,
        headOfSales: "missing" as const,
      },
    });

    const first = buildExtendedSnapshotJson(
      holdingRecord([
        outlet({
          loading: {
            ...outlet().loading,
            loadingTime: "09:00",
            loadingTimeSourceRaw: "09:00",
            loadingTimeConfirmedInCurrentExport: true,
          },
        }),
      ]),
      null,
      "sha-a",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const second = buildExtendedSnapshotJson(
      holdingRecord([
        outlet({
          loading: {
            ...outlet().loading,
            loadingTime: "09:00",
            loadingTimeSourceRaw: "0001-01-01T09:00:00",
            loadingTimeConfirmedInCurrentExport: true,
          },
        }),
      ]),
      first,
      "sha-b",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(second.retailOutletHistory.length, first.retailOutletHistory.length);
  });
});
