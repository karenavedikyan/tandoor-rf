import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);

function loadSalesModule() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/clients/detail?v3Entity=legal",
  });
  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  delete require.cache[require.resolve("../../public/client-detail-v3.js")];
  return require("../../public/client-detail-v3.js") as {
    renderSalesContent: (shell: { escapeHtml: (v: string) => string }, payload: unknown) => string;
  };
}

describe("client-detail-v3 sales rendering", () => {
  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
  });

  it("renders negative totals and empty state without demo numbers", () => {
    const mod = loadSalesModule();
    const shell = { escapeHtml: (v: string) => v };
    const html = mod.renderSalesContent(shell, {
      sales: {
        month: "2026-09",
        vatNote: "Суммы с НДС, ₽",
        incomeTotal: "-1000",
        quantityTotal: "2",
        grossProfitTotal: "-200",
        profitabilityPercent: "-20",
        lines: [
          {
            productType: "Фурнитура (ручки)",
            quantity: "2",
            income: "-1000",
            manualDiscount: "-5",
            automaticDiscount: "0",
            totalDiscount: "-5",
            costPrice: "800",
            grossProfit: "-200",
            profitability: "-20",
          },
        ],
      },
      months: ["2026-09"],
    });
    assert.match(html, /-1[\s\u00a0]?000/);
    assert.match(html, /data-testid="v3-sales-content"/);

    const emptyHtml = mod.renderSalesContent(shell, { sales: { lines: [] } });
    assert.match(emptyHtml, /v3-sales-empty/);
    assert.doesNotMatch(emptyHtml, /999/);
  });
});
