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
  delete require.cache[require.resolve("../../public/client-detail-v3.js")];
  return require("../../public/client-detail-v3.js") as V3TabsModule;
}

describe("client-detail-v3 visible tabs", () => {
  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { location?: Location }).location;
  });

  it("exposes only connected overview and data tabs in markup", () => {
    const v3 = loadV3Tabs();
    const ids = v3.visibleTabs().map((t) => t[0]);
    assert.deepEqual(ids, ["overview", "data"]);
    const html = v3.renderTabsMarkup("overview");
    assert.match(html, /data-card-tab="overview"/);
    assert.match(html, /data-card-tab="data"/);
    assert.doesNotMatch(html, /data-card-tab="orders"/);
    assert.doesNotMatch(html, /data-card-tab="work"/);
  });

  it("falls back legacy cardTab query params to overview", () => {
    const v3Orders = loadV3Tabs("cardTab=orders&returnUrl=%2Fclients");
    assert.equal(v3Orders.resolveCardTab("orders"), "overview");
    assert.equal(v3Orders.readInitialCardTab(), "overview");

    const v3Data = loadV3Tabs("cardTab=data");
    assert.equal(v3Data.readInitialCardTab(), "data");
  });
});
