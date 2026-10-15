import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("clients-v3-list UI helpers", () => {
  function loadListUi() {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients-v3-list.js"), "utf8");
    const window: Record<string, unknown> = {};
    vm.runInNewContext(source, { window, document: { getElementById: () => null } });
    return window.ClientsV3List as {
      resolveVisibleColumns: (state: { v3entity: string; v3cols?: string }, userId: string) => string[];
      catalogForEntity: (entity: string) => Array<{ id: string; required?: boolean }>;
      applyDensity: (dense: boolean) => void;
      columnsParamFromIds: (ids: string[]) => string;
    };
  }

  it("defaults legal columns with required name", () => {
    const ui = loadListUi();
    const ids = ui.resolveVisibleColumns({ v3entity: "legal" }, "user-1");
    assert.ok(ids.includes("name"));
    assert.ok(ids.includes("manager_name"));
    assert.ok(ids.includes("rop_name"));
    assert.equal(ids[0], "name");
  });

  it("persists column selection via v3cols param", () => {
    const ui = loadListUi();
    const ids = ui.resolveVisibleColumns(
      { v3entity: "legal", v3cols: "name,city,rop_name" },
      "user-1",
    );
    assert.equal(ids.join(","), "name,city,rop_name");
  });

  it("retail catalog includes closed status column", () => {
    const ui = loadListUi();
    const catalog = ui.catalogForEntity("retail");
    assert.ok(catalog.some((c) => c.id === "closed"));
  });
});
