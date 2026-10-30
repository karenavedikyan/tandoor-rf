import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function loadCommonApi() {
  const src = fs.readFileSync(path.join(process.cwd(), "public/common.js"), "utf8");
  const sandbox: { window: { TandoorRf: Record<string, unknown> } } = { window: { TandoorRf: {} } };
  vm.runInNewContext(src, sandbox, { filename: "common.js" });
  return sandbox.window.TandoorRf as {
    mapRequestError: (err: unknown, timeoutSec: number) => string;
    isAbortLikeError: (err: unknown) => boolean;
  };
}

describe("common.js abort-like error mapping (WebKit-safe)", () => {
  it("treats Fetch is aborted as timeout copy in Russian", () => {
    const api = loadCommonApi();
    const err = Object.assign(new Error("Fetch is aborted"), { name: "NetworkError" });
    assert.equal(api.isAbortLikeError(err), true);
    assert.match(api.mapRequestError(err, 45), /Превышено время ожидания ответа \(45 с\)/);
    assert.doesNotMatch(api.mapRequestError(err, 45), /Fetch is aborted/);
  });
});
