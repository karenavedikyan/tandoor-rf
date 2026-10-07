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

function outlet(guidStore: string, managerGuid: string | null, state = "directory_unverified"): ParsedRetailOutlet {
  return {
    ordinal: 0,
    guidStore,
    holdingName: "TT",
    warehouse: false,
    address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
    loading: {},
    managers: {
      manager: managerGuid
        ? { guid: managerGuid, name: "Manager", state: state as "directory_unverified" }
        : { guid: null, name: "", state: "unassigned" },
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
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
      [outlet(T1, M1), outlet(T2, M2)],
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
      [outlet(T1, M1), outlet(T2, M2)],
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
      [outlet(T1, M1), outlet(T2, M2), outlet("66666666-6666-4666-8666-666666666666", null, "unassigned")],
    );
    assert.deepEqual(
      filtered.map((item) => item.guidStore?.toLowerCase()),
      [T1.toLowerCase(), "66666666-6666-4666-8666-666666666666"],
    );
  });

  it("buildClientScopeSql includes outlet-assigned clients for M2", () => {
    const scope = buildClientScopeSql(managerContext(M2));
    assert.match(scope.whereSql, /currentRetailOutlets/);
    assert.match(scope.whereSql, /guid_manager/);
    assert.equal(scope.params[0], M2);
  });
});
