import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientScopeSql } from "../../src/access/scope-sql";
import type { AccessContext } from "../../src/access/types";
import { filterRetailOutletsForContext } from "../../src/clients/outlet-access";
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
    contacts: {},
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
