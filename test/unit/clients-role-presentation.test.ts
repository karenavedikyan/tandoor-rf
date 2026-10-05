import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessContext } from "../../src/access/types";
import {
  canUseReviewNavigation,
  canUseUnassignedNavigation,
  resolveRolePresentation,
  validateClientsListQuery,
} from "../../src/clients/role-presentation";

function context(partial: Partial<AccessContext> & Pick<AccessContext, "role">): AccessContext {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    role: partial.role,
    status: partial.status ?? "active",
    employeeId: partial.employeeId ?? "22222222-2222-4222-8222-222222222222",
    hasEmployeeLink: partial.hasEmployeeLink ?? true,
    employeeLinkConflict: partial.employeeLinkConflict ?? false,
    hasScopedClientAccess: partial.hasScopedClientAccess ?? true,
    explicitlyDeniedAll: partial.explicitlyDeniedAll ?? false,
    fullClientBase: partial.fullClientBase ?? false,
  };
}

describe("clients role presentation", () => {
  it("maps manager defaults to clients-only list", () => {
    const presentation = resolveRolePresentation(context({ role: "manager" }));
    assert.ok(presentation);
    assert.equal(presentation.pageTitle, "Мои клиенты");
    assert.equal(presentation.defaultView, "all");
    assert.equal(presentation.defaultEntity, "clients");
    assert.equal(presentation.showViewSwitcher, false);
    assert.deepEqual(presentation.allowedViews, ["all"]);
    assert.deepEqual(presentation.allowedEntities, ["clients"]);
  });

  it("maps regional manager defaults to outlets list", () => {
    const presentation = resolveRolePresentation(context({ role: "regional_manager" }));
    assert.ok(presentation);
    assert.equal(presentation.pageTitle, "Мои торговые точки");
    assert.equal(presentation.defaultEntity, "outlets");
    assert.deepEqual(presentation.allowedEntities, ["outlets", "clients"]);
  });

  it("maps ROP defaults to teams view", () => {
    const presentation = resolveRolePresentation(context({ role: "rop" }));
    assert.ok(presentation);
    assert.equal(presentation.pageTitle, "Клиенты моей команды");
    assert.equal(presentation.defaultView, "teams");
    assert.equal(presentation.showTeamNavigation, true);
  });

  it("allows director review navigation read-only", () => {
    const director = context({ role: "director", fullClientBase: true });
    assert.equal(canUseReviewNavigation(director), true);
    assert.equal(canUseUnassignedNavigation(director), true);
    const presentation = resolveRolePresentation(director);
    assert.ok(presentation);
    assert.equal(presentation.reviewReadOnly, true);
    assert.equal(presentation.pageTitle, "Вся клиентская база");
  });

  it("rejects disallowed list modes per role", () => {
    const manager = context({ role: "manager" });
    assert.match(
      validateClientsListQuery(manager, { view: "teams", entity: "clients" }) ?? "",
      /недоступен/i,
    );
    assert.match(
      validateClientsListQuery(manager, { view: "review", entity: "clients" }) ?? "",
      /недоступен/i,
    );
    assert.equal(validateClientsListQuery(manager, { view: "all", entity: "clients" }), null);
    assert.match(
      validateClientsListQuery(manager, { view: "all", entity: "outlets" }) ?? "",
      /недоступен/i,
    );
  });
});
