import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaxSendResult } from "../../src/tanbot-max/delivery-transport";

describe("tanbot max delivery transport parse", () => {
  it("accepts HTTP 200 message envelope without success:true", () => {
    const body = JSON.stringify({ message: { mid: "abc", seq: 1, text: "hi" } });
    const result = parseMaxSendResult(body, 200);
    assert.equal(result.ok, true);
  });

  it("treats success:false as API error", () => {
    const body = JSON.stringify({ success: false, message: "nope" });
    const result = parseMaxSendResult(body, 200);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "API_ERROR");
  });
});
