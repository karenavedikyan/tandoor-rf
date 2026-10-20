import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);

type V3TabsModule = {
  visibleTabs: () => Array<[string, string, boolean]>;
  resolveCardTab: (tabId: string | null | undefined) => string;
  readInitialCardTab: () => string;
  renderTabsMarkup: (initialTab?: string) => string;
};

function loadV3Tabs(search = "") {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/clients/detail?" + search,
  });
  const { window } = dom;
  (globalThis as { window?: Window }).window = window as unknown as Window;
  (globalThis as { location?: Location }).location = window.location;
  delete require.cache[require.resolve("../../public/client-detail-exchange-catalog.js")];
  delete require.cache[require.resolve("../../public/client-detail-v3.js")];
  require("../../public/client-detail-exchange-catalog.js");
  return require("../../public/client-detail-v3.js") as V3TabsModule;
}

describe("client-detail-v3 visible tabs", () => {
  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { location?: Location }).location;
  });

  it("exposes prototype tab strip including sales for legal entity", () => {
    const v3 = loadV3Tabs();
    assert.deepEqual(
      v3.visibleTabs("legal").map((t) => t[0]),
      [
        "overview",
        "data",
        "sales",
        "work",
        "showcase",
        "orders",
        "finance",
        "documents",
        "claims",
        "plan",
      ],
    );
    assert.deepEqual(
      v3.visibleTabs("retail").map((t) => t[0]),
      ["overview", "data", "work", "showcase", "orders", "finance", "documents", "claims", "plan"],
    );
    const html = v3.renderTabsMarkup("overview", "legal");
    assert.match(html, /data-card-tab="overview"/);
    assert.match(html, /data-card-tab="orders"/);
    assert.match(html, /data-card-tab="work"/);
  });

  it("resolves disconnected section tabs for deep links", () => {
    const v3Orders = loadV3Tabs("cardTab=orders&returnUrl=%2Fclients");
    assert.equal(v3Orders.resolveCardTab("orders"), "orders");
    assert.equal(v3Orders.readInitialCardTab(), "orders");

    const v3Data = loadV3Tabs("cardTab=data");
    assert.equal(v3Data.readInitialCardTab(), "data");
  });
});
