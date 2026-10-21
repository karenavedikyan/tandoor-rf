import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupedTopTypeExpressions } from "../../src/clients/v3/list-legal-grouped";
import type { AccessContext } from "../../src/access/types";

function adminContext(): AccessContext {
  return {
    role: "admin",
    userId: 1,
    fullClientBase: true,
    employeeId: null,
    employeeLinkConflict: false,
    deniedClientGuids: new Set(),
    deniedEmployeeGuids: new Set(),
  } as AccessContext;
}

describe("groupedTopTypeExpressions", () => {
  it("uses holding nameType for holding groups, not member aggregation", () => {
    const params: unknown[] = [];
    const top = groupedTopTypeExpressions(adminContext(), "le", params);
    assert.match(top.guid, /onec_v3_holdings _v3top/);
    assert.match(top.guid, /guidType/);
    assert.match(top.name, /nameType/);
  });
});
