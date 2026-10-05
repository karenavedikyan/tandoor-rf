import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterRetailOutletsForContext } from "../../src/clients/outlet-access";
import type { ParsedRetailOutlet } from "../../src/onec-clients/extended-types";
import type { AccessContext } from "../../src/access/types";

const ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";

const context: AccessContext = {
  userId: "user",
  role: "rop",
  status: "active",
  employeeId: ROP_A,
  employeeLinkConflict: false,
  hasEmployeeLink: true,
  hasScopedClientAccess: true,
  fullClientBase: false,
  explicitlyDeniedAll: false,
};

function outlet(guidStore: string, ropGuid: string): ParsedRetailOutlet {
  return {
    ordinal: 0,
    guidStore,
    holdingName: "TT",
    warehouse: false,
    address: { storeAddress: "A", deliveryAddress: "", routeDirection: "" },
    loading: {},
    managers: {
      manager: { guid: null, name: "", state: "unassigned" },
      regionalManager: { guid: null, name: "", state: "not_provided" },
      hardwareManager: { guid: null, name: "", state: "not_provided" },
      headOfSales: { guid: ropGuid, name: "ROP", state: "directory_unverified" },
    },
    contacts: {},
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    distributionAllowed: false,
  } as ParsedRetailOutlet;
}

describe("ROP outlet card filter", () => {
  it("returns outlet assigned to ROP on outlet-only parent", () => {
    const filtered = filterRetailOutletsForContext(
      context,
      "77777777-7777-4777-8777-777777777701",
      [outlet("cccccccc-cccc-4ccc-8ccc-cccccccccccc", ROP_A)],
      {
        clientHeadOfSalesGuid: null,
        ropTeamEmployeeGuids: new Set([ROP_A]),
      },
    );
    assert.equal(filtered.length, 1);
  });
});
