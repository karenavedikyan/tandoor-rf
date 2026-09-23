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

const MANAGER_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_GUID = "11111111-1111-4111-8111-111111111111";
const managerOptions = [{ id: MANAGER_ID, name: "Тест Менеджер", shortId: "22222222" }];

function comboboxMarkup(): string {
  return `
    <div id="manager-combobox">
      <input id="manager-filter-input" type="search" aria-controls="manager-filter-list" />
      <input type="hidden" id="manager-filter" value="" />
      <ul id="manager-filter-list" class="clients-hidden"></ul>
    </div>
  `;
}

function mountTestCombobox(onApplySelection: (selectedId: string) => void) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${comboboxMarkup()}</body></html>`);
  const { document } = dom.window;
  const input = document.getElementById("manager-filter-input") as HTMLInputElement;
  const hidden = document.getElementById("manager-filter") as HTMLInputElement;
  const listEl = document.getElementById("manager-filter-list") as HTMLElement;
  const root = document.getElementById("manager-combobox") as HTMLElement;

  const mounted = logic.mountCombobox({
    model: logic.createComboboxModel(),
    input,
    hidden,
    listEl,
    root,
    listboxId: "manager-filter-list",
    allLabel: "Все менеджеры",
    options: () => managerOptions,
    onApplySelection,
  });

  return { dom, document, input, hidden, listEl, mounted };
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

    input.focus();
    input.value = "Тест";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const option = listEl.querySelector('[data-value="' + MANAGER_ID + '"]') as HTMLElement;
    assert.ok(option);
    option.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));

    assert.equal(applied, MANAGER_ID);
    assert.equal(hidden.value, MANAGER_ID);
    assert.match(input.value, /Тест Менеджер/);
  });

  it("selects option with ArrowDown and Enter", () => {
    let applied = "";
    const { dom, input, hidden } = mountTestCombobox(function (selectedId) {
      applied = selectedId;
    });

    input.focus();
    input.value = "Тест";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    assert.equal(applied, MANAGER_ID);
    assert.equal(hidden.value, MANAGER_ID);
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
