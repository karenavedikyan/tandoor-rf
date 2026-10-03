import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExtendedSnapshotJson,
  extendedBusinessDataEqual,
  readExtendedSnapshot,
  summarizeRowFreshness,
} from "../../src/onec-clients/extended-apply";
import {
  extendedBusinessProjection,
  type ExtendedRecordFieldPresence,
} from "../../src/onec-clients/extended-presence";
import type { ParsedExtendedClientRecord, ParsedRetailOutlet } from "../../src/onec-clients/extended-types";

const CLIENT_GUID = "11111111-1111-4111-8111-111111111111";
const REGIONAL = "66666666-6666-4666-8666-666666666666";

function defaultPresence(overrides: Partial<ExtendedRecordFieldPresence> = {}): ExtendedRecordFieldPresence {
  return {
    holding: "present",
    retailOutlets: "present",
    regionalManager: "present",
    hardwareManager: "missing",
    headOfSales: "missing",
    ...overrides,
  };
}

function outlet(label: string): ParsedRetailOutlet {
  return {
    ordinal: 0,
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
    guidStore: null,
    outletGuidStatus: "not_provided",
    closed: null,
    closureStatus: "not_provided",
    closureHistory: [],
    distributionAllowed: false,
  };
}

function record(overrides: Partial<ParsedExtendedClientRecord> = {}): ParsedExtendedClientRecord {
  return {
    guid_client: CLIENT_GUID,
    name_client: "Client",
    guid_holding: null,
    name_holding: "",
    guid_manager: "22222222-2222-4222-8222-222222222222",
    name_manager: "Manager",
    address: "Addr",
    telephone: [],
    isHolding: true,
    regionalManager: { guid: REGIONAL, name: "Regional Lead", state: "directory_unverified" },
    hardwareManager: { guid: null, name: "", state: "unassigned" },
    headOfSales: { guid: null, name: "", state: "unassigned" },
    retailOutlets: [outlet("Store A")],
    recordFormat: "extended_v1",
    hasExtendedManagerFields: true,
    fieldPresence: defaultPresence(),
    ...overrides,
  };
}

describe("extended field presence merge", () => {
  it("does not mark mixed preserved/current blocks as fully current", () => {
    const first = buildExtendedSnapshotJson(
      record(),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const second = buildExtendedSnapshotJson(
      record({
        regionalManager: { guid: null, name: "", state: "not_provided" },
        retailOutlets: [],
        fieldPresence: defaultPresence({
          regionalManager: "missing",
          retailOutlets: "missing",
        }),
      }),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );

    assert.equal(second.blocks.blockFreshness?.holding, "current");
    assert.equal(second.blocks.blockFreshness?.retailOutlets, "preserved_from_previous");
    assert.equal(summarizeRowFreshness(second.blocks.blockFreshness!), "preserved_from_previous");
    assert.equal(second.sourceSha256, "sha-second");
    assert.equal(second.importedAt, first.importedAt);
    assert.equal(second.blocks.blockProvenance?.holding.sourceSha256, "sha-second");
    assert.equal(second.blocks.blockProvenance?.retailOutlets.sourceSha256, "sha-first");
    assert.equal(second.blocks.blockProvenance?.regionalManager.sourceSha256, "sha-first");
  });

  it("preserves regional manager and outlets when second snapshot omits those blocks", () => {
    const first = buildExtendedSnapshotJson(
      record(),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );

    const second = buildExtendedSnapshotJson(
      record({
        regionalManager: { guid: null, name: "", state: "not_provided" },
        retailOutlets: [],
        fieldPresence: defaultPresence({
          regionalManager: "missing",
          retailOutlets: "missing",
        }),
      }),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );

    assert.equal(second.regionalManager.guid, REGIONAL);
    assert.equal(second.regionalManager.name, "Regional Lead");
    assert.equal(second.currentRetailOutlets.length, 1);
    assert.equal(second.currentRetailOutlets[0]?.address.storeAddress, "Store A");
    assert.equal(second.blocks.blockFreshness?.regionalManager, "preserved_from_previous");
    assert.equal(second.blocks.blockFreshness?.retailOutlets, "preserved_from_previous");
  });

  it("clears regional manager on explicit empty assignment without inheritance", () => {
    const first = buildExtendedSnapshotJson(
      record(),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );

    const second = buildExtendedSnapshotJson(
      record({
        regionalManager: { guid: null, name: "", state: "unassigned" },
        fieldPresence: defaultPresence({ regionalManager: "explicit_empty" }),
      }),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );

    assert.equal(second.regionalManager.guid, null);
    assert.equal(second.regionalManager.state, "unassigned");
  });

  it("marks new client missing manager as not_provided", () => {
    const snapshot = buildExtendedSnapshotJson(
      record({
        regionalManager: { guid: null, name: "", state: "not_provided" },
        retailOutlets: [],
        fieldPresence: defaultPresence({
          regionalManager: "missing",
          retailOutlets: "missing",
          holding: "missing",
        }),
      }),
      null,
      "sha-new",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );

    assert.equal(snapshot.regionalManager.state, "not_provided");
    assert.equal(snapshot.currentRetailOutlets.length, 0);
    assert.equal(snapshot.blocks.blockFreshness?.regionalManager, "not_provided_in_snapshot");
  });

  it("treats re-saved JSON with new sha as unchanged business data", () => {
    const first = buildExtendedSnapshotJson(
      record(),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const second = buildExtendedSnapshotJson(
      record(),
      first,
      "sha-resaved-formatting",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );

    assert.equal(extendedBusinessDataEqual(first, second), true);
    assert.equal(second.sourceSha256, "sha-resaved-formatting");
    assert.equal(second.importedAt, first.importedAt);
    assert.equal(second.retailOutletHistory.length, 0);
  });

  it("attributes updated outlet address to the current import while preserving regional provenance", () => {
    const first = buildExtendedSnapshotJson(
      record(),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const second = buildExtendedSnapshotJson(
      record({
        retailOutlets: [outlet("Store B New Address")],
        regionalManager: { guid: null, name: "", state: "not_provided" },
        fieldPresence: defaultPresence({
          retailOutlets: "present",
          regionalManager: "missing",
        }),
      }),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );

    assert.equal(second.currentRetailOutlets[0]?.address.storeAddress, "Store B New Address");
    assert.equal(second.regionalManager.guid, REGIONAL);
    assert.equal(second.blocks.blockFreshness?.retailOutlets, "current");
    assert.equal(second.blocks.blockFreshness?.regionalManager, "preserved_from_previous");
    assert.equal(second.blocks.blockProvenance?.retailOutlets.sourceSha256, "sha-second");
    assert.equal(second.blocks.blockProvenance?.regionalManager.sourceSha256, "sha-first");
    assert.equal(second.sourceSha256, "sha-second");
    assert.equal(second.retailOutletHistory.length, 1);
    assert.equal(second.retailOutletHistory[0]?.sourceSha256, "sha-first");
  });

  it("keeps preserved block provenance on a third partial import", () => {
    const first = buildExtendedSnapshotJson(
      record(),
      null,
      "sha-first",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const second = buildExtendedSnapshotJson(
      record({
        retailOutlets: [outlet("Store B New Address")],
        regionalManager: { guid: null, name: "", state: "not_provided" },
        fieldPresence: defaultPresence({
          retailOutlets: "present",
          regionalManager: "missing",
        }),
      }),
      first,
      "sha-second",
      "2026-01-02T00:00:00.000Z",
      { contractVerified: true },
    );
    const third = buildExtendedSnapshotJson(
      record({
        regionalManager: { guid: null, name: "", state: "not_provided" },
        retailOutlets: [],
        fieldPresence: defaultPresence({
          regionalManager: "missing",
          retailOutlets: "missing",
        }),
      }),
      second,
      "sha-third",
      "2026-01-03T00:00:00.000Z",
      { contractVerified: true },
    );

    assert.equal(third.blocks.blockProvenance?.retailOutlets.sourceSha256, "sha-second");
    assert.equal(third.blocks.blockProvenance?.regionalManager.sourceSha256, "sha-first");
    assert.equal(third.currentRetailOutlets[0]?.address.storeAddress, "Store B New Address");
  });

  it("excludes sha, importedAt and history from business projection comparison", () => {
    const base = buildExtendedSnapshotJson(
      record(),
      null,
      "sha-a",
      "2026-01-01T00:00:00.000Z",
      { contractVerified: true },
    );
    const withHistory = {
      ...base,
      sourceSha256: "sha-b",
      importedAt: "2026-02-01T00:00:00.000Z",
      retailOutletHistory: [
        {
          sourceSha256: "sha-old",
          capturedAt: "2025-12-01T00:00:00.000Z",
          retailOutlets: [outlet("Archive")],
        },
      ],
    };

    assert.equal(
      extendedBusinessDataEqual(readExtendedSnapshot(base), readExtendedSnapshot(withHistory)),
      true,
    );
    assert.deepEqual(extendedBusinessProjection(readExtendedSnapshot(base)), extendedBusinessProjection(readExtendedSnapshot(withHistory)));
  });
});
