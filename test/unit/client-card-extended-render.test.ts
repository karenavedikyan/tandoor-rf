import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
(globalThis as { window?: Window }).window = dom.window as unknown as Window;
(dom.window as unknown as { ClientDetailSections: { escapeHtml: (v: string) => string } }).ClientDetailSections = {
  escapeHtml: (value: string) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;"),
};
const prototype = require("../../public/client-card-prototype.js") as {
  render: (client: Record<string, unknown>) => string;
  managerLabel: (ref: { assignmentLabel?: string }) => string;
  loadingDaysLabel: (loading: { days: Array<{ value: boolean | null; label: string }>; loadingTime: string | null }) => string;
};

describe("client card extended render", () => {
  it("shows outlet identity label and separate client/outlet managers", () => {
    const html = prototype.render({
      guid: "11111111-1111-4111-8111-111111111111",
      name: "Client Alpha",
      manager: { name: "Client Manager" },
      holding: { name: "Holding" },
      address: "HQ",
      phones: [],
      extended: {
        formatVersion: "extended_v1",
        isHolding: true,
        holdingCardLabel: "Карточка холдинга",
        managers: {
          regionalManager: { assignmentLabel: "Regional One" },
          hardwareManager: { assignmentLabel: "Не назначен" },
          headOfSales: { assignmentLabel: "Не назначен" },
        },
        retailOutlets: [
          {
            ordinal: 0,
            holdingName: "Holding",
            identityLabel: "Точка из выгрузки 1С. Идентификатор ещё не передан",
            closureStatusLabel: "Статус не передан",
            warehouseLabel: "Используется как склад",
            warehouse: true,
            addresses: {
              storeAddress: "Store street",
              deliveryAddress: "Delivery street",
              routeDirection: "North",
            },
            loading: {
              days: [
                { key: "mon", label: "Пн", value: true },
                { key: "tue", label: "Вт", value: false },
              ],
              loadingTime: "09:00",
              loadingEndTime: null,
            },
            managers: {
              manager: { assignmentLabel: "Не назначен" },
              regionalManager: { assignmentLabel: "Outlet Regional" },
              hardwareManager: { assignmentLabel: "Не назначен" },
              headOfSales: { assignmentLabel: "Не назначен" },
            },
            contacts: {
              storePhone: "+7 495 000-00-00",
              accountantPhone: "",
              accountantEmail: "",
            },
            distributionAllowed: false,
            presentInCurrentSnapshot: true,
            staleLabel: null,
          },
        ],
        dataQualityLabel: "Частично подключено",
        sensitiveFieldsWithheld: true,
        outletNormalizedReady: false,
      },
    });

    assert.match(html, /Идентификатор ещё не передан/);
    assert.match(html, /Статус не передан/);
    assert.match(html, /Не назначен/);
    assert.match(html, /Outlet Regional/);
    assert.match(html, /Regional One/);
    assert.doesNotMatch(html, /loadingEndTime|окончание приёмки/i);

    const page = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    assert.ok(page.window.document.querySelector('[data-testid="pc-outlet-0"]'));
  });

  it("formats loading days without end time", () => {
    const label = prototype.loadingDaysLabel({
      days: [
        { value: true, label: "Пн" },
        { value: true, label: "Ср" },
      ],
      loadingTime: "10:00",
    });
    assert.match(label, /Пн, Ср/);
    assert.match(label, /10:00/);
    assert.doesNotMatch(label, /оконч/i);
  });
});
