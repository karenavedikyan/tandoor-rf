import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtendedSnapshot, ParsedRetailOutlet } from "../../src/onec-clients/extended-types";
import { assessOutletExportFreshness } from "../../src/clients/extended-dto";

describe("outlet distribution readiness rules", () => {
  const currentOutlet: ParsedRetailOutlet = {
    ordinal: 0,
    guidStore: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    holdingName: "Holding",
    warehouse: false,
    address: { storeAddress: "Store", deliveryAddress: "", directionOfTheRoute: "" },
    loading: {
      days: [],
      loadingTime: null,
      loadingTimeNote: null,
      loadingEndTime: null,
      scheduleState: "not_provided",
      loadingTimeConfirmedInCurrentExport: true,
      loadingTimeFieldProvenance: {
        freshness: "current",
        sourceSha256: "sha-new",
        importedAt: "2026-01-02T10:00:00.000Z",
      },
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
      dateOfBirthConfirmedInCurrentExport: true,
      dateOfBirthFieldProvenance: {
        freshness: "current",
        sourceSha256: "sha-new",
        importedAt: "2026-01-02T10:00:00.000Z",
      },
    },
    additional: { statusTandoorClub: "", bonusTandoorClub: "" },
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    closureConfirmedInCurrentExport: true,
    closureHistory: [],
    provenance: {
      freshness: "current",
      sourceSha256: "sha-old-confirmed",
      importedAt: "2026-01-01T10:00:00.000Z",
    },
    distributionAllowed: false,
  };

  const staleRow = {
    extended_freshness_state: "preserved_from_previous" as const,
    source_sha256: "sha-new-unverified",
    extended_source_sha256: "sha-old-confirmed",
  };

  const snapshot: ExtendedSnapshot = {
    formatVersion: "extended_v1",
    sourceSha256: "sha-old-confirmed",
    importedAt: "2026-01-01T10:00:00.000Z",
    isHolding: true,
    holdingLink: { state: "linked", guidHolding: null, nameHolding: "" },
    clientManagerRosterState: "roster_not_loaded",
    regionalManager: { guid: null, name: "", state: "unassigned" },
    hardwareManager: { guid: null, name: "", state: "unassigned" },
    headOfSales: { guid: null, name: "", state: "unassigned" },
    currentRetailOutlets: [currentOutlet],
    retailOutletHistory: [],
    blocks: {
      clientExtendedReady: true,
      outletNormalizedReady: false,
      blockFreshness: {
        holding: "current",
        regionalManager: "current",
        hardwareManager: "current",
        headOfSales: "current",
        retailOutlets: "current",
      },
    },
  };

  it("does not treat stale snapshot outlet freshness as current after blocked import", () => {
    const assessed = assessOutletExportFreshness(currentOutlet, staleRow, snapshot);
    assert.equal(assessed.presentInCurrentExport, false);
    assert.equal(assessed.exportFreshness, "preserved_from_previous");
  });

  it("allows current outlet when retail block is current and extended import verified", () => {
    const assessed = assessOutletExportFreshness(currentOutlet, {
      extended_freshness_state: "preserved_from_previous",
      source_sha256: "sha-new",
      extended_source_sha256: "sha-new",
    }, snapshot);
    assert.equal(assessed.presentInCurrentExport, true);
    assert.equal(assessed.exportFreshness, "current");
  });
});
