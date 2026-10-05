import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientsOrderBy, parseSortBy, parseSortDirection } from "../../src/clients/sort";

describe("clients sort", () => {
  it("parses sort direction with default asc", () => {
    assert.equal(parseSortDirection(undefined), "asc");
    assert.equal(parseSortDirection("desc"), "desc");
    assert.equal(parseSortDirection("sideways"), null);
  });

  it("builds client and outlet order clauses", () => {
    const countExpr = "(SELECT COUNT(*)::int FROM onec_retail_outlets WHERE guid_client = onec_clients.guid_client)";
    const clientOrder = buildClientsOrderBy(
      {
        entity: "clients",
        view: "all",
        q: "",
        phone: "all",
        hasOutlets: "all",
        outletStatus: "all",
        warehouseFilter: "all",
        sortBy: "holding",
        sortDir: "desc",
        page: 1,
        pageSize: 50,
      },
      { includeTeamSort: false, outletsCountExpr: countExpr },
    );
    assert.match(clientOrder, /name_holding DESC/i);

    const addressExpr = "(SELECT NULLIF(BTRIM(outlet->'address'->>'storeAddress'), '') FROM jsonb_array_elements('[]'::jsonb) outlet LIMIT 1)";
    const outletOrder = buildClientsOrderBy(
      {
        entity: "outlets",
        view: "all",
        q: "",
        phone: "all",
        hasOutlets: "all",
        outletStatus: "all",
        warehouseFilter: "all",
        sortBy: "status",
        sortDir: "asc",
        page: 1,
        pageSize: 50,
      },
      { includeTeamSort: false, outletStoreAddressExpr: addressExpr },
    );
    assert.match(outletOrder, /is_closed ASC/i);
    assert.doesNotMatch(outletOrder, /store_address/i);
  });

  it("sorts outletsCount and address using provided expressions, not aliases", () => {
    const countExpr = "(SELECT COUNT(*)::int FROM onec_retail_outlets o WHERE o.guid_client = onec_clients.guid_client)";
    const outletsCountOrder = buildClientsOrderBy(
      {
        entity: "clients",
        view: "all",
        q: "",
        phone: "all",
        hasOutlets: "all",
        outletStatus: "all",
        warehouseFilter: "all",
        sortBy: "outletsCount",
        sortDir: "asc",
        page: 1,
        pageSize: 50,
      },
      { includeTeamSort: false, outletsCountExpr: countExpr },
    );
    assert.match(outletsCountOrder, new RegExp(countExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(outletsCountOrder, /outlets_count/i);

    const addressExpr = "(SELECT 'addr' FROM onec_clients oc LIMIT 1)";
    const addressOrder = buildClientsOrderBy(
      {
        entity: "outlets",
        view: "all",
        q: "",
        phone: "all",
        hasOutlets: "all",
        outletStatus: "all",
        warehouseFilter: "all",
        sortBy: "address",
        sortDir: "desc",
        page: 1,
        pageSize: 50,
      },
      { includeTeamSort: false, outletStoreAddressExpr: addressExpr },
    );
    assert.match(addressOrder, /COALESCE\(\(SELECT 'addr' FROM onec_clients oc LIMIT 1\), ''\) DESC/i);
    assert.doesNotMatch(addressOrder, /store_address/i);
  });

  it("rejects unknown sort fields during parse", () => {
    assert.equal(parseSortBy("clients", "unknown"), null);
    assert.equal(parseSortBy("outlets", "guidStore"), "guidStore");
  });
});
