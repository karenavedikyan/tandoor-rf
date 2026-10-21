import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("clients-v3-list TOP column", () => {
  const shell = { escapeHtml: (v: string) => v };
  const listUi = (() => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients-v3-list.js"), "utf8");
    const window: Record<string, unknown> = {};
    vm.runInNewContext(source, { window, console });
    return window.ClientsV3List as {
      cellDisplay: (
        item: Record<string, unknown>,
        colId: string,
        shell: { escapeHtml: (v: string) => string },
      ) => string;
    };
  })();

  it("holding row uses holding TOP, never child legal type_name", () => {
    const html = listUi.cellDisplay(
      {
        detail_entity: "holding",
        category_name: "ТОП 150",
        top_name: "ТОП 150",
        type_name: "ТОП 350",
      },
      "category_name",
      shell,
    );
    assert.match(html, /ТОП 150/);
    assert.doesNotMatch(html, /ТОП 350/);
  });

  it("holding row with empty holding TOP does not fall back to child type_name", () => {
    const html = listUi.cellDisplay(
      {
        detail_entity: "holding",
        category_name: null,
        top_name: null,
        type_name: "ТОП 350",
      },
      "category_name",
      shell,
    );
    assert.match(html, /Нет данных/);
    assert.doesNotMatch(html, /ТОП 350/);
  });

  it("standalone legal row shows its own TOP from category_name / top_name", () => {
    const html = listUi.cellDisplay(
      {
        detail_entity: "legal",
        category_name: "ТОП 200",
        top_name: "ТОП 200",
        type_name: "А",
      },
      "category_name",
      shell,
    );
    assert.match(html, /ТОП 200/);
    assert.doesNotMatch(html, /^А$/);
  });
});
