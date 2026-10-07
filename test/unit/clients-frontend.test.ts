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
  resolveVisibleColumns: (input: {
    entity: string;
    view: string;
    cols?: string;
    storageKey?: string;
  }) => string[];
  defaultVisibleColumnIds: (entity: string, view: string) => string[];
  nextSortState: (
    currentSortBy: string,
    currentSortDir: string,
    columnId: string,
  ) => { sortBy: string; sortDir: string };
  sanitizeStateForEntity: (state: Record<string, unknown>) => Record<string, unknown>;
  normalizeStateForEntitySwitch: (
    state: {
      entity: string;
      sortBy?: string;
      sortDir?: string;
      cols?: string;
      page?: number;
      discountProgram?: string;
      discountAmountMin?: string;
      filled?: string;
      empty?: string;
      bonusTandoorClub?: string;
      outletStatus?: string;
      warehouse?: string;
      regionalManager?: string;
      tandoorClub?: string;
    },
    previousEntity: string,
  ) => {
    entity: string;
    sortBy: string;
    sortDir: string;
    cols: string;
    page: number;
    outletStatus?: string;
    warehouse?: string;
    regionalManager?: string;
    tandoorClub?: string;
  };
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

  it("resolves visible columns from URL and storage defaults", () => {
    const resolved = logic.resolveVisibleColumns({
      entity: "clients",
      view: "all",
      cols: "name,holding,outletsCount",
      storageKey: "test-columns",
    });
    assert.deepEqual(resolved, ["name", "holding", "outletsCount"]);
    const defaults = logic.defaultVisibleColumnIds("clients", "all");
    assert.ok(defaults.indexOf("name") !== -1);
    assert.ok(defaults.indexOf("holding") !== -1);
  });

  it("cycles sort state for sortable columns", () => {
    assert.deepEqual(logic.nextSortState("name", "asc", "holding"), {
      sortBy: "holding",
      sortDir: "asc",
    });
    assert.deepEqual(logic.nextSortState("holding", "asc", "holding"), {
      sortBy: "holding",
      sortDir: "desc",
    });
  });

  it("normalizes incompatible sort when switching list entity", () => {
    const fromClients = logic.normalizeStateForEntitySwitch(
      {
        entity: "outlets",
        sortBy: "name",
        sortDir: "desc",
        cols: "name,holding",
        page: 3,
      },
      "clients",
    );
    assert.equal(fromClients.sortBy, "clientName");
    assert.equal(fromClients.sortDir, "desc");
    assert.equal(fromClients.cols, "");
    assert.equal(fromClients.page, 1);

    const fromClientsCommercial = logic.normalizeStateForEntitySwitch(
      {
        entity: "outlets",
        sortBy: "clientName",
        sortDir: "asc",
        page: 2,
        discountProgram: "PROMO",
        discountAmountMin: "0",
        discountAmountMax: "10",
        markupName: "Base",
        markupPercentage: "5",
        filled: "discountProgram",
        empty: "markups",
        bonusTandoorClub: "0",
      },
      "clients",
    );
    assert.equal(fromClientsCommercial.discountProgram, "");
    assert.equal(fromClientsCommercial.discountAmountMin, "");
    assert.equal(fromClientsCommercial.discountAmountMax, "");
    assert.equal(fromClientsCommercial.markupName, "");
    assert.equal(fromClientsCommercial.markupPercentage, "");
    assert.equal(fromClientsCommercial.filled, "");
    assert.equal(fromClientsCommercial.empty, "");
    assert.equal(fromClientsCommercial.bonusTandoorClub, "0");
  });

  it("sanitizes unsupported outlet URL params on read", () => {
    const state = logic.readStateFromSearch(
      "?entity=outlets&discountProgram=PROMO&discountAmountMin=0&markupName=Base&filled=discountProgram&empty=markups,bonusTandoorClub&bonusTandoorClub=0",
    );
    assert.equal(state.entity, "outlets");
    assert.equal(state.discountProgram, "");
    assert.equal(state.discountAmountMin, "");
    assert.equal(state.markupName, "");
    assert.equal(state.filled, "");
    assert.equal(state.empty, "bonusTandoorClub");
    assert.equal(state.bonusTandoorClub, "0");
  });

  it("labels sync status as LK import, not 1C file time", () => {
    const formatted = logic.formatSyncStatusParts({
      freshnessState: "current",
      lastSuccessfulImportAtLabel: "28.09.2026, 09:00",
    });
    assert.match(formatted.text, /Данные загружены в ЛК/);
    assert.doesNotMatch(formatted.text, /Обновлено в 1С|загрузка из 1С|FTP/i);
  });

  it("shows unknown 1C formation date separately from LK load time", () => {
    const formatted = logic.formatSyncStatusParts({
      freshnessState: "current",
      lastSuccessfulImportAtLabel: "28.09.2026, 09:00",
      sourceFormationKnown: false,
    });
    assert.match(formatted.text, /Данные загружены в ЛК/);
    assert.match(formatted.text, /Дата формирования выгрузки 1С неизвестна/);
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
