import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { normalizeListFilterNumberValue } from "../../src/clients/v3/normalize-list-filter-number";

const CORPUS: Array<{ input: string; expect: "ok" | "invalid" | "empty"; value?: string }> = [
  { input: "1e3", expect: "ok", value: "1000" },
  { input: ".5", expect: "ok", value: "0.5" },
  { input: "-12.5", expect: "ok", value: "-12.5" },
  { input: "9007199254740993", expect: "ok", value: "9007199254740993" },
  { input: "1e21", expect: "ok", value: "1000000000000000000000" },
  { input: "1e-20", expect: "ok", value: "0.00000000000000000001" },
  { input: "1e-41", expect: "invalid" },
  { input: "Infinity", expect: "invalid" },
  { input: "abc", expect: "invalid" },
  { input: "", expect: "empty" },
  { input: "0x10", expect: "invalid" },
];

function loadJsNormalizer() {
  const code = fs.readFileSync(path.join(process.cwd(), "public/clients-v3-filter-number.js"), "utf8");
  const context = { window: {} as Record<string, unknown> };
  vm.createContext(context);
  vm.runInContext(code, context);
  return (context.window as { ClientsV3FilterNumber: { normalizeListFilterNumberValue: typeof normalizeListFilterNumberValue } })
    .ClientsV3FilterNumber.normalizeListFilterNumberValue;
}

describe("normalizeListFilterNumberValue", () => {
  for (const row of CORPUS) {
    it(`TS: ${row.input || "(empty)"} -> ${row.expect}`, () => {
      const result = normalizeListFilterNumberValue(row.input);
      if (row.expect === "empty") {
        assert.equal(result.ok, false);
        assert.equal(result.ok === false && result.reason, "empty");
        return;
      }
      if (row.expect === "invalid") {
        assert.equal(result.ok, false);
        return;
      }
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value, row.value);
        assert.match(result.value, /^-?\d+(\.\d+)?$/);
      }
    });
  }

  it("JS runtime helper matches TS corpus", () => {
    const jsNormalize = loadJsNormalizer();
    for (const row of CORPUS) {
      const ts = normalizeListFilterNumberValue(row.input);
      const js = jsNormalize(row.input);
      assert.equal(JSON.stringify(js), JSON.stringify(ts), `parity mismatch for ${row.input}`);
    }
  });
});
