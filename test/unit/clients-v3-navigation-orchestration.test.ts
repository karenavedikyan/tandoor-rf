import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type ClientsV3Api = {
  loadOrchestrated: (
    ctx: Record<string, unknown>,
    legacy: Record<string, unknown>,
    replace: boolean,
    hooks: Record<string, unknown>,
  ) => Promise<void>;
  readState: (search?: string) => Record<string, unknown>;
  loadList: (...args: unknown[]) => Promise<void>;
};

const testLogic = {
  isBranchPortfolioList: () => false,
  hasResponsibleSelection: (state: Record<string, unknown>) =>
    Boolean(
      state &&
        state.view === "teams" &&
        state.ropEmployee &&
        (state.manager || state.responsibleGuid),
    ),
  hasExplicitResponsibleNavigation: (state: Record<string, unknown>) =>
    Boolean(state && Object.prototype.hasOwnProperty.call(state, "responsibleGuid")),
  v3ResponsibleFromLegacyState: (state: Record<string, unknown>) => {
    const kind = state.responsibleKind === "regional" || state.responsibleKind === "hardware" ? state.responsibleKind : "manager";
    const guid =
      (kind === "manager" ? state.manager || state.responsibleGuid : state.responsibleGuid) || "";
    return {
      responsibleGuid: String(guid || ""),
      responsibleKind: guid ? kind : "",
      v3manager: kind === "manager" ? String(guid || "") : "",
    };
  },
  legacyStringField: (_legacy: Record<string, unknown>, _key: string, fallback: string) => fallback,
  mapLegacyEntityToV3Entity: (entity: string) => (entity === "outlets" ? "retail" : "legal"),
  isOrgCatalogEmployeePortfolio: (state: Record<string, unknown>) =>
    Boolean(
      state &&
        state.view === "teams" &&
        state.orgCatalogEntry === "employee_portfolio" &&
        state.responsibleGuid,
    ),
  isBranchPortfolioList: () => false,
  clearedTeamTerritoryFields: () => ({
    manager: "",
    responsibleGuid: "",
    responsibleKind: "",
    orgCatalogEntry: "",
  }),
};

function loadHarness(search: string): {
  window: Window;
  ClientsV3: ClientsV3Api;
  dom: JSDOM;
} {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <div id="results-state"></div>
      <div id="results-content" class="clients-hidden"></div>
      <div id="result-count"></div>
      <table><thead><tr id="clients-table-head-row"></tr></thead><tbody id="clients-table-body"></tbody></table>
      <div id="clients-cards"></div>
      <div id="pagination"></div>
      <div id="entity-switcher"></div>
      <div id="v3-filter-chips" class="clients-hidden"></div>
      <select id="v3-manager-filter"></select>
      <select id="v3-type-filter" multiple></select>
      <select id="v3-category-filter" multiple></select>
      <select id="v3-closed-filter"></select>
      <div id="v3-closed-filter-wrap"></div>
    </body></html>`,
    { url: "http://127.0.0.1/clients" + search },
  );
  const { window } = dom;
  (globalThis as { window?: Window }).window = window as unknown as Window;
  (globalThis as { document?: Document }).document = window.document;
  window.history.replaceState = (_state, _title, url) => {
    dom.reconfigure({ url: new URL(String(url), window.location.origin).href });
  };
  window.history.pushState = (_state, _title, url) => {
    dom.reconfigure({ url: new URL(String(url), window.location.origin).href });
  };
  (window as unknown as { module?: unknown; exports?: unknown }).module = undefined;
  (window as unknown as { exports?: unknown }).exports = undefined;
  (window as unknown as { TandoorRf?: unknown }).TandoorRf = {
    apiRequest: () =>
      Promise.resolve({
        response: { ok: true, status: 200 },
        data: { items: [{ guid: "g1", name: "Row" }], total: 1, managers: [], types: [], categories: [] },
      }),
    extractErrorMessage: () => "error",
  };
  (window as unknown as { ClientsShell?: unknown }).ClientsShell = {
    escapeHtml: (value: string) => value,
  };
  (window as unknown as { ClientsLogic: typeof testLogic }).ClientsLogic = testLogic;
  (globalThis as unknown as { ClientsLogic: typeof testLogic }).ClientsLogic = testLogic;
  const v3Path = path.join(process.cwd(), "public/clients-v3.js");
  window.eval(fs.readFileSync(v3Path, "utf8"));
  const g = window as unknown as Window & { ClientsV3?: ClientsV3Api };
  assert.ok(g.ClientsV3, "ClientsV3 must be available");
  return { window, ClientsV3: g.ClientsV3!, dom };
}

function baseCtx(window: Window) {
  return {
    api: (window as unknown as { TandoorRf: unknown }).TandoorRf,
    shell: (window as unknown as { ClientsShell: unknown }).ClientsShell,
    showResultsState: () => undefined,
    showResultsContent: () => undefined,
    showAccessDenied: () => undefined,
    resultCountEl: { textContent: "" },
    tableHeadRow: document.createElement("tr"),
    tableBody: document.createElement("tbody"),
    cardsEl: document.createElement("div"),
    paginationEl: document.createElement("div"),
    entitySwitcherEl: null,
    renderPagination: () => undefined,
  };
}

describe("clients v3 navigation orchestration guards", () => {
  it("drops stale teams-responsible flow after navigation to all with search", async () => {
    const { window, ClientsV3 } = loadHarness("?v3mode=1");
    let activeRequestId = 0;
    const teamsDeferred = deferred<{ ok: boolean }>();
    let loadListCalls = 0;
    const nativeLoadList = ClientsV3.loadList.bind(ClientsV3);
    ClientsV3.loadList = (...args: unknown[]) => {
      loadListCalls += 1;
      return nativeLoadList(...args);
    };

    const ctx = baseCtx(window);
    const hooksBase = {
      showAppShell: () => undefined,
      updateViewChrome: () => undefined,
      logic: testLogic,
      loadSource: "",
      getSearchQuery: () => "",
      unassignedPanelEl: null,
      navigateState: () => undefined,
      currentStateFromForm: () => ({ view: "all", entity: "clients" }),
      reloadFromV3Filters: () => undefined,
      loadTeamsContext: () => teamsDeferred.promise,
      renderTeamsPanel: () => Promise.resolve(),
    };

    activeRequestId += 1;
    const navA = activeRequestId;
    const runA = ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, { isNavigationCurrent: () => navA === activeRequestId }),
      {
        view: "teams",
        entity: "clients",
        ropEmployee: "rop-a",
        responsibleGuid: "mgr-a",
        responsibleKind: "manager",
        manager: "mgr-a",
      },
      true,
      Object.assign({}, hooksBase, {
        requestId: navA,
        isNavigationCurrent: () => navA === activeRequestId,
      }),
    );

    activeRequestId += 1;
    const navB = activeRequestId;
    const runB = ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, {
        isNavigationCurrent: () => navB === activeRequestId,
      }),
      { view: "all", entity: "clients", q: "latest", ropEmployee: "", manager: "", responsibleGuid: "" },
      true,
      Object.assign({}, hooksBase, {
        requestId: navB,
        isNavigationCurrent: () => navB === activeRequestId,
        getSearchQuery: () => "latest",
        loadTeamsContext: () => Promise.resolve({ ok: true }),
      }),
    );

    teamsDeferred.resolve({ ok: true });
    await runA;
    await runB;

    const state = ClientsV3.readState();
    assert.equal(state.v3view, "all");
    assert.equal(state.q, "latest");
    assert.equal(state.responsibleGuid, "");
    assert.equal(state.ropEmployee, "");
    assert.equal(loadListCalls, 1, "only navigation B may load the list");
  });

  it("teams A to teams B keeps B responsible in URL", async () => {
    const { window, ClientsV3 } = loadHarness("?v3mode=1");
    let activeRequestId = 0;
    const teamsDeferred = deferred<{ ok: boolean }>();
    const ctx = baseCtx(window);
    const hooksBase = {
      showAppShell: () => undefined,
      updateViewChrome: () => undefined,
      logic: testLogic,
      loadSource: "",
      getSearchQuery: () => "",
      unassignedPanelEl: null,
      navigateState: () => undefined,
      currentStateFromForm: () => ({}),
      reloadFromV3Filters: () => undefined,
      loadTeamsContext: () => teamsDeferred.promise,
      renderTeamsPanel: () => Promise.resolve(),
    };

    activeRequestId += 1;
    const navA = activeRequestId;
    const runA = ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, { isNavigationCurrent: () => navA === activeRequestId }),
      {
        view: "teams",
        entity: "clients",
        ropEmployee: "rop-a",
        responsibleGuid: "mgr-a",
        responsibleKind: "manager",
        manager: "mgr-a",
      },
      true,
      Object.assign({}, hooksBase, {
        requestId: navA,
        isNavigationCurrent: () => navA === activeRequestId,
      }),
    );

    activeRequestId += 1;
    const navB = activeRequestId;
    const runB = ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, { isNavigationCurrent: () => navB === activeRequestId }),
      {
        view: "teams",
        entity: "clients",
        ropEmployee: "rop-b",
        responsibleGuid: "mgr-b",
        responsibleKind: "manager",
        manager: "mgr-b",
      },
      true,
      Object.assign({}, hooksBase, {
        requestId: navB,
        isNavigationCurrent: () => navB === activeRequestId,
        loadTeamsContext: () => Promise.resolve({ ok: true }),
      }),
    );

    await runB;
    teamsDeferred.resolve({ ok: true });
    await runA;

    const state = ClientsV3.readState();
    const params = new URLSearchParams(window.location.search);
    assert.equal(state.ropEmployee, "rop-b");
    assert.equal(state.responsibleGuid, "mgr-b");
    assert.equal(params.get("responsibleGuid"), "mgr-b");
    assert.equal(params.get("ropEmployee"), "rop-b");
  });

  it("teams-home stale response does not start a list load", async () => {
    const { window, ClientsV3 } = loadHarness("?v3mode=1");
    let activeRequestId = 0;
    const teamsDeferred = deferred<{ ok: boolean }>();
    let loadListCalls = 0;
    ClientsV3.loadList = async () => {
      loadListCalls += 1;
    };
    const ctx = baseCtx(window);
    const hooks = {
      showAppShell: () => undefined,
      updateViewChrome: () => undefined,
      logic: testLogic,
      loadSource: "",
      getSearchQuery: () => "",
      unassignedPanelEl: null,
      navigateState: () => undefined,
      currentStateFromForm: () => ({}),
      reloadFromV3Filters: () => undefined,
      loadTeamsContext: () => teamsDeferred.promise,
      renderTeamsPanel: () => Promise.resolve(),
    };

    activeRequestId += 1;
    const navA = activeRequestId;
    const runA = ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, { isNavigationCurrent: () => navA === activeRequestId }),
      { view: "teams", entity: "clients", ropEmployee: "rop-a" },
      true,
      Object.assign({}, hooks, {
        requestId: navA,
        isNavigationCurrent: () => navA === activeRequestId,
      }),
    );

    activeRequestId += 1;
    const navB = activeRequestId;
    await ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, { isNavigationCurrent: () => navB === activeRequestId }),
      { view: "all", entity: "clients", q: "latest" },
      true,
      Object.assign({}, hooks, {
        requestId: navB,
        isNavigationCurrent: () => navB === activeRequestId,
        loadTeamsContext: () => Promise.resolve({ ok: true }),
      }),
    );

    teamsDeferred.resolve({ ok: true });
    await runA;
    assert.equal(loadListCalls, 1, "only the active all-view navigation loads the list");
  });

  it("stale teams error does not overwrite current UI state", async () => {
    const { window, ClientsV3 } = loadHarness("?v3mode=1");
    let activeRequestId = 0;
    const teamsDeferred = deferred<{ ok: boolean }>();
    let lastErrorTitle = "";
    const ctx = Object.assign(baseCtx(window), {
      showResultsState: (kind: string, title: string) => {
        if (kind === "error") {
          lastErrorTitle = title;
        }
      },
    });
    const hooks = {
      showAppShell: () => undefined,
      updateViewChrome: () => undefined,
      logic: testLogic,
      loadSource: "",
      getSearchQuery: () => "",
      unassignedPanelEl: null,
      navigateState: () => undefined,
      currentStateFromForm: () => ({}),
      reloadFromV3Filters: () => undefined,
      loadTeamsContext: () => teamsDeferred.promise,
      renderTeamsPanel: () => Promise.resolve(),
    };

    activeRequestId += 1;
    const navA = activeRequestId;
    const runA = ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, { isNavigationCurrent: () => navA === activeRequestId }),
      {
        view: "teams",
        entity: "clients",
        ropEmployee: "rop-a",
        responsibleGuid: "mgr-a",
        responsibleKind: "manager",
        manager: "mgr-a",
      },
      true,
      Object.assign({}, hooks, {
        requestId: navA,
        isNavigationCurrent: () => navA === activeRequestId,
      }),
    );

    activeRequestId += 1;
    const navB = activeRequestId;
    lastErrorTitle = "";
    await ClientsV3.loadOrchestrated(
      Object.assign({}, ctx, { isNavigationCurrent: () => navB === activeRequestId }),
      { view: "all", entity: "clients", q: "latest" },
      true,
      Object.assign({}, hooks, {
        requestId: navB,
        isNavigationCurrent: () => navB === activeRequestId,
        loadTeamsContext: () => Promise.resolve({ ok: true }),
      }),
    );

    teamsDeferred.resolve({ ok: false });
    await runA;
    assert.equal(lastErrorTitle, "");
  });

  it("catalog employee portfolio list uses employeePortfolioGuid query param", async () => {
    const { window, ClientsV3 } = loadHarness("?v3mode=1&v3entity=legal_grouped&v3view=teams");
    const listUrls: string[] = [];
    (window as unknown as { TandoorRf: { apiRequest: (url: string) => Promise<unknown> } }).TandoorRf.apiRequest = (
      url: string,
    ) => {
      if (String(url).includes("/api/clients/v3/list")) {
        listUrls.push(String(url));
      }
      return Promise.resolve({
        response: { ok: true, status: 200 },
        data: { items: [], total: 0, managers: [], types: [], categories: [] },
      });
    };
    const ctx = Object.assign(baseCtx(window), { logic: testLogic });
    await ClientsV3.loadList(ctx, {
      v3mode: true,
      v3entity: "legal_grouped",
      v3view: "teams",
      page: 1,
      orgCatalogEntry: "employee_portfolio",
      responsibleGuid: "44444444-4444-4444-8444-444444444444",
      responsibleKind: "manager",
      ropEmployee: "",
    }, true);
    assert.ok(listUrls.length >= 1);
    assert.match(listUrls[0], /employeePortfolioGuid=44444444-4444-4444-8444-444444444444/i);
    assert.doesNotMatch(listUrls[0], /responsibleKind=/);
  });
});
