import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const logic = require("../../public/clients-logic.js") as {
  readStateFromSearch: (search: string) => {
    q: string;
    manager: string;
    holding: string;
    phone: string;
    page: number;
  };
  buildListQueryString: (state: {
    q: string;
    manager: string;
    holding: string;
    phone: string;
    page: number;
  }) => string;
  parseReturnQuery: (search: string) => string;
  shouldAcceptListResponse: (requestId: number, activeRequestId: number) => boolean;
  filterOptions: (
    items: Array<{ id: string; name: string; shortId: string }>,
    query: string,
  ) => Array<{ id: string; name: string; shortId: string }>;
  createComboboxModel: () => { selectedId: string; searchText: string };
  comboboxOnInput: (
    model: { selectedId: string; searchText: string },
    value: string,
  ) => { selectedId: string; searchText: string };
  comboboxApplyFromUrl: (
    model: { selectedId: string; searchText: string },
    selectedId: string,
    options: Array<{ id: string; name: string; shortId: string }>,
  ) => { selectedId: string; searchText: string };
  comboboxSelect: (
    model: { selectedId: string; searchText: string },
    selectedId: string,
    options: Array<{ id: string; name: string; shortId: string }>,
  ) => { selectedId: string; searchText: string };
  comboboxOnBlur: (
    model: { selectedId: string; searchText: string },
    options: Array<{ id: string; name: string; shortId: string }>,
  ) => { selectedId: string; searchText: string };
  formatLoadedInLkLabel: (label: string | null | undefined) => string;
  formatSyncStatusParts: (data: {
    runningImport?: boolean;
    lastSuccessfulImportAtLabel?: string | null;
    warning?: string | null;
  } | null) => { text: string; warning: boolean; appendWarning: string };
};

describe("clients frontend logic", () => {
  it("reads and writes list state from URL search", () => {
    const state = logic.readStateFromSearch("?q=%D0%B0%D0%BB%D1%8C%D1%84%D0%B0&page=2&phone=yes");
    assert.equal(state.q, "альфа");
    assert.equal(state.page, 2);
    assert.equal(state.phone, "yes");
    assert.match(logic.buildListQueryString(state), /q=%D0%B0%D0%BB%D1%8C%D1%84%D0%B0/);
  });

  it("accepts only safe internal return queries", () => {
    assert.equal(logic.parseReturnQuery("?return=%3Fq%3Dtest"), "?q=test");
    assert.equal(logic.parseReturnQuery("?return=https%3A%2F%2Fevil.test"), "");
    assert.equal(logic.parseReturnQuery("?return=%3Fevil%3D1"), "");
  });

  it("invalidates stale list responses", () => {
    assert.equal(logic.shouldAcceptListResponse(1, 2), false);
    assert.equal(logic.shouldAcceptListResponse(2, 2), true);
  });

  it("filters manager and holding options locally", () => {
    const items = [
      { id: "a", name: "Иванов", shortId: "11111111" },
      { id: "b", name: "Петров", shortId: "22222222" },
    ];
    assert.equal(logic.filterOptions(items, "петр").length, 1);
    assert.equal(logic.filterOptions(items, "22222222").length, 1);
  });

  it("shows pending apply when verified FTP differs from LK snapshot", () => {
    const formatted = logic.formatSyncStatusParts({
      freshnessState: "pending_apply",
      lastSuccessfulImportAtLabel: "20.09.2026, 09:00",
      warning: "На FTP обнаружен новый файл, но он ещё не применён в ЛК.",
    });
    assert.match(formatted.text, /ожидается согласованное обновление/);
    assert.equal(formatted.warning, true);
  });

  it("labels sync status as LK import, not 1C file time", () => {
    const formatted = logic.formatSyncStatusParts({
      freshnessState: "current",
      lastSuccessfulImportAtLabel: "28.09.2026, 09:00",
    });
    assert.match(formatted.text, /Данные загружены в ЛК/);
    assert.doesNotMatch(formatted.text, /Обновлено в 1С|загрузка из 1С|FTP/i);
  });

  it("keeps applied UUID while editing draft search text", () => {
    const options = [{ id: "a", name: "Менеджер A", shortId: "11111111" }];
    const model = logic.createComboboxModel();
    logic.comboboxSelect(model, "a", options);
    logic.comboboxOnInput(model, "Черновик B");
    assert.equal(model.searchText, "Черновик B");
    assert.equal(model.selectedId, "a");
    logic.comboboxOnBlur(model, options);
    assert.match(model.searchText, /Менеджер A/);
    assert.equal(model.selectedId, "a");
  });
});
