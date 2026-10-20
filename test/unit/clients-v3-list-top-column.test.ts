import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("clients-v3-list TOP column", () => {
  it("shows type_name as TOP when category_name is empty", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients-v3-list.js"), "utf8");
    const window: Record<string, unknown> = {};
    vm.runInNewContext(source, { window, console });
    const listUi = window.ClientsV3List as {
      cellDisplay: (
        item: Record<string, unknown>,
        colId: string,
        shell: { escapeHtml: (v: string) => string },
      ) => string;
    };
    const shell = { escapeHtml: (v: string) => v };
    const html = listUi.cellDisplay(
      { type_name: "TOP350", category_name: "", name: "SYNTH Legal" },
      "category_name",
      shell,
    );
    assert.match(html, /TOP350/);
  });
});
