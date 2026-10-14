import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

type ClientsV3Api = {
  legacyStateToV3: (
    legacy: Record<string, unknown>,
    loadSource: string,
  ) => {
    v3types: string[];
    v3categories: string[];
    v3type: string;
    v3category: string;
  };
  buildListReturnQuery: (state: Record<string, unknown>) => string;
  listFilterTokens: (state: Record<string, unknown>, multiKey: string, singleKey: string) => string[];
  appendTypeCategoryParams: (params: URLSearchParams, state: Record<string, unknown>) => void;
  readState: (search?: string) => Record<string, unknown>;
  mergeListStateForUserAction: (patch: Record<string, unknown>) => Record<string, unknown>;
};

function loadClientsV3(search: string): ClientsV3Api {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://127.0.0.1/clients" + search,
  });
  const { window } = dom;
  (globalThis as { window?: Window }).window = window as unknown as Window;
  (globalThis as { document?: Document }).document = window.document;
  window.history.replaceState = () => undefined;
  window.history.pushState = () => undefined;
  const logicPath = path.join(process.cwd(), "public/clients-logic.js");
  const v3Path = path.join(process.cwd(), "public/clients-v3.js");
  window.eval(fs.readFileSync(logicPath, "utf8"));
  window.eval(fs.readFileSync(v3Path, "utf8"));
  const g = window as unknown as Window & { ClientsV3?: ClientsV3Api };
  assert.ok(g.ClientsV3);
  return g.ClientsV3!;
}

describe("clients v3 multiselect normalization", () => {
  it("explicit empty arrays clear aliases without manual alias reset", () => {
    const v3 = loadClientsV3("?v3mode=1&v3entity=legal&v3type=t1&v3category=c1");
    const state = v3.legacyStateToV3({ v3types: [], v3categories: [] }, "");
    assert.deepEqual(state.v3types, []);
    assert.deepEqual(state.v3categories, []);
    assert.equal(state.v3type, "");
    assert.equal(state.v3category, "");
    const returnQuery = v3.buildListReturnQuery(state);
    assert.ok(!returnQuery.includes("v3type="));
    assert.ok(!returnQuery.includes("typeGuids="));
    assert.ok(!returnQuery.includes("v3category="));
    assert.ok(!returnQuery.includes("categoryGuids="));
    const apiParams = new URLSearchParams();
    v3.appendTypeCategoryParams(apiParams, state);
    assert.equal(apiParams.get("typeGuid"), null);
    assert.equal(apiParams.get("typeGuids"), null);
    assert.equal(apiParams.get("categoryGuid"), null);
    assert.equal(apiParams.get("categoryGuids"), null);
  });

  it("explicit empty arrays win over stale legacy single aliases", () => {
    const v3 = loadClientsV3("?v3mode=1&v3entity=legal&v3type=t1&v3category=c1");
    const state = v3.legacyStateToV3(
      { v3types: [], v3categories: [], v3type: "t1", v3category: "c1" },
      "",
    );
    assert.deepEqual(state.v3types, []);
    assert.equal(state.v3type, "");
    assert.equal(state.v3category, "");
    const apiParams = new URLSearchParams();
    v3.appendTypeCategoryParams(apiParams, state);
    assert.equal(apiParams.get("typeGuid"), null);
    assert.equal(apiParams.get("categoryGuid"), null);
  });

  it("falls back to legacy single when multiselect array property is absent", () => {
    const v3 = loadClientsV3("?v3mode=1&v3entity=legal");
    const state = v3.legacyStateToV3({ v3type: "t1", v3category: "c1" }, "url");
    assert.deepEqual(state.v3types, ["t1"]);
    assert.deepEqual(state.v3categories, ["c1"]);
    assert.equal(state.v3type, "t1");
    const returnQuery = v3.buildListReturnQuery(state);
    assert.ok(returnQuery.includes("v3type=t1"));
    assert.ok(returnQuery.includes("v3category=c1"));
    const apiParams = new URLSearchParams();
    v3.appendTypeCategoryParams(apiParams, state);
    assert.equal(apiParams.get("typeGuid"), "t1");
    assert.equal(apiParams.get("categoryGuid"), "c1");
  });

  it("legacy URL with only v3type remains compatible", () => {
    const v3 = loadClientsV3("?v3mode=1&v3entity=legal&v3type=t2");
    const urlState = v3.readState();
    assert.deepEqual(urlState.v3types, ["t2"]);
    const apiParams = new URLSearchParams();
    v3.appendTypeCategoryParams(apiParams, urlState);
    assert.equal(apiParams.get("typeGuid"), "t2");
  });

  it("listFilterTokens treats own-property empty array as final", () => {
    const v3 = loadClientsV3("?v3mode=1");
    const tokens = v3.listFilterTokens({ v3types: [], v3type: "t1" }, "v3types", "v3type");
    assert.deepEqual(tokens, []);
  });
});
