import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("external historical summaries SQL", () => {
  it("treats NULL pending/final participant columns as non-participant", () => {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/tan-tracker/external-person/external-person-orders.ts",
    );
    const src = readFileSync(file, "utf8");
    assert.match(src, /pending_party_id IS NOT NULL AND t\.pending_party_id = \$1::uuid/);
    assert.match(src, /final_recipient_party_id IS NOT NULL AND t\.final_recipient_party_id = \$1::uuid/);
  });
});
