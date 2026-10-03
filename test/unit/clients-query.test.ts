import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientsFilter, parseClientsListQuery } from "../../src/clients/query";

describe("clients query parsing", () => {
  it("rejects invalid filters and limits", () => {
    assert.equal(parseClientsListQuery({ page: "0" }).ok, false);
    assert.equal(parseClientsListQuery({ pageSize: "101" }).ok, false);
    assert.equal(parseClientsListQuery({ phone: "maybe" }).ok, false);
    assert.equal(parseClientsListQuery({ manager: "not-a-uuid" }).ok, false);
    assert.equal(parseClientsListQuery({ page: "1e308" }).ok, false);
    assert.equal(parseClientsListQuery({ page: "999999999999999999999" }).ok, false);
  });

  it("rejects array and object query values", () => {
    assert.equal(parseClientsListQuery({ q: ["альфа"] }).ok, false);
    assert.equal(parseClientsListQuery({ phone: ["yes"] }).ok, false);
    assert.equal(parseClientsListQuery({ manager: { id: "x" } }).ok, false);
  });

  it("parses extended view and review filters", () => {
    const parsed = parseClientsListQuery({
      view: "review",
      reviewState: "in_progress",
      unassignedCategory: "opt_without_rop_team",
      hasOutlets: "yes",
      page: "2",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.query.view, "review");
      assert.equal(parsed.query.reviewState, "in_progress");
      assert.equal(parsed.query.unassignedCategory, "opt_without_rop_team");
      assert.equal(parsed.query.hasOutlets, "yes");
    }
  });

  it("builds phone filter without matching everything on empty normalized phone", () => {
    const filter = buildClientsFilter({
      view: "all",
      q: "+-()",
      phone: "all",
      hasOutlets: "all",
      page: 1,
      pageSize: 50,
    });
    assert.match(filter.whereSql, /name_client ILIKE/i);
    assert.doesNotMatch(filter.whereSql, /regexp_replace/i);
  });

  it("includes normalized phone search when digits remain", () => {
    const filter = buildClientsFilter({
      view: "all",
      q: "+7 (999)",
      phone: "all",
      hasOutlets: "all",
      page: 1,
      pageSize: 50,
    });
    assert.match(filter.whereSql, /regexp_replace/i);
  });

  it("does not treat cyrillic text as phone search input", () => {
    const filter = buildClientsFilter({
      view: "all",
      q: "альфа",
      phone: "all",
      hasOutlets: "all",
      page: 1,
      pageSize: 50,
    });
    assert.doesNotMatch(filter.whereSql, /regexp_replace/i);
  });
});
