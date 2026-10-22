import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

const logic = createRequire(import.meta.url)("../../public/clients-logic.js") as {
  readStateFromSearch: (search: string) => Record<string, unknown>;
};

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
  window.eval(fs.readFileSync(path.join(process.cwd(), "public/clients-v3-field-rules.js"), "utf8"));
  window.eval(fs.readFileSync(v3Path, "utf8"));
  const g = window as unknown as Window & { ClientsV3?: ClientsV3Api };
  assert.ok(g.ClientsV3);
  return g.ClientsV3!;
}

describe("clients v3 multiselect normalization", () => {
  it("preserves catalogue employee portfolio scope in card return query", () => {
    const v3 = loadClientsV3("?v3mode=1&v3entity=legal_grouped");
    const guid = "b2000000-0000-4000-8000-0000000000a1";
    const query = v3.buildListReturnQuery({
      v3entity: "legal_grouped",
      v3view: "teams",
      orgCatalogEntry: "employee_portfolio",
      responsibleGuid: guid,
      responsibleKind: "manager",
    });
    assert.equal(new URLSearchParams(query).get("orgCatalogEntry"), "employee_portfolio");
    assert.equal(logic.readStateFromSearch(query).orgCatalogEntry, "employee_portfolio");
    assert.equal(logic.readStateFromSearch(query).responsibleGuid, guid);
  });

  it("restores field rules on initial load and honors an explicit empty rule array", () => {
    const rules = [{ field: "lprName", op: "contains", value: "Ivan" }];
    const search = "?v3mode=1&v3entity=retail&filters=" + encodeURIComponent(JSON.stringify(rules));
    const v3 = loadClientsV3(search);
    const state = v3.legacyStateToV3(logic.readStateFromSearch(search), "url") as Record<string, unknown>;
    assert.deepEqual(state.v3Rules, rules);
    const cleared = v3.legacyStateToV3({ v3Rules: [] }, "") as Record<string, unknown>;
    assert.deepEqual(cleared.v3Rules, []);
  });
  it("restores the manager from a real parsed list URL without treating defaults as a clear", () => {
    const search = "?v3mode=1&v3entity=legal&view=all&v3manager=manager-one&v3dense=1";
    const v3 = loadClientsV3(search);
    const legacy = logic.readStateFromSearch(search);
    assert.equal(legacy.responsibleGuid, "");
    const state = v3.legacyStateToV3(legacy, "url") as Record<string, unknown>;
    assert.equal(state.v3manager, "manager-one");
    assert.ok(v3.buildListReturnQuery(state).includes("v3manager=manager-one"));
  });

  it("still honors an explicit user action clearing responsible navigation", () => {
    const v3 = loadClientsV3("?v3mode=1&v3entity=legal&view=all&v3manager=manager-one");
    const state = v3.legacyStateToV3(
      { view: "all", entity: "clients", responsibleGuid: "", responsibleKind: "" },
      "",
    ) as Record<string, unknown>;
    assert.equal(state.v3manager, "");
  });

  it("still honors an explicitly empty responsibleGuid in the URL", () => {
    const search = "?v3mode=1&v3entity=legal&view=all&v3manager=manager-one&responsibleGuid=";
    const v3 = loadClientsV3(search);
    const state = v3.legacyStateToV3(logic.readStateFromSearch(search), "url") as Record<string, unknown>;
    assert.equal(state.v3manager, "");
  });

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

  it("legacyStateToV3 keeps list chrome fields from URL on initial load", () => {
    const search =
      "?v3mode=1&v3entity=legal&view=all&v3dense=1&v3cols=name,rop_name&v3city=Moscow&colManager=Ivan";
    const v3 = loadClientsV3(search);
    const state = v3.legacyStateToV3({ view: "all", entity: "clients", page: 1 }, "url") as Record<
      string,
      unknown
    >;
    assert.equal(state.v3dense, true);
    assert.equal(state.v3cols, "name,rop_name");
    assert.equal(state.city, "Moscow");
    assert.equal(state.colManager, "Ivan");
    const returnQuery = v3.buildListReturnQuery(state);
    assert.ok(returnQuery.includes("v3dense=1"));
    assert.ok(returnQuery.includes("v3cols=name"));
  });

  it("preserves regional team scope when focus filter passes full state with empty v3manager", () => {
    const rop = "55555555-5555-4555-8555-555555555555";
    const team = "ab000000-0000-4000-8000-000000000001";
    const regional = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const top150 = "ee000000-0000-4000-8000-000000000150";
    const search =
      "?v3mode=1&v3entity=legal_grouped&view=teams&v3view=teams&v3focus=1&ropEmployee=" +
      rop +
      "&orgTeamGuid=" +
      team +
      "&responsibleGuid=" +
      regional +
      "&responsibleKind=regional&teamKind=regional";
    const v3 = loadClientsV3(search);
    const live = v3.readState();
    const patch = {
      ...live,
      v3Rules: [{ field: "typeGuid", op: "eq", value: top150 }],
      v3type: top150,
      v3types: [top150],
      page: 1,
    };
    const merged = v3.mergeListStateForUserAction(patch) as Record<string, unknown>;
    assert.equal(merged.responsibleGuid, regional);
    assert.equal(merged.responsibleKind, "regional");
    assert.equal(merged.v3manager, "");
  });

  it("prefers URL TOP filters over stale lktandoor multiselect when exiting focus", () => {
    const top150 = "ee000000-0000-4000-8000-000000000150";
    const top500 = "ee000000-0000-4000-8000-000000000500";
    const search =
      "?v3mode=1&v3entity=legal_grouped&view=teams&v3view=teams&v3focus=1&v3type=" +
      top150 +
      "&filters=" +
      encodeURIComponent(JSON.stringify([{ field: "typeGuid", op: "eq", value: top150 }]));
    const v3 = loadClientsV3(search);
    const select = document.createElement("select");
    select.id = "v3-type-filter";
    const stale = document.createElement("option");
    stale.value = top500;
    stale.selected = true;
    select.appendChild(stale);
    document.body.appendChild(select);
    const merged = v3.mergeListStateForUserAction({ v3focus: false }) as Record<string, unknown>;
    assert.deepEqual(merged.v3types, [top150]);
    assert.equal(merged.v3type, top150);
    const rules = merged.v3Rules as { field: string; value: string }[];
    assert.equal(rules.some((r) => r.field === "typeGuid" && r.value === top150), true);
  });

  it("keeps canonical empty TOP when reopening focus after reset (v3mode, stale DOM)", () => {
    const top500 = "ee000000-0000-4000-8000-000000000500";
    const search = "?v3mode=1&v3entity=legal_grouped&view=teams&v3view=teams&ropEmployee=rop-guid";
    const v3 = loadClientsV3(search);
    const select = document.createElement("select");
    select.id = "v3-type-filter";
    const stale = document.createElement("option");
    stale.value = top500;
    stale.selected = true;
    select.appendChild(stale);
    document.body.appendChild(select);
    const merged = v3.mergeListStateForUserAction({ v3focus: true }) as Record<string, unknown>;
    assert.deepEqual(merged.v3types, []);
    assert.equal(merged.v3type, "");
    const rules = merged.v3Rules as { field: string }[];
    assert.equal(rules.length, 0);
  });

  it("still clears manager team scope when patch only clears v3manager", () => {
    const rop = "55555555-5555-4555-8555-555555555555";
    const manager = "22222222-2222-4222-8222-222222222222";
    const search =
      "?v3mode=1&v3entity=legal_grouped&view=teams&v3view=teams&ropEmployee=" +
      rop +
      "&responsibleGuid=" +
      manager +
      "&responsibleKind=manager&teamKind=manager&v3manager=" +
      manager;
    const v3 = loadClientsV3(search);
    const merged = v3.mergeListStateForUserAction({ v3manager: "" }) as Record<string, unknown>;
    assert.equal(merged.responsibleGuid, "");
    assert.equal(merged.responsibleKind, "");
  });
});
