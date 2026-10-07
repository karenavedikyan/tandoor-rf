import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessContext } from "../../src/access/types";
import { toClientExtendedDto } from "../../src/clients/extended-dto";
import type { ParsedManagerRef, ParsedRetailOutlet } from "../../src/onec-clients/extended-types";
import { EXTENDED_FIXTURE_GUIDS } from "../helpers/onec-clients-extended-fixtures";

const adminContext: AccessContext = {
  userId: "admin",
  role: "admin",
  status: "active",
  fullClientBase: true,
  employeeId: null,
  employeeLinkConflict: false,
  hasEmployeeLink: false,
  hasScopedClientAccess: false,
  explicitlyDeniedAll: false,
};

const managerContext: AccessContext = {
  userId: "manager",
  role: "manager",
  status: "active",
  fullClientBase: false,
  employeeId: "22222222-2222-4222-8222-222222222222",
  employeeLinkConflict: false,
  hasEmployeeLink: true,
  hasScopedClientAccess: true,
  explicitlyDeniedAll: false,
};

const regionalContext: AccessContext = {
  userId: "regional",
  role: "regional_manager",
  status: "active",
  fullClientBase: false,
  employeeId: EXTENDED_FIXTURE_GUIDS.REGIONAL,
  employeeLinkConflict: false,
  hasEmployeeLink: true,
  hasScopedClientAccess: true,
  explicitlyDeniedAll: false,
};

describe("clients extended dto", () => {
  it("withholds LPR and bonus fields from API dto", () => {
    const outlet: ParsedRetailOutlet = {
      ordinal: 0,
      holdingName: "H1",
      warehouse: true,
      address: { storeAddress: "A", deliveryAddress: "B", routeDirection: "N" },
      loading: {
        loadingOnMonday: true,
        loadingOnTuesday: null,
        loadingOnWednesday: null,
        loadingOnThursday: null,
        loadingOnFriday: null,
        loadingOnSaturday: null,
        loadingOnSunday: null,
        loadingTime: "09:00",
      },
      managers: {
        manager: { guid: null, name: "", state: "unassigned" },
        regionalManager: { guid: null, name: "", state: "unassigned" },
        hardwareManager: { guid: null, name: "", state: "unassigned" },
        headOfSales: { guid: null, name: "", state: "unassigned" },
      },
      contacts: { storePhone: "1", accountantPhone: "2", accountantEmail: "a@b.c" },
      lpr: {
        name: "Secret",
        post: "CEO",
        dateOfBirth: "1980-01-01",
        phone: "secret",
        email: "secret@x.test",
        bonus: "100",
        conditionsBonus: "cond",
      },
      additional: { statusTandoorClub: "x", bonusTandoorClub: "y" },
      outletGuidStatus: "not_provided",
      closureStatus: "not_provided",
      closureConfirmedInCurrentExport: false,
      closureHistory: [],
      provenance: { freshness: "not_provided_in_snapshot", sourceSha256: "", importedAt: "" },
      distributionAllowed: false,
    };

    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: new Date("2026-01-01T10:00:00Z"),
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" } satisfies ParsedManagerRef,
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [outlet],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: false, outletNormalizedReady: false },
        },
      },
      adminContext,
    );

    assert.ok(dto);
    assert.equal(dto!.sensitiveFieldsWithheld, true);
    assert.equal(dto!.retailOutletsAccess, "granted");
    assert.equal(dto!.retailOutlets.length, 1);
    const serialized = JSON.stringify(dto);
    assert.doesNotMatch(serialized, /Secret|secret@x|conditions_bonus|bonus_tandoor/i);
  });

  it("grants admin access with empty snapshot without role denial", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: new Date("2026-01-01T10:00:00Z"),
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: true, outletNormalizedReady: false },
        },
      },
      adminContext,
    );

    assert.equal(dto!.retailOutletsAccess, "granted");
    assert.equal(dto!.retailOutletsEmptyReason, "empty_snapshot");
    assert.equal(dto!.retailOutlets.length, 0);
    assert.equal(
      dto!.dataQualityLabel,
      "В текущих данных 1С торговые точки не указаны",
    );
    assert.doesNotMatch(dto!.dataQualityLabel, /недоступны для вашей роли/i);
  });

  it("shows empty scope without leaking hidden outlet payload for scoped role", () => {
    const hiddenOutlet: ParsedRetailOutlet = {
      ordinal: 0,
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
      holdingName: "Hidden Holding",
      warehouse: null,
      address: { storeAddress: "Secret store street", deliveryAddress: "", routeDirection: "" },
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
        regionalManager: {
          guid: "99999999-9999-4999-8999-999999999999",
          name: "Other Regional",
          state: "directory_unverified",
        },
        hardwareManager: { guid: null, name: "", state: "unassigned" },
        headOfSales: { guid: null, name: "", state: "unassigned" },
      },
      contacts: { storePhone: "secret-phone", accountantPhone: "", accountantEmail: "" },
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
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      provenance: { freshness: "current", sourceSha256: "abc", importedAt: "2026-01-01T10:00:00.000Z" },
      distributionAllowed: false,
    };

    const dto = toClientExtendedDto(
      {
        is_holding: true,
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [hiddenOutlet],
          retailOutletHistory: [
            {
              sourceSha256: "hist-a",
              capturedAt: "2026-01-01T10:00:00.000Z",
              archivedAt: "2026-01-02T10:00:00.000Z",
              retailOutlets: [hiddenOutlet],
            },
            {
              sourceSha256: "hist-b",
              capturedAt: "2026-01-03T10:00:00.000Z",
              archivedAt: "2026-01-04T10:00:00.000Z",
              retailOutlets: [
                {
                  ...hiddenOutlet,
                  guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
                  address: { storeAddress: "Another secret street", deliveryAddress: "", routeDirection: "" },
                },
              ],
            },
          ],
          blocks: { clientExtendedReady: true, outletNormalizedReady: false },
        },
      },
      regionalContext,
    );

    assert.equal(dto!.retailOutletsAccess, "granted");
    assert.equal(dto!.retailOutletsEmptyReason, "empty_scope");
    assert.equal(dto!.retailOutlets.length, 0);
    assert.equal(dto!.retailOutletsTotalCount, 0);
    assert.equal(dto!.retailOutletHistoryCount, 0);
    assert.equal(
      dto!.dataQualityLabel,
      "Нет доступных торговых точек в вашей области",
    );
    const serialized = JSON.stringify(dto);
    assert.doesNotMatch(serialized, /Secret store street|secret-phone|Hidden Holding|Another secret street/i);
  });

  it("counts only scoped history entries for regional manager with visible outlets", () => {
    const ownOutlet: ParsedRetailOutlet = {
      ordinal: 0,
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
      holdingName: "Visible Holding",
      warehouse: null,
      address: { storeAddress: "Own store", deliveryAddress: "", routeDirection: "" },
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
        regionalManager: {
          guid: EXTENDED_FIXTURE_GUIDS.REGIONAL,
          name: "Regional Lead",
          state: "directory_unverified",
        },
        hardwareManager: { guid: null, name: "", state: "unassigned" },
        headOfSales: { guid: null, name: "", state: "unassigned" },
      },
      contacts: { storePhone: "own-phone", accountantPhone: "", accountantEmail: "" },
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
      closureStatus: "open",
      closureConfirmedInCurrentExport: true,
      closureHistory: [],
      provenance: { freshness: "current", sourceSha256: "abc", importedAt: "2026-01-01T10:00:00.000Z" },
      distributionAllowed: false,
    };
    const foreignOutlet: ParsedRetailOutlet = {
      ...ownOutlet,
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
      address: { storeAddress: "Foreign store", deliveryAddress: "", routeDirection: "" },
      managers: {
        ...ownOutlet.managers,
        regionalManager: {
          guid: "99999999-9999-4999-8999-999999999999",
          name: "Other Regional",
          state: "directory_unverified",
        },
      },
    };

    const dto = toClientExtendedDto(
      {
        is_holding: true,
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_A,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [ownOutlet],
          retailOutletHistory: [
            {
              sourceSha256: "hist-own",
              capturedAt: "2026-01-01T10:00:00.000Z",
              retailOutlets: [ownOutlet],
            },
            {
              sourceSha256: "hist-foreign",
              capturedAt: "2026-01-02T10:00:00.000Z",
              retailOutlets: [foreignOutlet],
            },
          ],
          blocks: { clientExtendedReady: true, outletNormalizedReady: false },
        },
      },
      regionalContext,
    );

    assert.equal(dto!.retailOutletsAccess, "granted");
    assert.equal(dto!.retailOutletsEmptyReason, "none");
    assert.equal(dto!.retailOutlets.length, 1);
    assert.equal(dto!.retailOutletHistoryCount, 1);
    assert.doesNotMatch(JSON.stringify(dto), /Foreign store/i);
  });

  it("denies nested outlets for manager without employee link", () => {
    const unlinkedManagerContext: AccessContext = {
      ...managerContext,
      employeeId: null,
      hasEmployeeLink: false,
    };
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              holdingName: "H",
              warehouse: null,
              address: { storeAddress: "secret", deliveryAddress: "", routeDirection: "" },
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
              closureConfirmedInCurrentExport: false,
              closureHistory: [],
              provenance: { freshness: "not_provided_in_snapshot", sourceSha256: "", importedAt: "" },
              distributionAllowed: false,
            },
          ],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: false, outletNormalizedReady: false },
        },
      },
      unlinkedManagerContext,
    );

    assert.equal(dto!.retailOutletsAccess, "denied");
    assert.equal(dto!.retailOutletsEmptyReason, "none");
    assert.equal(dto!.retailOutlets.length, 0);
    assert.equal(dto!.retailOutletHistoryCount, 0);
    assert.match(dto!.dataQualityLabel, /недоступны для вашей роли/i);
    assert.doesNotMatch(JSON.stringify(dto), /secret/);
  });

  it("shows empty scope for linked manager without visible outlets", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_B,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              holdingName: "H",
              warehouse: null,
              address: { storeAddress: "secret", deliveryAddress: "", routeDirection: "" },
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
                manager: { guid: EXTENDED_FIXTURE_GUIDS.MANAGER_B, name: "Other", state: "directory_unverified" },
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
              closureConfirmedInCurrentExport: false,
              closureHistory: [],
              provenance: { freshness: "not_provided_in_snapshot", sourceSha256: "", importedAt: "" },
              distributionAllowed: false,
            },
          ],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: false, outletNormalizedReady: false },
        },
      },
      managerContext,
    );

    assert.equal(dto!.retailOutletsAccess, "granted");
    assert.equal(dto!.retailOutletsEmptyReason, "empty_scope");
    assert.equal(dto!.retailOutlets.length, 0);
    assert.match(dto!.dataQualityLabel, /Нет доступных торговых точек в вашей области/);
    assert.doesNotMatch(JSON.stringify(dto), /secret/);
  });

  it("exposes blockFreshness and mixed freshness label", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        source_sha256: "sha-new",
        extended_format_version: "extended_v1",
        extended_source_sha256: "sha-new",
        extended_imported_at: new Date("2026-01-02T10:00:00Z"),
        extended_freshness_state: "preserved_from_previous",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "sha-new",
          importedAt: "2026-01-02T10:00:00.000Z",
          isHolding: true,
          regionalManager: {
            guid: EXTENDED_FIXTURE_GUIDS.REGIONAL,
            name: "Regional",
            state: "directory_unverified",
          },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [],
          retailOutletHistory: [],
          blocks: {
            clientExtendedReady: true,
            outletNormalizedReady: false,
            blockFreshness: {
              holding: "current",
              regionalManager: "preserved_from_previous",
              hardwareManager: "not_provided_in_snapshot",
              headOfSales: "not_provided_in_snapshot",
              retailOutlets: "preserved_from_previous",
            },
            blockProvenance: {
              holding: {
                freshness: "current",
                sourceSha256: "sha-new",
                importedAt: "2026-01-02T10:00:00.000Z",
              },
              regionalManager: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-old",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              hardwareManager: {
                freshness: "not_provided_in_snapshot",
                sourceSha256: "sha-new",
                importedAt: "2026-01-02T10:00:00.000Z",
              },
              headOfSales: {
                freshness: "not_provided_in_snapshot",
                sourceSha256: "sha-new",
                importedAt: "2026-01-02T10:00:00.000Z",
              },
              retailOutlets: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-old",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
            },
          },
        },
      },
      adminContext,
    );
    assert.ok(dto!.blockFreshness);
    assert.equal(dto!.blockFreshness!.retailOutlets.state, "preserved_from_previous");
    assert.equal(dto!.blockFreshness!.retailOutlets.sourceSha256, "sha-old");
    assert.equal(dto!.blockFreshness!.holding.sourceSha256, "sha-new");
    assert.match(dto!.freshnessLabel, /Частично обновлено/);
    assert.equal(dto!.freshnessState, "preserved_from_previous");
    assert.equal(dto!.sourceSha256, "sha-new");
  });

  it("does not treat stale snapshot freshness as current after blocked import", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        source_sha256: "sha-new-unverified",
        extended_format_version: "extended_v1",
        extended_source_sha256: "sha-old-confirmed",
        extended_imported_at: new Date("2026-01-01T10:00:00Z"),
        extended_freshness_state: "preserved_from_previous",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "sha-old-confirmed",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: {
            guid: EXTENDED_FIXTURE_GUIDS.REGIONAL,
            name: "Regional",
            state: "directory_unverified",
          },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [],
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
        },
      },
      adminContext,
    );
    assert.equal(dto!.freshnessState, "preserved_from_previous");
    assert.match(dto!.freshnessLabel, /не обновлены последней выгрузкой/);
    assert.equal(dto!.blockFreshness!.holding.state, "preserved_from_previous");
    assert.equal(dto!.blockFreshness!.retailOutlets.state, "preserved_from_previous");
  });

  it("labels not_provided separately from unassigned", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: false,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "not_provided_in_snapshot",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: false,
          regionalManager: { guid: null, name: "", state: "not_provided" },
          hardwareManager: { guid: null, name: "", state: "not_provided" },
          headOfSales: { guid: null, name: "", state: "not_provided" },
          currentRetailOutlets: [],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: false, outletNormalizedReady: false },
        },
      },
      adminContext,
    );
    assert.equal(dto!.managers.regionalManager.assignmentLabel, "Не передано");
    assert.equal(dto!.managers.hardwareManager.assignmentLabel, "Не передано");
  });

  it("resolves account link at read time", () => {
    const linked = new Set([EXTENDED_FIXTURE_GUIDS.REGIONAL.toLowerCase()]);
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: {
            guid: EXTENDED_FIXTURE_GUIDS.REGIONAL,
            name: "Regional Lead",
            state: "directory_unverified",
          },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: true, outletNormalizedReady: false },
        },
      },
      adminContext,
      { linkedEmployeeGuids: linked },
    );
    assert.equal(dto!.managers.regionalManager.assignmentState, "directory_unverified_account_linked");
  });

  it("marks partial loading schedule when one day is false and others null", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              holdingName: "H",
              warehouse: null,
              address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
              loading: {
                loadingOnMonday: false,
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
              closureConfirmedInCurrentExport: false,
              closureHistory: [],
              provenance: { freshness: "not_provided_in_snapshot", sourceSha256: "", importedAt: "" },
              distributionAllowed: false,
            },
          ],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: false, outletNormalizedReady: false },
        },
      },
      adminContext,
    );
    assert.equal(dto!.retailOutlets[0]?.loading.scheduleState, "partial");
  });

  it("shows confirmed outlet identity and closure labels", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
              holdingName: "H",
              warehouse: null,
              address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
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
              closed: true,
              closureStatus: "closed",
              closureConfirmedInCurrentExport: true,
              closureHistory: [],
              provenance: {
                freshness: "current",
                sourceSha256: "abc",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              distributionAllowed: false,
            },
          ],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: true, outletNormalizedReady: false },
        },
      },
      adminContext,
    );
    assert.match(dto!.retailOutlets[0]?.identityLabel, /Торговая точка 1С/);
    assert.equal(dto!.retailOutlets[0]?.closureStatusLabel, "Закрыта");
    assert.match(dto!.retailOutlets[0]?.distributionNote, /закрытой/);
  });

  it("keeps per-outlet current labels when block freshness is mixed", () => {
    const absentOutlet: ParsedRetailOutlet = {
      ordinal: 0,
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
      holdingName: "H",
      warehouse: null,
      address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
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
      closureConfirmedInCurrentExport: false,
      closureHistory: [],
      provenance: {
        freshness: "absent_from_current_export",
        sourceSha256: "sha-a",
        importedAt: "2026-01-01T10:00:00.000Z",
      },
      distributionAllowed: false,
    };
    const currentOutlet: ParsedRetailOutlet = {
      ...absentOutlet,
      ordinal: 1,
      guidStore: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
      closed: true,
      closureStatus: "closed",
      closureConfirmedInCurrentExport: true,
      provenance: {
        freshness: "current",
        sourceSha256: "sha-b",
        importedAt: "2026-01-02T10:00:00.000Z",
      },
    };
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        source_sha256: "sha-b",
        extended_format_version: "extended_v1",
        extended_source_sha256: "sha-b",
        extended_imported_at: new Date("2026-01-02T10:00:00Z"),
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "sha-b",
          importedAt: "2026-01-02T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [absentOutlet, currentOutlet],
          retailOutletHistory: [],
          blocks: {
            clientExtendedReady: true,
            outletNormalizedReady: false,
            blockFreshness: {
              holding: "current",
              regionalManager: "preserved_from_previous",
              hardwareManager: "preserved_from_previous",
              headOfSales: "preserved_from_previous",
              retailOutlets: "preserved_from_previous",
            },
            blockProvenance: {
              holding: {
                freshness: "current",
                sourceSha256: "sha-b",
                importedAt: "2026-01-02T10:00:00.000Z",
              },
              regionalManager: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              hardwareManager: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              headOfSales: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              retailOutlets: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
            },
          },
        },
      },
      adminContext,
    );
    assert.equal(dto!.retailOutlets[0]?.presentInCurrentExport, false);
    assert.match(dto!.retailOutlets[0]?.dataSourceLabel, /отсутствует в текущем файле/);
    assert.match(dto!.retailOutlets[0]?.closureStatusLabel, /не подтверждён текущей выгрузкой/);
    assert.equal(dto!.retailOutlets[1]?.presentInCurrentExport, true);
    assert.equal(dto!.retailOutlets[1]?.dataSourceLabel, "Подтверждено текущей выгрузкой");
    assert.equal(dto!.retailOutlets[1]?.closureStatusLabel, "Закрыта");
  });

  it("does not mark preserved outlets as confirmed by current export when block is missing", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        source_sha256: "legacy-b",
        extended_format_version: "extended_v1",
        extended_source_sha256: "legacy-b",
        extended_imported_at: new Date("2026-01-02T10:00:00Z"),
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "legacy-b",
          importedAt: "2026-01-02T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
              holdingName: "H",
              warehouse: null,
              address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
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
              closureConfirmedInCurrentExport: false,
              closureHistory: [],
              provenance: {
                freshness: "absent_from_current_export",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              distributionAllowed: false,
            },
          ],
          retailOutletHistory: [],
          blocks: {
            clientExtendedReady: true,
            outletNormalizedReady: false,
            blockFreshness: {
              holding: "current",
              regionalManager: "preserved_from_previous",
              hardwareManager: "preserved_from_previous",
              headOfSales: "preserved_from_previous",
              retailOutlets: "preserved_from_previous",
            },
            blockProvenance: {
              holding: {
                freshness: "current",
                sourceSha256: "legacy-b",
                importedAt: "2026-01-02T10:00:00.000Z",
              },
              regionalManager: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              hardwareManager: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              headOfSales: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              retailOutlets: {
                freshness: "preserved_from_previous",
                sourceSha256: "sha-a",
                importedAt: "2026-01-01T10:00:00.000Z",
              },
            },
          },
        },
      },
      adminContext,
    );
    assert.equal(dto!.retailOutlets[0]?.presentInCurrentExport, false);
    assert.match(dto!.retailOutlets[0]?.dataSourceLabel, /отсутствует в текущем файле/);
    assert.match(dto!.retailOutlets[0]?.closureStatusLabel, /не подтверждён текущей выгрузкой/);
  });

  it("downgrades outlet labels when extended block was not updated on last import", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        source_sha256: "legacy-b",
        extended_format_version: "extended_v1",
        extended_source_sha256: "sha-a",
        extended_imported_at: new Date("2026-01-01T10:00:00Z"),
        extended_freshness_state: "preserved_from_previous",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
              holdingName: "H",
              warehouse: null,
              address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
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
                importedAt: "2026-01-01T10:00:00.000Z",
              },
              distributionAllowed: false,
            },
          ],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: false, outletNormalizedReady: false },
        },
      },
      adminContext,
    );
    assert.equal(dto!.retailOutlets[0]?.presentInCurrentExport, false);
    assert.match(dto!.retailOutlets[0]?.dataSourceLabel, /Сохранено из предыдущей выгрузки/);
    assert.match(dto!.freshnessLabel, /не обновлены последней выгрузкой/);
  });

  it("reads legacy snapshots without outlet provenance safely", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "sha-a",
        extended_imported_at: new Date("2026-01-01T10:00:00Z"),
        extended_freshness_state: "preserved_from_previous",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "sha-a",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              guidStore: null,
              holdingName: "H",
              warehouse: null,
              address: { storeAddress: "Legacy store", deliveryAddress: "", routeDirection: "" },
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
              closed: null,
              closureStatus: "not_provided",
              closureConfirmedInCurrentExport: false,
              closureHistory: [],
              distributionAllowed: false,
            } as ParsedRetailOutlet,
          ],
          retailOutletHistory: [],
          blocks: {
            clientExtendedReady: false,
            outletNormalizedReady: false,
            blockFreshness: {
              holding: "preserved_from_previous",
              regionalManager: "preserved_from_previous",
              hardwareManager: "preserved_from_previous",
              headOfSales: "preserved_from_previous",
              retailOutlets: "preserved_from_previous",
            },
          },
        },
      },
      adminContext,
    );
    assert.equal(dto!.retailOutlets.length, 1);
    assert.equal(dto!.retailOutlets[0]?.presentInCurrentExport, false);
    assert.match(dto!.retailOutlets[0]?.dataSourceLabel, /Сохранено из предыдущей выгрузки/);
  });

  it("shows preserved loading time with ambiguous incoming note without claiming current confirmation", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: true,
        extended_format_version: "extended_v1",
        extended_source_sha256: "sha-b",
        extended_imported_at: new Date("2026-01-02T10:00:00Z"),
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "sha-b",
          importedAt: "2026-01-02T10:00:00.000Z",
          isHolding: true,
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [
            {
              ordinal: 0,
              guidStore: EXTENDED_FIXTURE_GUIDS.STORE_ONE,
              holdingName: "H1",
              warehouse: true,
              address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
              loading: {
                loadingOnMonday: true,
                loadingOnTuesday: null,
                loadingOnWednesday: null,
                loadingOnThursday: null,
                loadingOnFriday: null,
                loadingOnSaturday: null,
                loadingOnSunday: null,
                loadingTime: "09:00",
                loadingTimeSourceRaw: "09:00",
                loadingTimeAmbiguousIncomingRaw: "0001-01-01T00:00:00",
                loadingTimeConfirmedInCurrentExport: false,
                loadingTimeFieldProvenance: {
                  freshness: "preserved_from_previous",
                  sourceSha256: "sha-a",
                  importedAt: "2026-01-01T10:00:00.000Z",
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
              },
              additional: { statusTandoorClub: "", bonusTandoorClub: "" },
              outletGuidStatus: "confirmed",
              closed: false,
              closureStatus: "open",
              closureConfirmedInCurrentExport: true,
              closureHistory: [],
              provenance: {
                freshness: "current",
                sourceSha256: "sha-b",
                importedAt: "2026-01-02T10:00:00.000Z",
              },
              distributionAllowed: false,
            },
          ],
          retailOutletHistory: [],
          blocks: { clientExtendedReady: false, outletNormalizedReady: false },
        },
      },
      adminContext,
    );
    assert.equal(dto!.retailOutlets[0]?.loading.loadingTime, "09:00");
    assert.match(dto!.retailOutlets[0]?.loading.loadingTimeNote ?? "", /неоднозначное значение/);
    assert.match(dto!.retailOutlets[0]?.dataSourceLabel ?? "", /Частично подтверждено/);
    assert.equal(dto!.retailOutlets[0]?.presentInCurrentExport, true);
  });

  it("labels directory-unverified manager separately from unassigned", () => {
    const dto = toClientExtendedDto(
      {
        is_holding: false,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          regionalManager: {
            guid: "99999999-9999-4999-8999-999999999999",
            name: "Unknown Person",
            state: "directory_unverified",
          },
          hardwareManager: { guid: null, name: "", state: "unassigned" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
          currentRetailOutlets: [],
          retailOutletHistory: [],
        },
      },
      adminContext,
    );
    assert.match(
      dto!.managers.regionalManager.assignmentLabel,
      /Unknown Person · Справочник 1С не проверен/,
    );
    assert.equal(dto!.managers.hardwareManager.assignmentLabel, "Не назначен");
  });
});
