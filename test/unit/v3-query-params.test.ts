import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMultiFilterTokenParam } from "../../src/clients/v3/query-params";

describe("v3 query params", () => {
  it("parses comma-separated type tokens", () => {
    assert.deepEqual(parseMultiFilterTokenParam("t1,t2"), ["t1", "t2"]);
  });

  it("rejects invalid tokens", () => {
    assert.equal(parseMultiFilterTokenParam("bad token"), undefined);
  });

  it("deduplicates tokens", () => {
    assert.deepEqual(parseMultiFilterTokenParam("t1,t1"), ["t1"]);
  });
});
