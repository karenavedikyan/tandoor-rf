import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientsFilter, parseClientsListQuery } from "../../src/clients/query";

describe("clients query parsing", () => {
  it("rejects invalid filters and limits", () => {
    assert.equal(parseClientsListQuery({ page: "0" }).ok, false);
    assert.equal(parseClientsListQuery({ pageSize: "101" }).ok, false);
    assert.equal(parseClientsListQuery({ phone: "maybe" }).ok, false);
    assert.equal(parseClientsListQuery({ manager: "not-a-uuid" }).ok, false);
  });

  it("builds phone filter without matching everything on empty normalized phone", () => {
    const filter = buildClientsFilter({
      q: "+-()",
      phone: "all",
      page: 1,
      pageSize: 50,
    });
    assert.match(filter.whereSql, /name_client ILIKE/i);
    assert.doesNotMatch(filter.whereSql, /regexp_replace/i);
  });

  it("includes normalized phone search when digits remain", () => {
    const filter = buildClientsFilter({
      q: "+7 (999)",
      phone: "all",
      page: 1,
      pageSize: 50,
    });
    assert.match(filter.whereSql, /regexp_replace/i);
  });

  it("does not treat cyrillic text as phone search input", () => {
    const filter = buildClientsFilter({
      q: "альфа",
      phone: "all",
      page: 1,
      pageSize: 50,
    });
    assert.doesNotMatch(filter.whereSql, /regexp_replace/i);
  });
});
