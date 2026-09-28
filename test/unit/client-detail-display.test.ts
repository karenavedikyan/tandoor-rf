import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const logic = require("../../public/clients-logic.js") as {
  formatLoadedInLkLabel: (label: string | null | undefined) => string;
  SOURCE_UPDATED_UNKNOWN: string;
  formatSyncStatusParts: (data: {
    runningImport?: boolean;
    lastSuccessfulImportAtLabel?: string | null;
    warning?: string | null;
  } | null) => { text: string; warning: boolean; appendWarning: string };
  parseReturnQuery: (search: string) => string;
};
const sections = require("../../public/client-detail-sections.js") as {
  renderAllSections: (returnQuery: string) => string;
  renderHeader: (
    client: { name: string },
    returnQuery: string,
  ) => string;
  FUTURE_DATA_ITEMS: string[];
  PENDING_NOTICE: string;
};

describe("client detail display helpers (R1.4-prep)", () => {
  it("formats loaded-in-LK value without duplicate label prefix", () => {
    assert.equal(logic.formatLoadedInLkLabel("28.09.2026, 12:30"), "28.09.2026, 12:30 (МСК)");
    assert.equal(logic.formatLoadedInLkLabel(""), "Сведения о загрузке отсутствуют");
  });

  it("uses fixed text for unknown 1C update time", () => {
    assert.equal(logic.SOURCE_UPDATED_UNKNOWN, "Время обновления в 1С не передано");
  });

  it("preserves list filters in return query for card navigation", () => {
    const returnQuery = logic.parseReturnQuery(
      "?return=" + encodeURIComponent("?q=test&page=2&manager=abc"),
    );
    assert.equal(returnQuery, "?q=test&page=2&manager=abc");
    assert.match(sections.renderAllSections(returnQuery), /href="\/clients\?q=test/);
  });

  it("avoids technical field names and UUIDs in main sections", () => {
    const html = sections.renderAllSections("");
    assert.match(html, /Клиент/);
    assert.match(html, /Холдинг/);
    assert.match(html, /Менеджер из 1С/);
    assert.match(html, /Источник и обновление/);
    assert.match(html, /client-source-updated/);
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    const main = dom.window.document.querySelector('[data-testid="section-main"]');
    const contacts = dom.window.document.querySelector('[data-testid="section-contacts"]');
    const source = dom.window.document.querySelector('[data-testid="section-source"]');
    const tech = dom.window.document.querySelector('[data-testid="section-tech"]');
    assert.ok(main);
    assert.ok(contacts);
    assert.ok(source);
    assert.ok(tech);
    const employeeHtml = [main, contacts, source].map((node) => node?.innerHTML ?? "").join("\n");
    assert.doesNotMatch(employeeHtml, /snapshot|guid_client|Холдинг на строке|Наименование в обмене/i);
    assert.doesNotMatch(employeeHtml, /guid_|22222222/i);
    assert.match(tech?.textContent ?? "", /guid_client/);
  });

  it("uses compact future-data block without commercial values", () => {
    const html = sections.renderAllSections("");
    assert.doesNotMatch(html, /Discount|Markups|0%/i);
    assert.equal(html.match(/legacy-pending-block__notice/g)?.length, 1);
  });
});
