import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("clients-lktandoor result count line", () => {
  it("shows matched of territory total when scope counts exist", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients-lktandoor-list.js"), "utf8");
    const window: Record<string, unknown> = {
      __lktandoorScopeCounts: { legal: 118, retail: 117 },
    };
    vm.runInNewContext(source, { window, console });
    const mod = window.ClientsLktandoorList as {
      formatResultCountLine: (state: { v3entity: string }, total: number) => string;
    };
    const line = mod.formatResultCountLine({ v3entity: "legal_grouped" }, 12);
    assert.match(line, /Совпало 12 из 118/);
  });
});
