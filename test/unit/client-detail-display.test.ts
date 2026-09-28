import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const logic = require("../../public/clients-logic.js") as {
  formatLoadedInLkLabel: (label: string | null | undefined) => string;
  formatSyncStatusParts: (data: {
    runningImport?: boolean;
    lastSuccessfulImportAtLabel?: string | null;
    warning?: string | null;
  } | null) => { text: string; warning: boolean; appendWarning: string };
  parseReturnQuery: (search: string) => string;
  buildListQueryString: (state: {
    q: string;
    manager: string;
    holding: string;
    phone: string;
    page: number;
  }) => string;
};
const sections = require("../../public/client-detail-sections.js") as {
  renderAllSections: (returnQuery: string) => string;
  renderHeader: (
    client: {
      name: string;
      holding: { id: string; name: string } | null;
      manager: { name: string; shortId: string } | null;
    },
    returnQuery: string,
  ) => string;
  FUTURE_DATA_ITEMS: string[];
  PENDING_NOTICE: string;
};

describe("client detail display helpers (R1.4-prep)", () => {
  it("formats loaded-in-LK label and handles missing timestamp", () => {
    assert.equal(logic.formatLoadedInLkLabel("28.09.2026, 12:30"), "Загружено в ЛК: 28.09.2026, 12:30 (МСК)");
    assert.equal(logic.formatLoadedInLkLabel(""), "Сведения о загрузке отсутствуют");
    assert.equal(logic.formatLoadedInLkLabel(null), "Сведения о загрузке отсутствуют");
  });

  it("formats sync status without implying 1C file formation time", () => {
    assert.match(
      logic.formatSyncStatusParts({ lastSuccessfulImportAtLabel: "28.09.2026, 10:00" }).text,
      /Последний импорт в ЛК/,
    );
    assert.match(logic.formatSyncStatusParts({ runningImport: true }).text, /Импорт выполняется/);
    assert.match(logic.formatSyncStatusParts(null).text, /Не удалось проверить/);
  });

  it("preserves list filters in return query for card navigation", () => {
    const returnQuery = logic.parseReturnQuery(
      "?return=" + encodeURIComponent("?q=test&page=2&manager=abc"),
    );
    assert.equal(returnQuery, "?q=test&page=2&manager=abc");
    assert.match(sections.renderAllSections(returnQuery), /href="\/clients\?q=test/);
  });

  it("renders header with manager and no commercial placeholders", () => {
    const html = sections.renderHeader(
      {
        name: "Synthetic Client",
        holding: { id: "44444444-4444-4444-8444-444444444444", name: "Холдинг" },
        manager: { name: "Менеджер A", shortId: "22222222" },
      },
      "?return=%3Fq%3Dtest",
    );
    assert.match(html, /Менеджер из 1С/);
    assert.match(html, /Менеджер A/);
    assert.doesNotMatch(html, /Discount|Markups|DiscountAmount/i);
  });

  it("uses compact future-data block instead of fake commercial values", () => {
    const html = sections.renderAllSections("");
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    const { document } = dom.window;
    const future = document.querySelector('[data-testid="section-future-data"]');
    assert.ok(future);
    sections.FUTURE_DATA_ITEMS.forEach((item) => {
      assert.ok(future?.textContent?.includes(item));
    });
    assert.equal(document.querySelectorAll(".legacy-pending-block__notice").length, 1);
    assert.doesNotMatch(html, /Discount|Markups|0%/);
    assert.match(html, /Источник и обновление/);
    assert.match(html, /client-loaded-at/);
    assert.match(html, /Время формирования файла в 1С неизвестно/);
  });
});
