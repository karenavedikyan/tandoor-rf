import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("client-detail-v3 missing other keys", () => {
  it("renders expected keys with empty-from-1C when other_fields is {}", () => {
    const catalogSource = fs.readFileSync(
      path.join(process.cwd(), "public/client-detail-exchange-catalog.js"),
      "utf8",
    );
    const detailSource = fs.readFileSync(path.join(process.cwd(), "public/client-detail-v3.js"), "utf8");
    const window: Record<string, unknown> = {};
    vm.runInNewContext(catalogSource + "\n" + detailSource, { window, console, document: { createElement: () => ({}) } });
    const api = window.ClientDetailV3 as {
      renderOtherFieldsFromKeys: (
        shell: { escapeHtml: (v: string) => string },
        other: Record<string, unknown>,
        keys: string[],
      ) => string;
    };
    const shell = { escapeHtml: (v: string) => v };
    const notIngested = api.renderOtherFieldsFromKeys(shell, {}, ["Оптовик_КонтактноеЛицо"]);
    assert.match(notIngested, /Данные появятся после загрузки из 1С/);
    const empty1c = api.renderOtherFieldsFromKeys(
      shell,
      {},
      ["Оптовик_КонтактноеЛицо"],
      { other_fields_exchange_complete: true },
    );
    assert.match(empty1c, /Нет данных из 1С/);
  });
});
