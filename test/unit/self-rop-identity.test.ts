import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessContext } from "../../src/access/types";
import { selfRopEmployeeGuidFromContext } from "../../src/clients/self-rop-identity";
import { resolveRolePresentation } from "../../src/clients/role-presentation";

const ROP = "55555555-5555-4555-8555-555555555555";

function ropContext(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    userId: "00000000-0000-4000-8000-000000000099",
    role: "rop",
    status: "active",
    employeeId: ROP,
    hasEmployeeLink: true,
    employeeLinkConflict: false,
    hasScopedClientAccess: true,
    explicitlyDeniedAll: false,
    fullClientBase: false,
    ...overrides,
  } as AccessContext;
}

describe("self ROP employee identity", () => {
  it("returns confirmed employeeId for linked ROP only", () => {
    assert.equal(selfRopEmployeeGuidFromContext(ropContext()), ROP);
    assert.equal(selfRopEmployeeGuidFromContext(ropContext({ hasEmployeeLink: false })), null);
    assert.equal(selfRopEmployeeGuidFromContext(ropContext({ employeeLinkConflict: true })), null);
    assert.equal(selfRopEmployeeGuidFromContext(ropContext({ role: "manager" })), null);
  });

  it("exposes selfRopEmployeeGuid on role presentation for ROP", () => {
    const presentation = resolveRolePresentation(ropContext());
    assert.ok(presentation);
    assert.equal(presentation!.selfRopEmployeeGuid, ROP);
  });
});
