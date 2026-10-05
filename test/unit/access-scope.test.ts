import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { combineScopeAndFilter } from "../../src/access/combine-filters";
import { buildClientScopeSql } from "../../src/access/scope-sql";
import type { AccessContext } from "../../src/access/types";
import { buildClientsFilter } from "../../src/clients/query";

function ctx(partial: Partial<AccessContext> & Pick<AccessContext, "userId" | "role">): AccessContext {
  return {
    employeeId: null,
    employeeLinkConflict: false,
    hasEmployeeLink: false,
    hasScopedClientAccess: true,
    fullClientBase: false,
    status: "active",
    explicitlyDeniedAll: false,
    ...partial,
  };
}

describe("access scope SQL", () => {
  it("returns denial-aware scope for admin full base", () => {
    const adminScope = buildClientScopeSql(
      ctx({
        userId: "00000000-0000-4000-8000-000000000001",
        role: "admin",
        fullClientBase: true,
        hasScopedClientAccess: true,
      }),
    );
    assert.match(adminScope.whereSql, /access_denials/);
  });

  it("denies manager without employee link", () => {
    const scope = buildClientScopeSql(
      ctx({
        userId: "00000000-0000-4000-8000-000000000002",
        role: "manager",
        hasScopedClientAccess: false,
        hasEmployeeLink: false,
      }),
    );
    assert.equal(scope.whereSql, "WHERE FALSE");
  });

  it("combines scope with user filters without expanding access", () => {
    const scope = buildClientScopeSql(
      ctx({
        userId: "00000000-0000-4000-8000-000000000003",
        role: "manager",
        employeeId: "22222222-2222-4222-8222-222222222222",
        hasEmployeeLink: true,
      }),
    );
    const filter = buildClientsFilter({
      entity: "clients",
      view: "all",
      q: "",
      managerId: "55555555-5555-4555-8555-555555555555",
      phone: "all",
      hasOutlets: "all",
      sortBy: "name",
      sortDir: "asc",
      page: 1,
      pageSize: 20,
    });
    const combined = combineScopeAndFilter(scope, filter);
    assert.match(combined.whereSql, /guid_manager = \$3::uuid/);
    assert.equal(combined.params.length, 3);
  });
});
