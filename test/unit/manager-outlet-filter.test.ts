import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientScopeSql } from "../../src/access/scope-sql";
import type { AccessContext } from "../../src/access/types";
import {
  countVisibleRetailOutletsForContext,
  filterRetailOutletsForContext,
} from "../../src/clients/outlet-access";
import { managerOutletRowAccessibleClause } from "../../src/clients/org/assignment-sql";
import { toClientExtendedDto } from "../../src/clients/extended-dto";
import type { ParsedRetailOutlet } from "../../src/onec-clients/extended-types";

const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "55555555-5555-4555-8555-555555555555";
const T1 = "44444444-4444-4444-8444-444444444444";
const T2 = "55555555-5555-5555-8555-555555555555";

function managerContext(employeeId: string): AccessContext {
  return {
    userId: "user",
    role: "manager",
    status: "active",
    employeeId,
    employeeLinkConflict: false,
    hasEmployeeLink: true,
    hasScopedClientAccess: true,
    fullClientBase: false,
    explicitlyDeniedAll: false,
  };
}

function outlet(input: {
  guidStore: string;
  managerGuid?: string | null;
  hardwareGuid?: string | null;
  managerState?: string;
  hardwareState?: string;
}): ParsedRetailOutlet {
  return {
    ordinal: 0,
    guidStore: input.guidStore,
    holdingName: "TT",
    warehouse: false,
    address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
    loading: {},
    managers: {
      manager: input.managerGuid
        ? {
            guid: input.managerGuid,
            name: "Manager",
            state: (input.managerState ?? "directory_unverified") as "directory_unverified",
          }
        : { guid: null, name: "", state: "unassigned" },
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: input.hardwareGuid
        ? {
            guid: input.hardwareGuid,
            name: "Hardware",
            state: (input.hardwareState ?? "directory_unverified") as "directory_unverified",
          }
        : { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: null, name: "", state: "not_provided" },
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
    provenance: { freshness: "current", sourceSha256: "abc", importedAt: "2026-01-01T10:00:00.000Z" },
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    distributionAllowed: false,
  } as ParsedRetailOutlet;
}

describe("manager outlet personal base filter", () => {
  it("M1 as client manager sees only TT1, not TT2 assigned to M2", () => {
    const filtered = filterRetailOutletsForContext(
      managerContext(M1),
      M1,
      [outlet({ guidStore: T1, managerGuid: M1 }), outlet({ guidStore: T2, managerGuid: M2 })],
    );
    assert.deepEqual(
      filtered.map((item) => item.guidStore),
      [T1],
    );
  });

  it("M2 sees only assigned TT2 on client managed by M1", () => {
    const filtered = filterRetailOutletsForContext(
      managerContext(M2),
      M1,
      [outlet({ guidStore: T1, managerGuid: M1 }), outlet({ guidStore: T2, managerGuid: M2 })],
    );
    assert.deepEqual(
      filtered.map((item) => item.guidStore),
      [T2],
    );
  });

  it("client manager inherits unassigned outlets without revealing sibling assignments", () => {
    const filtered = filterRetailOutletsForContext(
      managerContext(M1),
      M1,
      [
        outlet({ guidStore: T1, managerGuid: M1 }),
        outlet({ guidStore: T2, managerGuid: M2 }),
        outlet({ guidStore: "66666666-6666-4666-8666-666666666666", managerGuid: null }),
      ],
    );
    assert.deepEqual(
      filtered.map((item) => item.guidStore?.toLowerCase()),
      [T1.toLowerCase(), "66666666-6666-4666-8666-666666666666"],
    );
  });

  it("hardware-only assignment on TT grants outlet without sibling access", () => {
    const filtered = filterRetailOutletsForContext(
      managerContext(M1),
      M2,
      [
        outlet({ guidStore: T1, managerGuid: M2, hardwareGuid: M1 }),
        outlet({ guidStore: T2, managerGuid: M2 }),
      ],
      { clientHardwareManagerGuid: null },
    );
    assert.deepEqual(
      filtered.map((item) => item.guidStore),
      [T1],
    );
  });

  it("inherits via hardware when sales slot is assigned to another manager", () => {
    const outlets = [
      outlet({ guidStore: T2, managerGuid: M2, hardwareGuid: null, hardwareState: "unassigned" }),
    ];
    const options = { clientHardwareManagerGuid: M1 };

    const filtered = filterRetailOutletsForContext(managerContext(M1), M1, outlets, options);
    assert.deepEqual(filtered.map((item) => item.guidStore), [T2]);

    assert.equal(
      countVisibleRetailOutletsForContext(managerContext(M1), M1, outlets, options),
      1,
    );

    const cardDto = toClientExtendedDto(
      {
        is_holding: false,
        guid_manager: M1,
        extended_format_version: "extended_v1",
        extended_source_sha256: "abc",
        extended_imported_at: null,
        extended_freshness_state: "current",
        extended_snapshot: {
          formatVersion: "extended_v1",
          sourceSha256: "abc",
          importedAt: "2026-01-01T10:00:00.000Z",
          isHolding: false,
          regionalManager: { guid: null, name: "", state: "not_provided" },
          hardwareManager: { guid: M1, name: "Hardware M1", state: "directory_unverified" },
          headOfSales: { guid: null, name: "", state: "not_provided" },
          currentRetailOutlets: outlets,
          retailOutletHistory: [],
          blocks: { clientExtendedReady: true, outletNormalizedReady: true },
        },
      },
      managerContext(M1),
    );
    assert.equal(cardDto!.retailOutlets.length, 1);
    assert.equal(cardDto!.retailOutlets[0]!.guidStore, T2);

    const sql = managerOutletRowAccessibleClause("$1", "ro", "onec_clients");
    assert.match(sql, /guid_manager/);
    assert.match(sql, /extended_snapshot->'hardwareManager'/);
    assert.ok(sql.includes("OR"), "SQL keeps sales and hardware inheritance as independent OR branches");
  });

  it("combined sales and hardware roles on same TT count once", () => {
    const filtered = filterRetailOutletsForContext(
      managerContext(M1),
      M1,
      [outlet({ guidStore: T1, managerGuid: M1, hardwareGuid: M1 })],
      { clientHardwareManagerGuid: M1 },
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.guidStore, T1);
  });

  it("buildClientScopeSql full read includes outlet-assigned clients for card access", () => {
    const scope = buildClientScopeSql(managerContext(M2));
    assert.match(scope.whereSql, /currentRetailOutlets/);
    assert.match(scope.whereSql, /hardwareManager/);
    assert.equal(scope.params[0], M2);
  });

  it("buildClientScopeSql direct client list excludes outlet-only parents", () => {
    const scope = buildClientScopeSql(managerContext(M2), { managerDirectClientList: true });
    assert.doesNotMatch(scope.whereSql, /currentRetailOutlets/);
    assert.match(scope.whereSql, /guid_manager/);
  });
});
