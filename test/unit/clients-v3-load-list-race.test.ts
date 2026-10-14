import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

type PendingRequest = {
  resolve: (value: unknown) => void;
  url: string;
};

type ClientsV3TestApi = {
  loadList: (ctx: Record<string, unknown>, state: Record<string, unknown>, replaceHistory?: boolean) => Promise<void>;
  resetListLoadGenerationForTests: () => void;
  readState: (search?: string) => Record<string, unknown>;
};

function loadClientsV3Harness(search: string, apiRequest: (url: string) => Promise<unknown>): ClientsV3TestApi {
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
  window.history.replaceState = () => undefined;
  window.history.pushState = () => undefined;
  (window as unknown as { TandoorRf?: unknown }).TandoorRf = {
    apiRequest: apiRequest,
    extractErrorMessage: () => "error",
  };
  (window as unknown as { ClientsShell?: unknown }).ClientsShell = {
    escapeHtml: (value: string) => value,
  };
  const logicPath = path.join(process.cwd(), "public/clients-logic.js");
  const v3Path = path.join(process.cwd(), "public/clients-v3.js");
  window.eval(fs.readFileSync(logicPath, "utf8"));
  window.eval(fs.readFileSync(v3Path, "utf8"));
  const g = window as unknown as Window & { ClientsV3?: ClientsV3TestApi };
  assert.ok(g.ClientsV3);
  return g.ClientsV3!;
}

function mockOptions(types: Array<{ guid: string; name: string; count: number }>) {
  return {
    response: { ok: true, status: 200 },
    data: { managers: [], types, categories: [] },
  };
}

function mockList(total = 1) {
  return {
    response: { ok: true, status: 200 },
    data: {
      total,
      items: [{ guid: "g1", name: "Item One" }],
    },
  };
}

function readTypeSelection(window: Window): string[] {
  const el = window.document.getElementById("v3-type-filter") as HTMLSelectElement | null;
  if (!el) {
    return [];
  }
  return Array.from(el.selectedOptions).map((o) => o.value);
}

function readTypeChips(window: Window): string[] {
  return Array.from(window.document.querySelectorAll(".clients-v3-filter-chip")).map((el) => el.textContent || "");
}

describe("clients v3 loadList stale response guards", () => {
  it("ignores delayed options from an older load after a newer load cleared filters", async () => {
    const pending: { options?: PendingRequest; list?: PendingRequest } = {};
    const apiRequest = (url: string) => {
      if (url.includes("/options")) {
        return new Promise((resolve) => {
          pending.options = { resolve, url };
        });
      }
      if (url.includes("/list")) {
        return new Promise((resolve) => {
          pending.list = { resolve, url };
        });
      }
      throw new Error("unexpected url " + url);
    };
    const v3 = loadClientsV3Harness("?v3mode=1&v3entity=legal", apiRequest);
    v3.resetListLoadGenerationForTests();
    const ctx = {
      api: (globalThis as { window: Window }).window.TandoorRf,
      shell: (globalThis as { window: Window }).window.ClientsShell,
      rolePresentation: { businessRole: "admin", allowedV3Entities: ["legal"] },
      showResultsState: () => undefined,
      showResultsContent: () => undefined,
      showAccessDenied: () => undefined,
      resultCountEl: document.getElementById("result-count"),
      tableHeadRow: document.getElementById("clients-table-head-row"),
      tableBody: document.getElementById("clients-table-body"),
      cardsEl: document.getElementById("clients-cards"),
      paginationEl: document.getElementById("pagination"),
      entitySwitcherEl: document.getElementById("entity-switcher"),
      renderPagination: () => undefined,
    };

    const win = (globalThis as { window: Window }).window;
    const loadA = v3.loadList(ctx, { v3entity: "legal", page: 1, v3types: ["t2"], v3type: "t2" }, true);
    const optionsA = pending.options;
    const listA = pending.list;
    assert.ok(optionsA && listA);
    listA.resolve(mockList());
    await Promise.resolve();

    const loadB = v3.loadList(
      ctx,
      { v3entity: "legal", page: 1, v3types: [], v3categories: [], v3type: "", v3category: "" },
      true,
    );
    const optionsB = pending.options;
    const listB = pending.list;
    assert.ok(optionsB && listB);
    optionsB.resolve(mockOptions([]));
    listB.resolve(mockList());
    await loadB;

    assert.deepEqual(readTypeSelection(win), []);
    assert.deepEqual(v3.readState().v3types, []);
    assert.equal(readTypeChips(win).length, 0);

    optionsA.resolve(mockOptions([{ guid: "t2", name: "Type 2", count: 3 }]));
    await loadA;

    assert.deepEqual(readTypeSelection(win), []);
    assert.deepEqual(v3.readState().v3types, []);
    assert.equal(readTypeChips(win).length, 0);
  });

  it("ignores delayed list UI from an older load after entity switch", async () => {
    const queues: Array<{ kind: "options" | "list"; resolve: (value: unknown) => void }> = [];
    const apiRequest = (url: string) =>
      new Promise((resolve) => {
        queues.push({
          kind: url.includes("/options") ? "options" : "list",
          resolve,
        });
      });
    const v3 = loadClientsV3Harness("?v3mode=1&v3entity=legal", apiRequest);
    v3.resetListLoadGenerationForTests();
    const resultCounts: string[] = [];
    const ctx = {
      api: (globalThis as { window: Window }).window.TandoorRf,
      shell: (globalThis as { window: Window }).window.ClientsShell,
      rolePresentation: { businessRole: "admin", allowedV3Entities: ["legal", "retail"] },
      showResultsState: () => undefined,
      showResultsContent: () => {
        document.getElementById("results-content")?.classList.remove("clients-hidden");
      },
      showAccessDenied: () => undefined,
      resultCountEl: {
        set textContent(value: string) {
          resultCounts.push(value);
        },
        get textContent() {
          return resultCounts[resultCounts.length - 1] || "";
        },
      },
      tableHeadRow: document.getElementById("clients-table-head-row"),
      tableBody: document.getElementById("clients-table-body"),
      cardsEl: document.getElementById("clients-cards"),
      paginationEl: document.getElementById("pagination"),
      entitySwitcherEl: document.getElementById("entity-switcher"),
      renderPagination: () => undefined,
      formatResultCount: (_state: Record<string, unknown>, total: number) => {
        resultCounts.push(String(total));
      },
    };

    const loadA = v3.loadList(ctx, { v3entity: "legal", page: 1, q: "alpha" }, true);
    const aOptions = queues.shift()!;
    const aList = queues.shift()!;
    aOptions.resolve(mockOptions([]));
    const staleList = {
      response: { ok: true, status: 200 },
      data: { total: 99, items: [{ guid: "stale", name: "Stale Legal" }] },
    };
    aList.resolve(staleList);

    const loadB = v3.loadList(ctx, { v3entity: "retail", page: 1, q: "" }, true);
    const bOptions = queues.shift()!;
    const bList = queues.shift()!;
    bOptions.resolve(mockOptions([]));
    bList.resolve({
      response: { ok: true, status: 200 },
      data: { total: 2, items: [{ guid: "r1", name: "Retail One" }] },
    });
    await loadB;

    assert.ok(resultCounts.includes("2"));
    assert.ok(!document.getElementById("clients-table-body")!.innerHTML.includes("Stale Legal"));

    await loadA;
    assert.ok(!document.getElementById("clients-table-body")!.innerHTML.includes("Stale Legal"));
    assert.ok(document.getElementById("clients-table-body")!.innerHTML.includes("Retail One"));
  });
});
