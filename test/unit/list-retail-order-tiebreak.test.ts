import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("v3 retail list pagination order", () => {
  it("uses deterministic guid_store tie-breaker after address and name", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/clients/v3/list.ts"), "utf8");
    assert.match(source, /ORDER BY ro\.address->>'store_address' ASC NULLS LAST, name ASC, ro\.guid_store::text ASC/);
  });

  it("uses guid tie-breaker for legal and holdings lists", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/clients/v3/list.ts"), "utf8");
    assert.match(source, /ORDER BY \$\{salesOrder\}le\.name_client ASC, le\.guid_client::text ASC/);
    assert.match(source, /ORDER BY \$\{salesOrder\}h\.name_holding ASC, h\.guid_holding::text ASC/);
  });
});
