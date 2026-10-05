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
    const clientOrder = buildClientsOrderBy(
      {
        entity: "clients",
        view: "all",
        q: "",
        phone: "all",
        hasOutlets: "all",
        sortBy: "holding",
        sortDir: "desc",
        page: 1,
        pageSize: 50,
      },
      { includeTeamSort: false, includeOutletsCount: true },
    );
    assert.match(clientOrder, /name_holding DESC/i);

    const outletOrder = buildClientsOrderBy(
      {
        entity: "outlets",
        view: "all",
        q: "",
        phone: "all",
        hasOutlets: "all",
        sortBy: "status",
        sortDir: "asc",
        page: 1,
        pageSize: 50,
      },
      { includeTeamSort: false, includeOutletsCount: false },
    );
    assert.match(outletOrder, /is_closed ASC/i);
  });

  it("rejects unknown sort fields during parse", () => {
    assert.equal(parseSortBy("clients", "unknown"), null);
    assert.equal(parseSortBy("outlets", "guidStore"), "guidStore");
  });
});
