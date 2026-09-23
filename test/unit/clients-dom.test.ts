import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const logic = require("../../public/clients-logic.js") as {
  mountCombobox: (config: {
    model: { selectedId: string; searchText: string; activeIndex: number; open: boolean };
    input: HTMLInputElement;
    hidden: HTMLInputElement;
    listEl: HTMLElement;
    root: HTMLElement;
    listboxId: string;
    allLabel: string;
    options: () => Array<{ id: string; name: string; shortId: string }>;
    onApplySelection: (selectedId: string) => void;
  }) => {
    model: { selectedId: string; searchText: string; activeIndex: number; open: boolean };
    syncFromUrl: (selectedId: string) => void;
    reset: () => void;
  };
  createComboboxModel: () => { selectedId: string; searchText: string; activeIndex: number; open: boolean };
  createDetailController: (deps: Record<string, unknown>) => {
    bootstrap: () => Promise<void>;
    ensureAccessAndLoad: () => Promise<void>;
    loadClient: () => Promise<void>;
    getPageGuid: () => string | null;
  };
};

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const HOLDING_H = "44444444-4444-4444-8444-444444444444";
const CLIENT_GUID = "11111111-1111-4111-8111-111111111111";
const managerOptions = [
  { id: MANAGER_A, name: "Менеджер A", shortId: "22222222" },
  { id: "55555555-5555-4555-8555-555555555555", name: "Менеджер B", shortId: "55555555" },
];
const holdingOptions = [{ id: HOLDING_H, name: "Холдинг H", shortId: "44444444" }];

function comboboxMarkup(): string {
  return `
    <div id="manager-combobox">
      <input id="manager-filter-input" type="search" aria-controls="manager-filter-list" />
      <input type="hidden" id="manager-filter" value="" />
      <ul id="manager-filter-list" class="clients-hidden"></ul>
    </div>
  `;
}

function mountTestCombobox(
  onApplySelection: (selectedId: string) => void,
  config: {
    idPrefix?: string;
    allLabel?: string;
    options?: () => Array<{ id: string; name: string; shortId: string }>;
  } = {},
) {
  const idPrefix = config.idPrefix ?? "manager";
  const markup = `
    <div id="${idPrefix}-combobox">
      <input id="${idPrefix}-filter-input" type="search" aria-controls="${idPrefix}-filter-list" />
      <input type="hidden" id="${idPrefix}-filter" value="" />
      <ul id="${idPrefix}-filter-list" class="clients-hidden"></ul>
    </div>
  `;
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${markup}</body></html>`);
  const { document } = dom.window;
  const input = document.getElementById(`${idPrefix}-filter-input`) as HTMLInputElement;
  const hidden = document.getElementById(`${idPrefix}-filter`) as HTMLInputElement;
  const listEl = document.getElementById(`${idPrefix}-filter-list`) as HTMLElement;
  const root = document.getElementById(`${idPrefix}-combobox`) as HTMLElement;

  const mounted = logic.mountCombobox({
    model: logic.createComboboxModel(),
    input,
    hidden,
    listEl,
    root,
    listboxId: `${idPrefix}-filter-list`,
    allLabel: config.allLabel ?? "Все менеджеры",
    options: config.options ?? (() => managerOptions),
    onApplySelection,
  });

  return { dom, document, input, hidden, listEl, mounted, root };
}

function selectComboboxOption(
  dom: JSDOM,
  input: HTMLInputElement,
  listEl: HTMLElement,
  optionId: string,
) {
  input.focus();
  input.dispatchEvent(new dom.window.Event("focus", { bubbles: true }));
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const option = listEl.querySelector(`[data-value="${optionId}"]`) as HTMLElement;
  assert.ok(option, `option ${optionId} should exist`);
  option.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
}

describe("clients combobox DOM", () => {
  it("keeps search text after debounced list sync while typing", async () => {
    const { dom, input, hidden, mounted } = mountTestCombobox(() => {});

    input.focus();
    input.value = "Тест";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    assert.equal(input.value, "Тест");
    assert.equal(hidden.value, "");

    mounted.syncFromUrl("");
    await new Promise((resolve) => setTimeout(resolve, 350));

    assert.equal(input.value, "Тест");
    assert.equal(hidden.value, "");
  });

  it("applies UUID on mouse selection and updates visible label", () => {
    let applied = "";
    const { dom, input, hidden, listEl } = mountTestCombobox(function (selectedId) {
      applied = selectedId;
    });

    selectComboboxOption(dom, input, listEl, MANAGER_A);

    assert.equal(applied, MANAGER_A);
    assert.equal(hidden.value, MANAGER_A);
    assert.match(input.value, /Менеджер A/);
  });

  it("selects option with ArrowDown and Enter", () => {
    let applied = "";
    const { dom, input, hidden } = mountTestCombobox(function (selectedId) {
      applied = selectedId;
    });

    input.focus();
    input.value = "Менедж";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    assert.equal(applied, MANAGER_A);
    assert.equal(hidden.value, MANAGER_A);
  });

  it("restores applied manager after draft text cancelled with Escape", () => {
    const { dom, input, hidden, listEl } = mountTestCombobox(() => {});

    selectComboboxOption(dom, input, listEl, MANAGER_A);
    assert.equal(hidden.value, MANAGER_A);

    input.value = "Черновик B";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.equal(hidden.value, MANAGER_A);

    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    assert.equal(hidden.value, MANAGER_A);
    assert.match(input.value, /Менеджер A/);
  });

  it("restores applied manager after draft cancelled with Tab", () => {
    const { dom, input, hidden, listEl } = mountTestCombobox(() => {});

    selectComboboxOption(dom, input, listEl, MANAGER_A);
    input.value = "Черновик B";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    assert.equal(hidden.value, MANAGER_A);
    assert.match(input.value, /Менеджер A/);
  });

  it("restores applied manager after click outside without selection", () => {
    const { dom, document, input, hidden, listEl, root } = mountTestCombobox(() => {});

    selectComboboxOption(dom, input, listEl, MANAGER_A);
    input.value = "Черновик B";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    assert.equal(hidden.value, MANAGER_A);
    assert.match(input.value, /Менеджер A/);
  });

  it("keeps manager filter when selecting holding afterwards", () => {
    const query = { manager: "", holding: "" };
    const manager = mountTestCombobox((selectedId) => {
      query.manager = selectedId;
    });
    const holding = mountTestCombobox(
      (selectedId) => {
        query.holding = selectedId;
      },
      {
        idPrefix: "holding",
        allLabel: "Все холдинги",
        options: () => holdingOptions,
      },
    );

    selectComboboxOption(manager.dom, manager.input, manager.listEl, MANAGER_A);
    assert.equal(query.manager, MANAGER_A);
    assert.equal(manager.hidden.value, MANAGER_A);

    manager.input.value = "Черновик B";
    manager.input.dispatchEvent(new manager.dom.window.Event("input", { bubbles: true }));
    manager.input.dispatchEvent(
      new manager.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    selectComboboxOption(holding.dom, holding.input, holding.listEl, HOLDING_H);

    assert.equal(query.manager, MANAGER_A);
    assert.equal(manager.hidden.value, MANAGER_A);
    assert.equal(query.holding, HOLDING_H);
    assert.equal(holding.hidden.value, HOLDING_H);
  });

  it("clears filter when choosing «Все менеджеры»", () => {
    let applied: string | null = "pending";
    const { dom, input, hidden, listEl } = mountTestCombobox(function (selectedId) {
      applied = selectedId;
    });

    input.focus();
    input.dispatchEvent(new dom.window.Event("focus", { bubbles: true }));
    const allOption = listEl.querySelector('[data-value=""]') as HTMLElement;
    allOption.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));

    assert.equal(applied, "");
    assert.equal(hidden.value, "");
    assert.equal(input.value, "");
  });
});

describe("client detail boot DOM flow", () => {
  const unhandled: unknown[] = [];
  const originalListeners = process.listeners("unhandledRejection");

  beforeEach(() => {
    unhandled.length = 0;
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason) => {
      unhandled.push(reason);
    });
  });

  afterEach(() => {
    process.removeAllListeners("unhandledRejection");
    for (const listener of originalListeners) {
      process.on("unhandledRejection", listener as NodeJS.UnhandledRejectionListener);
    }
  });

  it("retries auth failure then loads client card", async () => {
    let authCalls = 0;
    let clientCalls = 0;
    let lastTitle = "";
    const controller = logic.createDetailController({
      parseGuidFromPath: () => CLIENT_GUID,
      ensureAdminAccess: (callback: (user: unknown, reason: string | null) => void) => {
        authCalls += 1;
        if (authCalls === 1) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        callback({ role: "admin" }, null);
        return Promise.resolve();
      },
      showInvalidGuid: () => {
        throw new Error("should not show invalid guid");
      },
      showLoading: () => {
        lastTitle = "loading";
      },
      fetchClient: () => {
        clientCalls += 1;
        return Promise.resolve({
          response: { status: 200 },
          data: { client: { name: "Synthetic Alpha", guid: CLIENT_GUID } },
        });
      },
      handleClientResult: (result: { data: { client: { name: string } } }) => {
        lastTitle = result.data.client.name;
      },
      showClientError: () => {
        throw new Error("client error should not happen");
      },
      showInitError: (_err: unknown, onRetry: () => Promise<void>) => {
        lastTitle = "init-error";
        return onRetry();
      },
      handleAccessReason: () => {
        throw new Error("access reason should not happen");
      },
    });

    await controller.bootstrap();

    assert.equal(authCalls, 2);
    assert.equal(clientCalls, 1);
    assert.equal(lastTitle, "Synthetic Alpha");
    assert.equal(unhandled.length, 0);
  });

  it("keeps retry button flow through repeated client network failures", async () => {
    let clientCalls = 0;
    let retryCount = 0;
    let lastErrorShown = false;
    const controller = logic.createDetailController({
      parseGuidFromPath: () => CLIENT_GUID,
      ensureAdminAccess: (callback: (user: unknown, reason: string | null) => void) => {
        callback({ role: "admin" }, null);
        return Promise.resolve();
      },
      showInvalidGuid: () => undefined,
      showLoading: () => undefined,
      fetchClient: () => {
        clientCalls += 1;
        if (clientCalls < 3) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve({
          response: { status: 200 },
          data: { client: { name: "Synthetic Beta", guid: CLIENT_GUID } },
        });
      },
      handleClientResult: (result: { data: { client: { name: string } } }) => {
        lastErrorShown = false;
        assert.equal(result.data.client.name, "Synthetic Beta");
      },
      showClientError: (_err: unknown, onRetry: () => Promise<void>) => {
        lastErrorShown = true;
        retryCount += 1;
        return onRetry();
      },
      showInitError: () => undefined,
      handleAccessReason: () => undefined,
    });

    await controller.bootstrap();
    assert.equal(clientCalls, 3);
    assert.equal(retryCount, 2);
    assert.equal(lastErrorShown, false);
    assert.equal(unhandled.length, 0);
  });
});
