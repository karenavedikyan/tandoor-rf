import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const logic = require("../../public/clients-logic.js") as {
  resolveAddressPresentation: (raw: string | null | undefined) => {
    displayText: string;
    copyValue: string | null;
    copyEnabled: boolean;
  };
  createAddressCopyController: (deps: {
    getCopyButton: () => HTMLButtonElement | null;
    getStatusElement: () => HTMLElement | null;
    getCopyValue: () => string | null;
    copyText: (value: string) => Promise<void>;
  }) => { bind: () => void };
};

describe("client detail address copy (R1.4-prep)", () => {
  it("shows placeholder and disables copy for empty and whitespace-only addresses", () => {
    for (const raw of [null, undefined, "", "   ", "\n\t"]) {
      const resolved = logic.resolveAddressPresentation(raw as string | null | undefined);
      assert.equal(resolved.displayText, "Адрес не указан");
      assert.equal(resolved.copyValue, null);
      assert.equal(resolved.copyEnabled, false);
    }
  });

  it("copies original address value while trimming display text", () => {
    const resolved = logic.resolveAddressPresentation("  Москва, ул. Пример 1  ");
    assert.equal(resolved.displayText, "Москва, ул. Пример 1");
    assert.equal(resolved.copyValue, "  Москва, ул. Пример 1  ");
    assert.equal(resolved.copyEnabled, true);
  });

  it("hides copy button and skips clipboard for empty address", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <button id="copy-address" type="button">Копировать адрес</button>
        <p id="copy-address-status"></p>
      </body></html>`,
    );
    const { document } = dom.window;
    const button = document.getElementById("copy-address") as HTMLButtonElement;
    const status = document.getElementById("copy-address-status") as HTMLElement;
    let copyCalls = 0;

    logic.createAddressCopyController({
      getCopyButton: () => button,
      getStatusElement: () => status,
      getCopyValue: () => null,
      copyText: () => {
        copyCalls += 1;
        return Promise.resolve();
      },
    }).bind();

    assert.equal(button.hidden, true);
    assert.equal(button.disabled, true);
    button.click();
    assert.equal(copyCalls, 0);
    assert.equal(status.textContent, "");
  });

  it("copies raw value and shows success for a normal address", async () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <button id="copy-address" type="button">Копировать адрес</button>
        <p id="copy-address-status"></p>
      </body></html>`,
    );
    const { document } = dom.window;
    const button = document.getElementById("copy-address") as HTMLButtonElement;
    const status = document.getElementById("copy-address-status") as HTMLElement;
    let copied = "";

    logic.createAddressCopyController({
      getCopyButton: () => button,
      getStatusElement: () => status,
      getCopyValue: () => "  Москва  ",
      copyText: (value: string) => {
        copied = value;
        return Promise.resolve();
      },
    }).bind();

    assert.equal(button.hidden, false);
    button.click();
    await Promise.resolve();
    assert.equal(copied, "  Москва  ");
    assert.equal(status.textContent, "Адрес скопирован");
    assert.match(status.className, /success/);
  });

  it("shows error message when clipboard fails without false success", async () => {
    const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <button id="copy-address" type="button">Копировать адрес</button>
        <p id="copy-address-status"></p>
      </body></html>`,
    );
    const { document } = dom.window;
    const button = document.getElementById("copy-address") as HTMLButtonElement;
    const status = document.getElementById("copy-address-status") as HTMLElement;

    logic.createAddressCopyController({
      getCopyButton: () => button,
      getStatusElement: () => status,
      getCopyValue: () => "Казань",
      copyText: () => Promise.reject(new Error("denied")),
    }).bind();

    button.click();
    await flushPromises();
    await flushPromises();
    assert.equal(status.textContent, "Не удалось скопировать адрес");
    assert.match(status.className, /error/);
    assert.notEqual(status.textContent, "Адрес скопирован");
  });
});
