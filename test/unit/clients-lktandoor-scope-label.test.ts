import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("clients-lktandoor scope label resolution", () => {
  function loadListModule() {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients-lktandoor-list.js"), "utf8");
    const window: Record<string, unknown> = {};
    vm.runInNewContext(source, { window, console });
    return window.ClientsLktandoorList as {
      scopeTitle: (
        state: { responsibleGuid?: string; ropEmployee?: string; orgCatalogEntry?: string },
        ctx: { rolePresentation?: { businessRole?: string }; teamContext?: Record<string, unknown> },
      ) => string;
      resolveManagerDisplayName: (
        state: { responsibleGuid?: string },
        ctx: { teamContext?: { managers?: { employeeGuid: string; name: string }[]; managerName?: string } },
      ) => string;
      syncTerritoryDisplayContext: (
        state: { responsibleGuid?: string },
        ctx: { teamContext?: { managers?: { employeeGuid: string; name: string }[]; managerName?: string } },
      ) => void;
    };
  }

  const M2 = "33333333-3333-4333-8333-333333333333";

  it("restores catalogue employee identity after reload without managerName memory", () => {
    const mod = loadListModule();
    const ctx = {
      rolePresentation: { businessRole: "admin" },
      teamContext: {
        managerName: "",
        managers: [],
        rops: [{ employeeGuid: M2, name: "Сотрудник из файла", catalogEntryKind: "employee" }],
      },
    };
    assert.equal(
      mod.scopeTitle({ responsibleGuid: M2, orgCatalogEntry: "employee_portfolio" }, ctx),
      "Территория: Сотрудник из файла",
    );
  });

  it("scopeTitle uses managers roster when managerName memory is empty", () => {
    const mod = loadListModule();
    const ctx = {
      rolePresentation: { businessRole: "admin" },
      teamContext: {
        managerName: "",
        managers: [{ employeeGuid: M2, name: "Аветисян Армен Владимирович" }],
      },
    };
    const title = mod.scopeTitle({ responsibleGuid: M2, ropEmployee: "rop-1" }, ctx);
    assert.equal(title, "Территория: Аветисян Армен Владимирович");
  });

  it("syncTerritoryDisplayContext restores teamContext.managerName from roster", () => {
    const mod = loadListModule();
    const ctx = {
      teamContext: {
        managerName: "",
        managers: [{ employeeGuid: M2, name: "Manager Two" }],
      },
    };
    mod.syncTerritoryDisplayContext({ responsibleGuid: M2 }, ctx);
    assert.equal(ctx.teamContext.managerName, "Manager Two");
    assert.equal(mod.resolveManagerDisplayName({ responsibleGuid: M2 }, ctx), "Manager Two");
  });

  it("admin territory without responsibleGuid stays Вся база", () => {
    const mod = loadListModule();
    const title = mod.scopeTitle(
      { responsibleGuid: "", ropEmployee: "rop-1" },
      { rolePresentation: { businessRole: "admin" }, teamContext: { managers: [] } },
    );
    assert.equal(title, "Вся база");
  });
});
