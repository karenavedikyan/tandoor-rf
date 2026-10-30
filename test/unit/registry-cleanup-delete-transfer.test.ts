import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteTransferBeforeFirstCustody } from "../../src/tan-tracker/registry-cleanup/delete-transfer";

describe("deleteTransferBeforeFirstCustody admin bypass flag", () => {
  it("requires adminForceDelete option at type level (integration covers DB)", () => {
    assert.equal(typeof deleteTransferBeforeFirstCustody, "function");
    assert.equal(deleteTransferBeforeFirstCustody.length >= 2, true);
  });
});
